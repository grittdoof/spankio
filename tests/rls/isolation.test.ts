import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON, OWNER, asUser, createTestDb, expectError, sqlErrorCode, type TestDb } from '../helpers/db';
import { seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * CRITÈRE D'ACCEPTATION BLOQUANT.
 *
 * Un utilisateur de l'organisation A ne doit pouvoir ni lire ni écrire quoi que
 * ce soit de l'organisation B, quel que soit son rôle et quelle que soit la
 * table. Ce fichier balaye chaque table sensible dans les deux sens.
 */
describe('isolation multi-tenant', () => {
  let db: TestDb;
  let a: Tenant;
  let b: Tenant;
  let superAdmin: string;

  beforeAll(async () => {
    db = await createTestDb();
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;
    superAdmin = seeded.superAdmin;
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('lecture', () => {
    it("l'admin de A ne voit que sa propre organisation", async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.admin),
        'select id from public.organisations order by slug',
      );
      expect(rows).toEqual([{ id: a.organisationId }]);
    });

    it.each([
      ['admin', (t: Tenant) => t.admin],
      ['editor', (t: Tenant) => t.editor],
      ['viewer', (t: Tenant) => t.viewer],
    ])('le %s de A ne voit aucun sondage de B', async (_label, pick) => {
      const rows = await db.query<{ id: string; organisation_id: string }>(
        asUser(pick(a)),
        'select id, organisation_id from public.surveys',
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.organisation_id === a.organisationId)).toBe(true);
      expect(rows.map((r) => r.id)).not.toContain(b.survey);
    });

    it("le ciblage direct d'un sondage de B ne renvoie rien", async () => {
      const rows = await db.query(
        asUser(a.admin),
        'select id from public.surveys where id = $1',
        [b.survey],
      );
      expect(rows).toEqual([]);
    });

    it('les réponses de B sont invisibles depuis A', async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.admin),
        'select id from public.survey_responses',
      );
      expect(rows.map((r) => r.id)).toEqual([a.response]);
    });

    it('les statistiques ne fuient pas entre organisations', async () => {
      const rows = await db.query<{ survey_id: string; organisation_id: string }>(
        asUser(a.editor),
        'select survey_id, organisation_id from public.survey_stats',
      );
      expect(rows.every((r) => r.organisation_id === a.organisationId)).toBe(true);
      expect(rows.map((r) => r.survey_id)).not.toContain(b.survey);
    });

    it("les profils de B sont invisibles depuis l'admin de A", async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.admin),
        'select id from public.profiles order by email',
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(a.admin);
      expect(ids).toContain(a.editor);
      expect(ids).not.toContain(b.admin);
      expect(ids).not.toContain(superAdmin);
    });

    it("un editor ne peut pas lister les membres de son organisation", async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.editor),
        'select id from public.profiles',
      );
      expect(rows).toEqual([{ id: a.editor }]);
    });

    it("les modules concédés à B sont invisibles depuis A", async () => {
      const rows = await db.query<{ organisation_id: string }>(
        asUser(a.admin),
        'select organisation_id from public.organisation_modules',
      );
      expect(rows.every((r) => r.organisation_id === a.organisationId)).toBe(true);
    });

    it("le journal d'audit de B est invisible depuis A", async () => {
      await db.query(
        OWNER,
        `insert into public.audit_log (organisation_id, action, meta)
         values ($1, 'test.event', '{}'::jsonb)`,
        [b.organisationId],
      );
      const rows = await db.query<{ organisation_id: string }>(
        asUser(a.admin),
        'select organisation_id from public.audit_log',
      );
      expect(rows.every((r) => r.organisation_id === a.organisationId)).toBe(true);
    });

    it("les demandes d'effacement de B sont invisibles depuis A", async () => {
      await db.query(
        OWNER,
        `insert into public.erasure_requests (organisation_id, survey_id, identifier)
         values ($1, $2, 'personne@b.test')`,
        [b.organisationId, b.survey],
      );
      const rows = await db.query<{ organisation_id: string }>(
        asUser(a.admin),
        'select organisation_id from public.erasure_requests',
      );
      expect(rows.every((r) => r.organisation_id === a.organisationId)).toBe(true);
    });

    it("les demandes de rattachement d'autrui sont invisibles", async () => {
      await db.query(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, organisation_id, requested_role)
         values ($1, 'editor@b.test', $2, 'editor')`,
        [b.editor, b.organisationId],
      );
      const rows = await db.query<{ user_id: string }>(
        asUser(a.admin),
        'select user_id from public.membership_requests',
      );
      expect(rows).toEqual([]);
    });
  });

  describe('écriture', () => {
    it("l'admin de A ne peut pas modifier l'organisation B", async () => {
      const rows = await db.query(
        asUser(a.admin),
        "update public.organisations set name = 'Piratée' where id = $1 returning id",
        [b.organisationId],
      );
      expect(rows).toEqual([]);

      const check = await db.queryOne<{ name: string }>(
        OWNER,
        'select name from public.organisations where id = $1',
        [b.organisationId],
      );
      expect(check?.name).toBe('Organisation b');
    });

    it("l'editor de A ne peut pas modifier un sondage de B", async () => {
      const rows = await db.query(
        asUser(a.editor),
        "update public.surveys set title = 'Détourné' where id = $1 returning id",
        [b.survey],
      );
      expect(rows).toEqual([]);
    });

    it("l'editor de A ne peut pas supprimer un sondage de B", async () => {
      const rows = await db.query(
        asUser(a.editor),
        'delete from public.surveys where id = $1 returning id',
        [b.survey],
      );
      expect(rows).toEqual([]);

      const still = await db.query(OWNER, 'select id from public.surveys where id = $1', [b.survey]);
      expect(still).toHaveLength(1);
    });

    it("l'editor de A ne peut pas créer un sondage dans l'organisation B", async () => {
      const error = await expectError(
        db.query(
          asUser(a.editor),
          `insert into public.surveys (organisation_id, slug, title)
           values ($1, 'injecte', 'Injecté')`,
          [b.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it("l'admin de A ne peut pas supprimer logiquement une réponse de B", async () => {
      const rows = await db.query(
        asUser(a.admin),
        'update public.survey_responses set deleted_at = now() where id = $1 returning id',
        [b.response],
      );
      expect(rows).toEqual([]);

      const check = await db.queryOne<{ deleted_at: string | null }>(
        OWNER,
        'select deleted_at from public.survey_responses where id = $1',
        [b.response],
      );
      expect(check?.deleted_at).toBeNull();
    });

    it("l'admin de A ne peut pas effacer définitivement une réponse de B", async () => {
      const rows = await db.query(
        asUser(a.admin),
        'delete from public.survey_responses where id = $1 returning id',
        [b.response],
      );
      expect(rows).toEqual([]);
    });

    it("l'admin de A ne peut pas rattacher un membre de B à son organisation", async () => {
      // Le RLS ne rend pas la ligne visible : la mise à jour ne touche personne.
      const rows = await db.query(
        asUser(a.admin),
        'update public.profiles set organisation_id = $2 where id = $1 returning id',
        [b.editor, a.organisationId],
      );
      expect(rows).toEqual([]);

      const check = await db.queryOne<{ organisation_id: string; role: string }>(
        OWNER,
        'select organisation_id, role from public.profiles where id = $1',
        [b.editor],
      );
      expect(check?.organisation_id).toBe(b.organisationId);
      expect(check?.role).toBe('editor');
    });

    it("l'admin de A ne peut pas concéder un module à l'organisation B", async () => {
      const error = await expectError(
        db.query(
          asUser(a.admin),
          `insert into public.organisation_modules (organisation_id, module_key)
           values ($1, 'event')`,
          [b.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it("l'admin de A ne peut pas surcharger les modules d'un membre de B", async () => {
      const error = await expectError(
        db.query(
          asUser(a.admin),
          `insert into public.profile_module_overrides (profile_id, module_key, allowed)
           values ($1, 'event', true)`,
          [b.editor],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it("l'admin de A ne peut pas traiter une demande d'effacement de B", async () => {
      const request = await db.queryOne<{ id: string }>(
        OWNER,
        'select id from public.erasure_requests where organisation_id = $1 limit 1',
        [b.organisationId],
      );
      const error = await expectError(
        db.query(asUser(a.admin), 'select public.apply_erasure($1, false)', [request!.id]),
      );
      expect(sqlErrorCode(error)).toBe('PT403');
    });

    it("l'admin de A ne peut pas éditer les réglages de plateforme", async () => {
      const rows = await db.query(
        asUser(a.admin),
        "update public.platform_settings set publisher_name = 'Pirate' where id = 1 returning id",
      );
      expect(rows).toEqual([]);
    });

    it("l'admin de A ne peut pas valider une demande de rattachement", async () => {
      const request = await db.queryOne<{ id: string }>(
        OWNER,
        'select id from public.membership_requests limit 1',
      );
      const error = await expectError(
        db.query(asUser(a.admin), "select public.approve_membership_request($1, 'admin')", [
          request!.id,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('PT403');
    });
  });

  describe('super administrateur', () => {
    it('voit les deux organisations', async () => {
      const rows = await db.query<{ id: string }>(
        asUser(superAdmin),
        'select id from public.organisations order by slug',
      );
      expect(rows.map((r) => r.id)).toEqual([a.organisationId, b.organisationId]);
    });

    it('voit les sondages des deux organisations', async () => {
      const rows = await db.query<{ id: string }>(asUser(superAdmin), 'select id from public.surveys');
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(a.survey);
      expect(ids).toContain(b.survey);
    });
  });

  describe('visiteur anonyme', () => {
    it("n'a aucun accès direct à la table des sondages", async () => {
      const error = await expectError(db.query(ANON, 'select id from public.surveys'));
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it("n'a aucun accès aux réponses", async () => {
      const error = await expectError(db.query(ANON, 'select id from public.survey_responses'));
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it("n'a aucun accès aux profils ni aux organisations", async () => {
      expect(sqlErrorCode(await expectError(db.query(ANON, 'select id from public.profiles')))).toBe(
        '42501',
      );
      expect(
        sqlErrorCode(await expectError(db.query(ANON, 'select id from public.organisations'))),
      ).toBe('42501');
    });

    it('peut lire les réglages de plateforme (pages légales)', async () => {
      const rows = await db.query<{ id: number }>(ANON, 'select id from public.platform_settings');
      expect(rows).toEqual([{ id: 1 }]);
    });
  });
});
