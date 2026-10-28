import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER, asUser, createTestDb, expectError, sqlErrorCode, type TestDb } from '../helpers/db';
import { assignStaff, seedTwoTenants, setModuleOverride, type Tenant } from '../helpers/seed';

/**
 * CRITÈRE D'ACCEPTATION BLOQUANT DU MODULE « ACCUEIL ».
 *
 * Un compte d'accueil (`host`) tient la porte d'UN événement. Tout le reste
 * doit lui être fermé — les autres sondages de sa propre organisation
 * compris, ce qui est la différence entre ce rôle et `viewer`.
 *
 * Ce fichier existe parce que l'ouverture se fait par une policy ADDITIVE, et
 * que les policies permissives s'additionnent : une branche trop large ne
 * produit aucune erreur, seulement un accès de trop que rien ne signale. La
 * seule façon de le savoir est de l'énumérer.
 *
 * Chaque test qui modifie l'état le restaure : la base est semée une fois pour
 * tout le fichier, et un test qui laisserait un module retiré ferait échouer le
 * suivant pour une raison sans rapport.
 */
describe('compte d’accueil (host)', () => {
  let db: TestDb;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    db = await createTestDb();
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  // --------------------------------------------------------------------------
  describe('ce que l’affectation ouvre', () => {
    it('voit l’événement où il est affecté, et lui seul', async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.host),
        'select id from public.surveys',
      );
      expect(rows.map((r) => r.id)).toEqual([a.eventSurvey]);
    });

    it('voit les réponses de cet événement', async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.host),
        'select id from public.survey_responses',
      );
      expect(rows.map((r) => r.id)).toEqual([a.eventResponse]);
    });

    it('lit sa propre affectation, pour savoir où il est attendu', async () => {
      const rows = await db.query<{ survey_id: string }>(
        asUser(a.host),
        'select survey_id from public.checkin_staff',
      );
      expect(rows.map((r) => r.survey_id)).toEqual([a.eventSurvey]);
    });
  });

  // --------------------------------------------------------------------------
  describe('ce que le rôle seul n’ouvre pas', () => {
    /**
     * LE test du lot. Sans lui, un vert ne distinguerait pas « le droit vient
     * de l'affectation » de « le droit vient d'être host dans cette
     * organisation » — et c'est exactement la confusion qui transformerait ce
     * rôle en `viewer` déguisé.
     */
    it('un host SANS affectation ne voit aucun sondage', async () => {
      const rows = await db.query(asUser(a.idleHost), 'select id from public.surveys');
      expect(rows).toEqual([]);
    });

    it('un host SANS affectation ne voit aucune réponse', async () => {
      const rows = await db.query(asUser(a.idleHost), 'select id from public.survey_responses');
      expect(rows).toEqual([]);
    });

    it('ne voit pas les AUTRES sondages de sa propre organisation', async () => {
      const rows = await db.query(
        asUser(a.host),
        'select id from public.surveys where id = $1',
        [a.survey],
      );
      expect(rows).toEqual([]);
    });

    it('ne voit pas les réponses des autres sondages de son organisation', async () => {
      const rows = await db.query(
        asUser(a.host),
        'select id from public.survey_responses where id = $1',
        [a.response],
      );
      expect(rows).toEqual([]);
    });

    it('ne voit rien de l’organisation B, même affecté chez lui', async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.host),
        'select id from public.surveys where id = any($1::uuid[])',
        [[b.survey, b.eventSurvey]],
      );
      expect(rows).toEqual([]);
    });

    it('ne voit pas les affectations des autres', async () => {
      const rows = await db.query(
        asUser(a.host),
        'select profile_id from public.checkin_staff where profile_id <> $1',
        [a.host],
      );
      expect(rows).toEqual([]);
    });

    it('ne voit pas les profils de ses collègues', async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.host),
        'select id from public.profiles',
      );
      expect(rows.map((r) => r.id)).toEqual([a.host]);
    });

    it('ne voit pas le journal d’audit de son organisation', async () => {
      const rows = await db.query(asUser(a.host), 'select id from public.audit_log');
      expect(rows).toEqual([]);
    });

    it('ne voit pas une réponse mise en suppression logique', async () => {
      await db.query(
        OWNER,
        'update public.survey_responses set deleted_at = now() where id = $1',
        [a.eventResponse],
      );
      try {
        const rows = await db.query(
          asUser(a.host),
          'select id from public.survey_responses where id = $1',
          [a.eventResponse],
        );
        expect(rows).toEqual([]);
      } finally {
        await db.query(
          OWNER,
          'update public.survey_responses set deleted_at = null where id = $1',
          [a.eventResponse],
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  describe('ce qui referme la porte', () => {
    it('une affectation EXPIRÉE ne donne plus rien', async () => {
      await assignStaff(db, a.eventSurvey, a.host, a.organisationId, '2020-01-01T00:00:00Z');
      try {
        const surveys = await db.query(asUser(a.host), 'select id from public.surveys');
        const responses = await db.query(asUser(a.host), 'select id from public.survey_responses');
        expect(surveys).toEqual([]);
        expect(responses).toEqual([]);
      } finally {
        await assignStaff(db, a.eventSurvey, a.host, a.organisationId, null);
      }
    });

    it('un compte suspendu ne voit plus rien, affectation ou non', async () => {
      await db.query(
        OWNER,
        "update public.profiles set status = 'suspended' where id = $1",
        [a.host],
      );
      try {
        const rows = await db.query(asUser(a.host), 'select id from public.surveys');
        expect(rows).toEqual([]);
      } finally {
        await db.query(
          OWNER,
          "update public.profiles set status = 'active' where id = $1",
          [a.host],
        );
      }
    });

    it('le module checkin retiré à l’organisation referme tout', async () => {
      await db.query(
        OWNER,
        `update public.organisation_modules set enabled = false
          where organisation_id = $1 and module_key = 'checkin'`,
        [a.organisationId],
      );
      try {
        const rows = await db.query(asUser(a.host), 'select id from public.surveys');
        expect(rows).toEqual([]);
      } finally {
        await db.query(
          OWNER,
          `update public.organisation_modules set enabled = true
            where organisation_id = $1 and module_key = 'checkin'`,
          [a.organisationId],
        );
      }
    });

    it('la surcharge PAR UTILISATEUR referme tout, module concédé ou non', async () => {
      await setModuleOverride(db, a.host, 'checkin', false);
      try {
        const rows = await db.query(asUser(a.host), 'select id from public.surveys');
        expect(rows).toEqual([]);
      } finally {
        await db.query(
          OWNER,
          `delete from public.profile_module_overrides
            where profile_id = $1 and module_key = 'checkin'`,
          [a.host],
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  describe('écriture : un compte d’accueil n’écrit rien', () => {
    /**
     * Un refus de RLS en lecture-écriture ne LÈVE pas : la clause `using` d'une
     * policy d'UPDATE filtre les lignes, elle ne produit une erreur que si
     * `with check` est violée sur une ligne atteinte. La première version de ce
     * test attendait un 42501 et échouait donc en annonçant une fuite qui
     * n'existait pas. Ce qu'il faut vérifier est plus simple et plus fort :
     * aucune ligne touchée, et la donnée inchangée.
     */
    it('ne peut pas modifier la réponse qu’il voit', async () => {
      const touched = await db.query(
        asUser(a.host),
        'update public.survey_responses set deleted_at = now() where id = $1 returning id',
        [a.eventResponse],
      );
      expect(touched).toEqual([]);

      const after = await db.queryOne<{ deleted_at: string | null }>(
        OWNER,
        'select deleted_at from public.survey_responses where id = $1',
        [a.eventResponse],
      );
      expect(after?.deleted_at).toBeNull();
    });

    it('ne peut pas modifier l’événement qu’il tient', async () => {
      const rows = await db.query(
        asUser(a.host),
        "update public.surveys set title = 'détourné' where id = $1 returning id",
        [a.eventSurvey],
      );
      // Aucune policy d'UPDATE ne le vise : la ligne n'est pas atteinte.
      expect(rows).toEqual([]);
    });

    it('ne peut pas créer de sondage', async () => {
      const error = await expectError(
        db.query(
          asUser(a.host),
          `insert into public.surveys (organisation_id, module_key, slug, title, kind, status,
                                       schema, purpose, legal_basis, retention_days, recipients)
           values ($1, 'core', 'par-un-hote', 'Par un hôte', 'survey', 'draft',
                   '{"steps": []}'::jsonb, 'x', 'consent', 365, 'x')`,
          [a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('ne peut pas s’affecter lui-même à un autre événement', async () => {
      const error = await expectError(
        db.query(
          asUser(a.host),
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [a.survey, a.host, a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('ne peut pas repousser l’échéance de sa propre affectation', async () => {
      const rows = await db.query(
        asUser(a.host),
        `update public.checkin_staff set expires_at = null
          where survey_id = $1 and profile_id = $2 returning survey_id`,
        [a.eventSurvey, a.host],
      );
      expect(rows).toEqual([]);
    });

    it('ne peut pas se promouvoir', async () => {
      const error = await expectError(
        db.query(
          asUser(a.host),
          "update public.profiles set role = 'admin' where id = $1",
          [a.host],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });
  });

  // --------------------------------------------------------------------------
  describe('qui affecte, et ce que le moteur refuse à tous', () => {
    it('l’administrateur de l’organisation affecte', async () => {
      await db.query(
        asUser(a.admin),
        `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
         values ($1, $2, $3)`,
        [a.eventSurvey, a.idleHost, a.organisationId],
      );
      const rows = await db.query(
        asUser(a.idleHost),
        'select id from public.surveys',
      );
      expect(rows).toEqual([{ id: a.eventSurvey }]);

      await db.query(
        asUser(a.admin),
        'delete from public.checkin_staff where survey_id = $1 and profile_id = $2',
        [a.eventSurvey, a.idleHost],
      );
    });

    it('l’éditeur n’affecte pas : désigner une personne est un acte sur un compte', async () => {
      const error = await expectError(
        db.query(
          asUser(a.editor),
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [a.eventSurvey, a.idleHost, a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('l’admin de A ne peut pas affecter un hôte de A à un événement de B', async () => {
      const error = await expectError(
        db.query(
          asUser(a.admin),
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [b.eventSurvey, a.host, a.organisationId],
        ),
      );
      // La clé étrangère composite tombe avant la policy : le couple
      // (événement de B, organisation de A) n'existe pas.
      expect(['23503', '42501']).toContain(sqlErrorCode(error));
    });

    /**
     * La cohérence d'organisation est STRUCTURELLE : même le propriétaire de la
     * base, qui contourne tout le RLS, ne peut pas fabriquer une affectation
     * croisée. C'est ce qui distingue une contrainte d'une policy — une policy
     * ne protège que le chemin qu'elle garde.
     */
    it('même le propriétaire ne peut pas croiser un événement et une organisation', async () => {
      const error = await expectError(
        db.query(
          OWNER,
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [b.eventSurvey, a.host, a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('23503');
    });

    it('même le propriétaire ne peut pas affecter un profil non rattaché', async () => {
      const orphan = await db.queryOne<{ id: string }>(
        OWNER,
        `insert into auth.users (email) values ('orphelin@test.test') returning id`,
      );
      const error = await expectError(
        db.query(
          OWNER,
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [a.eventSurvey, orphan!.id, a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('23503');
    });
  });
});
