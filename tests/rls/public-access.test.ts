import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON, OWNER, asUser, createTestDb, expectError, sqlErrorCode, type TestDb } from '../helpers/db';
import {
  activateMember,
  createAccount,
  createOrganisation,
  createSurvey,
  insertResponse,
} from '../helpers/seed';

const submit = `select public.submit_survey_response($1, $2::jsonb, $3, $4, $5) as id`;

describe('accès public', () => {
  let db: TestDb;
  let orgId: string;
  let published: string;
  let draft: string;
  let closed: string;
  let editor: string;

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-pub', 'Organisation publique');
    editor = await createAccount(db, 'editor@pub.test');
    await activateMember(db, editor, orgId, 'editor');

    published = await createSurvey(db, { organisationId: orgId, slug: 'ouvert' });
    draft = await createSurvey(db, { organisationId: orgId, slug: 'brouillon', status: 'draft' });
    closed = await createSurvey(db, { organisationId: orgId, slug: 'ferme', status: 'closed' });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('vue public_surveys', () => {
    it("n'expose que les sondages publiés et ouverts", async () => {
      const rows = await db.query<{ id: string }>(ANON, 'select id from public.public_surveys');
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(published);
      expect(ids).not.toContain(draft);
      expect(ids).not.toContain(closed);
    });

    it("n'expose pas les colonnes internes du sondage", async () => {
      const columns = await db.query<{ column_name: string }>(
        OWNER,
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'public_surveys'`,
      );
      const names = columns.map((c) => c.column_name);
      expect(names).not.toContain('created_by');
      expect(names).not.toContain('deleted_at');
      expect(names).not.toContain('response_limit');
      expect(names).not.toContain('status');
      // …mais bien tout ce que l'écran public doit afficher.
      expect(names).toEqual(
        expect.arrayContaining([
          'title',
          'schema',
          'settings',
          'organisation_name',
          'require_consent',
          'legal_basis',
          'purpose',
          'retention_days',
          'recipients',
        ]),
      );
    });

    it('masque un sondage dont la fenêtre n’est pas encore ouverte', async () => {
      const future = await createSurvey(db, {
        organisationId: orgId,
        slug: 'plus-tard',
        opensAt: '2099-01-01T00:00:00Z',
      });
      const rows = await db.query<{ id: string }>(
        ANON,
        'select id from public.public_surveys where id = $1',
        [future],
      );
      expect(rows).toEqual([]);
    });

    it('masque les sondages d’une organisation désactivée', async () => {
      await db.query(OWNER, 'update public.organisations set is_active = false where id = $1', [orgId]);
      const rows = await db.query<{ id: string }>(ANON, 'select id from public.public_surveys');
      expect(rows).toEqual([]);
      await db.query(OWNER, 'update public.organisations set is_active = true where id = $1', [orgId]);
    });

    it('compte les réponses en excluant les suppressions logiques', async () => {
      const survey = await createSurvey(db, { organisationId: orgId, slug: 'compteur' });
      await insertResponse(db, survey, { a: 1 });
      const deleted = await insertResponse(db, survey, { a: 2 });
      await db.query(OWNER, 'update public.survey_responses set deleted_at = now() where id = $1', [
        deleted,
      ]);

      const rows = await db.query<{ response_count: number }>(
        ANON,
        'select response_count::int as response_count from public.public_surveys where id = $1',
        [survey],
      );
      expect(rows[0]?.response_count).toBe(1);
    });
  });

  describe('soumission publique (submit_survey_response)', () => {
    it('accepte une réponse sur un sondage ouvert', async () => {
      const rows = await db.query<{ id: string }>(ANON, submit, [
        published,
        JSON.stringify({ q1: 'oui' }),
        false,
        null,
        null,
      ]);
      expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("déduit l'organisation du sondage, sans faire confiance au client", async () => {
      const row = await db.queryOne<{ organisation_id: string }>(
        OWNER,
        `select organisation_id from public.survey_responses
          where survey_id = $1 order by submitted_at desc limit 1`,
        [published],
      );
      expect(row?.organisation_id).toBe(orgId);
    });

    it('calcule la date de purge depuis la durée de conservation', async () => {
      const row = await db.queryOne<{ days: number }>(
        OWNER,
        `select extract(day from (purge_after - submitted_at))::int as days
           from public.survey_responses
          where survey_id = $1 order by submitted_at desc limit 1`,
        [published],
      );
      expect(row?.days).toBe(365);
    });

    it('refuse un sondage inconnu', async () => {
      const error = await expectError(
        db.query(ANON, submit, [
          '00000000-0000-0000-0000-000000000000',
          JSON.stringify({}),
          false,
          null,
          null,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('SV404');
    });

    it('refuse un brouillon et un sondage fermé', async () => {
      for (const target of [draft, closed]) {
        const error = await expectError(
          db.query(ANON, submit, [target, JSON.stringify({}), false, null, null]),
        );
        expect(sqlErrorCode(error)).toBe('SV423');
      }
    });

    it('refuse une soumission hors fenêtre de temps', async () => {
      const past = await createSurvey(db, {
        organisationId: orgId,
        slug: 'expire',
        opensAt: '2020-01-01T00:00:00Z',
        closesAt: '2020-02-01T00:00:00Z',
      });
      const error = await expectError(
        db.query(ANON, submit, [past, JSON.stringify({}), false, null, null]),
      );
      expect(sqlErrorCode(error)).toBe('SV423');
    });

    it('exige le consentement quand le sondage le demande', async () => {
      const survey = await createSurvey(db, {
        organisationId: orgId,
        slug: 'avec-consentement',
        requireConsent: true,
      });

      expect(
        sqlErrorCode(
          await expectError(db.query(ANON, submit, [survey, JSON.stringify({}), false, null, null])),
        ),
      ).toBe('SV412');

      // Cocher la case sans texte affiché ne suffit pas : la preuve doit exister.
      expect(
        sqlErrorCode(
          await expectError(db.query(ANON, submit, [survey, JSON.stringify({}), true, '', null])),
        ),
      ).toBe('SV412');

      const ok = await db.query<{ id: string }>(ANON, submit, [
        survey,
        JSON.stringify({}),
        true,
        'Texte de consentement affiché le jour J',
        null,
      ]);
      expect(ok).toHaveLength(1);

      const stored = await db.queryOne<{ consent_given: boolean; consent_text: string }>(
        OWNER,
        'select consent_given, consent_text from public.survey_responses where id = $1',
        [ok[0]!.id],
      );
      expect(stored).toEqual({
        consent_given: true,
        consent_text: 'Texte de consentement affiché le jour J',
      });
    });

    it('applique le plafond de réponses', async () => {
      const survey = await createSurvey(db, {
        organisationId: orgId,
        slug: 'quota',
        responseLimit: 1,
      });
      await db.query(ANON, submit, [survey, JSON.stringify({ a: 1 }), false, null, null]);
      const error = await expectError(
        db.query(ANON, submit, [survey, JSON.stringify({ a: 2 }), false, null, null]),
      );
      expect(sqlErrorCode(error)).toBe('SV429');
    });

    it('refuse un payload anormalement gros (anti-DoS)', async () => {
      const error = await expectError(
        db.query(ANON, submit, [
          published,
          JSON.stringify({ big: 'x'.repeat(200_000) }),
          false,
          null,
          null,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('SV413');
    });

    it('refuse un payload qui n’est pas un objet', async () => {
      const error = await expectError(
        db.query(ANON, submit, [published, JSON.stringify(['a', 'b']), false, null, null]),
      );
      expect(sqlErrorCode(error)).toBe('SV400');
    });
  });

  describe('anti-doublon', () => {
    let dedupSurvey: string;

    beforeAll(async () => {
      dedupSurvey = await createSurvey(db, {
        organisationId: orgId,
        slug: 'sans-doublon',
        dedupField: 'email',
      });
    });

    it('exige la valeur de dédoublonnage quand le sondage en désigne une', async () => {
      const error = await expectError(
        db.query(ANON, submit, [dedupSurvey, JSON.stringify({}), false, null, null]),
      );
      expect(sqlErrorCode(error)).toBe('SV400');
    });

    it('refuse une seconde soumission avec la même valeur', async () => {
      await db.query(ANON, submit, [
        dedupSurvey,
        JSON.stringify({ email: 'Jean@Exemple.test' }),
        false,
        null,
        'Jean@Exemple.test',
      ]);

      // Casse, espaces : la normalisation empêche de contourner l'unicité.
      const error = await expectError(
        db.query(ANON, submit, [
          dedupSurvey,
          JSON.stringify({ email: 'jean@exemple.test' }),
          false,
          null,
          '  JEAN@exemple.test ',
        ]),
      );
      expect(sqlErrorCode(error)).toBe('SV409');
    });

    it('ne stocke pas la valeur en clair mais une empreinte salée par sondage', async () => {
      const row = await db.queryOne<{ dedup_key: string }>(
        OWNER,
        'select dedup_key from public.survey_responses where survey_id = $1 limit 1',
        [dedupSurvey],
      );
      expect(row?.dedup_key).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.dedup_key).not.toContain('exemple');

      // Le même email sur un autre sondage donne une empreinte différente.
      const other = await db.queryOne<{ a: string; b: string }>(
        OWNER,
        `select public.dedup_hash($1, 'jean@exemple.test') as a,
                public.dedup_hash($2, 'jean@exemple.test') as b`,
        [dedupSurvey, published],
      );
      expect(other?.a).not.toBe(other?.b);
    });

    it('autorise une nouvelle soumission après suppression logique', async () => {
      await db.query(
        OWNER,
        'update public.survey_responses set deleted_at = now() where survey_id = $1',
        [dedupSurvey],
      );
      const rows = await db.query<{ id: string }>(ANON, submit, [
        dedupSurvey,
        JSON.stringify({ email: 'jean@exemple.test' }),
        false,
        null,
        'jean@exemple.test',
      ]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('immuabilité des réponses', () => {
    it('interdit la modification du contenu d’une réponse', async () => {
      const survey = await createSurvey(db, { organisationId: orgId, slug: 'immuable' });
      const id = await insertResponse(db, survey, { q1: 'origine' });

      const error = await expectError(
        db.query(
          asUser(editor),
          `update public.survey_responses set data = '{"q1":"falsifie"}'::jsonb where id = $1`,
          [id],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('autorise la seule suppression logique', async () => {
      const survey = await createSurvey(db, { organisationId: orgId, slug: 'soft-delete' });
      const id = await insertResponse(db, survey, { q1: 'a' });

      const rows = await db.query<{ id: string }>(
        asUser(editor),
        'update public.survey_responses set deleted_at = now() where id = $1 returning id',
        [id],
      );
      expect(rows).toEqual([{ id }]);
    });

    it('exclut les réponses supprimées des statistiques', async () => {
      const survey = await createSurvey(db, { organisationId: orgId, slug: 'stats' });
      await insertResponse(db, survey, { q1: 'a' });
      const deleted = await insertResponse(db, survey, { q1: 'b' });
      await db.query(OWNER, 'update public.survey_responses set deleted_at = now() where id = $1', [
        deleted,
      ]);

      const row = await db.queryOne<{ response_count: number; deleted_count: number }>(
        asUser(editor),
        `select response_count::int as response_count, deleted_count::int as deleted_count
           from public.survey_stats where survey_id = $1`,
        [survey],
      );
      expect(row).toEqual({ response_count: 1, deleted_count: 1 });
    });
  });

  describe('contraintes RGPD du sondage', () => {
    it('interdit la publication sans finalité, base légale et durée', async () => {
      const error = await expectError(
        db.query(
          OWNER,
          `insert into public.surveys (organisation_id, slug, title, status)
           values ($1, 'sans-rgpd', 'Sans RGPD', 'published')`,
          [orgId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('23514');
    });

    it('interdit la publication d’un événement sans date de début', async () => {
      const error = await expectError(
        db.query(
          OWNER,
          `insert into public.surveys
             (organisation_id, slug, title, kind, status, purpose, legal_basis, retention_days)
           values ($1, 'sans-date', 'Sans date', 'event', 'published', 'Inscriptions', 'consent', 365)`,
          [orgId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('23514');
    });

    it('interdit une latitude sans longitude', async () => {
      const error = await expectError(
        db.query(
          OWNER,
          `insert into public.surveys (organisation_id, slug, title, event_lat)
           values ($1, 'demi-coord', 'Demi coordonnée', 48.85)`,
          [orgId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('23514');
    });
  });
});
