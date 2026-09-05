import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ANON, OWNER, asUser, createTestDb, expectError, sqlErrorCode, type TestDb } from '../helpers/db';
import {
  activateMember,
  createAccount,
  createOrganisation,
  createSurvey,
  insertResponse,
} from '../helpers/seed';

async function createRequest(
  db: TestDb,
  userId: string,
  email: string,
  options: { organisationId?: string; organisationName?: string; role?: string } = {},
): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    OWNER,
    `insert into public.membership_requests
       (user_id, requester_email, organisation_id, requested_organisation_name, requested_role)
     values ($1, $2, $3, $4, $5::public.user_role)
     returning id`,
    [
      userId,
      email,
      options.organisationId ?? null,
      options.organisationName ?? null,
      options.role ?? 'editor',
    ],
  );
  if (!row) throw new Error('Création de la demande impossible');
  return row.id;
}

describe('demandes de rattachement', () => {
  let db: TestDb;
  let orgId: string;
  let superAdmin: string;

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-gouv', 'Organisation gouvernance');
    superAdmin = await createAccount(db, 'super@gouv.test');
    await activateMember(db, superAdmin, null, 'super_admin');
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('un candidat dépose sa propre demande', async () => {
    const candidate = await createAccount(db, 'candidat@gouv.test');
    const rows = await db.query<{ id: string; status: string }>(
      asUser(candidate),
      `insert into public.membership_requests
         (user_id, requester_email, organisation_id, requested_role, message)
       values ($1, 'candidat@gouv.test', $2, 'editor', 'Bonjour')
       returning id, status`,
      [candidate, orgId],
    );
    expect(rows[0]?.status).toBe('pending');
  });

  it('un candidat ne peut pas déposer une demande pour autrui', async () => {
    const a = await createAccount(db, 'a@gouv.test');
    const b = await createAccount(db, 'b@gouv.test');
    const error = await expectError(
      db.query(
        asUser(a),
        `insert into public.membership_requests (user_id, requester_email, organisation_id)
         values ($1, 'b@gouv.test', $2)`,
        [b, orgId],
      ),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it('un candidat ne peut pas préremplir la décision', async () => {
    const candidate = await createAccount(db, 'malin@gouv.test');
    const error = await expectError(
      db.query(
        asUser(candidate),
        `insert into public.membership_requests
           (user_id, requester_email, organisation_id, decided_role)
         values ($1, 'malin@gouv.test', $2, 'admin')`,
        [candidate, orgId],
      ),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it('un candidat ne peut pas demander le rôle super_admin', async () => {
    const candidate = await createAccount(db, 'ambitieux@gouv.test');

    // Première barrière : la policy RLS refuse l'insertion (42501).
    const denied = await expectError(
      db.query(
        asUser(candidate),
        `insert into public.membership_requests
           (user_id, requester_email, organisation_id, requested_role)
         values ($1, 'ambitieux@gouv.test', $2, 'super_admin')`,
        [candidate, orgId],
      ),
    );
    expect(sqlErrorCode(denied)).toBe('42501');

    // Seconde barrière : même en contournant le RLS, la contrainte de table
    // refuse (23514). Aucun chemin ne permet de demander ce rôle.
    const constrained = await expectError(
      db.query(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, organisation_id, requested_role)
         values ($1, 'ambitieux@gouv.test', $2, 'super_admin')`,
        [candidate, orgId],
      ),
    );
    expect(sqlErrorCode(constrained)).toBe('23514');
  });

  it("une seule demande en attente par compte", async () => {
    const candidate = await createAccount(db, 'insistant@gouv.test');
    await createRequest(db, candidate, 'insistant@gouv.test', { organisationId: orgId });
    const error = await expectError(
      createRequest(db, candidate, 'insistant@gouv.test', { organisationId: orgId }),
    );
    expect(sqlErrorCode(error)).toBe('23505');
  });

  it('un candidat peut retirer sa demande en attente', async () => {
    const candidate = await createAccount(db, 'repenti@gouv.test');
    const requestId = await createRequest(db, candidate, 'repenti@gouv.test', {
      organisationId: orgId,
    });
    const rows = await db.query<{ id: string }>(
      asUser(candidate),
      'delete from public.membership_requests where id = $1 returning id',
      [requestId],
    );
    expect(rows).toEqual([{ id: requestId }]);
  });

  describe('validation par le super administrateur', () => {
    let candidate: string;
    let requestId: string;

    beforeEach(async () => {
      candidate = await createAccount(db, `valide-${Date.now()}-${Math.random()}@gouv.test`);
      requestId = await createRequest(db, candidate, 'valide@gouv.test', {
        organisationId: orgId,
      });
    });

    it('attribue le rôle, le rattachement et les modules choisis', async () => {
      const result = await db.queryOne<{ org: string }>(
        asUser(superAdmin),
        `select public.approve_membership_request($1, 'editor', array['event']) as org`,
        [requestId],
      );
      expect(result?.org).toBe(orgId);

      const profile = await db.queryOne<{
        role: string;
        status: string;
        organisation_id: string;
      }>(OWNER, 'select role, status, organisation_id from public.profiles where id = $1', [
        candidate,
      ]);
      expect(profile).toEqual({ role: 'editor', status: 'active', organisation_id: orgId });

      // Le module est concédé à l'organisation…
      const orgModule = await db.queryOne<{ enabled: boolean }>(
        OWNER,
        'select enabled from public.organisation_modules where organisation_id = $1 and module_key = $2',
        [orgId, 'event'],
      );
      expect(orgModule?.enabled).toBe(true);

      // …et autorisé nominativement pour ce compte.
      const overrides = await db.query<{ module_key: string; allowed: boolean }>(
        OWNER,
        'select module_key, allowed from public.profile_module_overrides where profile_id = $1 order by module_key',
        [candidate],
      );
      expect(overrides).toEqual([{ module_key: 'event', allowed: true }]);

      const request = await db.queryOne<{ status: string; decided_role: string; decided_modules: string[] }>(
        OWNER,
        'select status, decided_role, decided_modules from public.membership_requests where id = $1',
        [requestId],
      );
      expect(request).toEqual({
        status: 'approved',
        decided_role: 'editor',
        decided_modules: ['event'],
      });

      const audit = await db.query<{ action: string }>(
        OWNER,
        "select action from public.audit_log where target_id = $1 and action = 'membership.approved'",
        [requestId],
      );
      expect(audit).toHaveLength(1);
    });

    it('interdit explicitement les modules non retenus', async () => {
      await db.query(asUser(superAdmin), `select public.approve_membership_request($1, 'editor')`, [
        requestId,
      ]);

      const overrides = await db.query<{ module_key: string; allowed: boolean }>(
        OWNER,
        'select module_key, allowed from public.profile_module_overrides where profile_id = $1',
        [candidate],
      );
      expect(overrides).toEqual([{ module_key: 'event', allowed: false }]);

      // Le core reste utilisable : il n'est jamais interdit.
      const core = await db.query<{ ok: boolean }>(
        asUser(candidate),
        "select app.can_use_module('core') as ok",
      );
      expect(core[0]?.ok).toBe(true);
    });

    it('refuse une validation par quelqu’un d’autre qu’un super_admin', async () => {
      const error = await expectError(
        db.query(asUser(candidate), `select public.approve_membership_request($1, 'admin')`, [
          requestId,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('PT403');
    });

    it('refuse d’accorder le rôle super_admin', async () => {
      const error = await expectError(
        db.query(asUser(superAdmin), `select public.approve_membership_request($1, 'super_admin')`, [
          requestId,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('PT400');
    });

    it('refuse un module inconnu', async () => {
      const error = await expectError(
        db.query(
          asUser(superAdmin),
          `select public.approve_membership_request($1, 'editor', array['inexistant'])`,
          [requestId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('PT400');
    });

    it('refuse une seconde décision sur la même demande', async () => {
      await db.query(asUser(superAdmin), `select public.approve_membership_request($1, 'editor')`, [
        requestId,
      ]);
      const error = await expectError(
        db.query(asUser(superAdmin), `select public.approve_membership_request($1, 'admin')`, [
          requestId,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('PT409');
    });

    it('refuse de rétrograder un super administrateur', async () => {
      // Situation rencontrée en exploitation : le premier super administrateur
      // avait aussi déposé une demande pour créer son organisation. La valider
      // aurait écrasé son rôle et laissé la plateforme sans personne pour
      // valider les demandes suivantes.
      const own = await db.queryOne<{ id: string }>(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, requested_organisation_name, requested_role)
         values ($1, 'super@gouv.test', 'Organisation du super admin', 'admin')
         returning id`,
        [superAdmin],
      );

      const error = await expectError(
        db.query(
          asUser(superAdmin),
          `select public.approve_membership_request($1, 'admin', '{}', 'org-du-super-admin')`,
          [own!.id],
        ),
      );
      expect(sqlErrorCode(error)).toBe('PT409');

      // Le rôle est intact, et aucune organisation n'a été créée au passage.
      const profile = await db.queryOne<{ role: string; organisation_id: string | null }>(
        OWNER,
        'select role, organisation_id from public.profiles where id = $1',
        [superAdmin],
      );
      expect(profile).toEqual({ role: 'super_admin', organisation_id: null });

      const created = await db.query(
        OWNER,
        'select id from public.organisations where slug = $1',
        ['org-du-super-admin'],
      );
      expect(created).toEqual([]);

      await db.query(OWNER, 'delete from public.membership_requests where id = $1', [own!.id]);
    });

    it('enregistre un refus motivé', async () => {
      await db.query(asUser(superAdmin), 'select public.reject_membership_request($1, $2)', [
        requestId,
        'Organisation non reconnue',
      ]);
      const request = await db.queryOne<{ status: string; decision_note: string }>(
        OWNER,
        'select status, decision_note from public.membership_requests where id = $1',
        [requestId],
      );
      expect(request).toEqual({ status: 'rejected', decision_note: 'Organisation non reconnue' });
    });
  });

  describe('création d’organisation à la validation', () => {
    it('crée l’organisation demandée avec l’identifiant fourni', async () => {
      const candidate = await createAccount(db, 'fondateur@gouv.test');
      const requestId = await createRequest(db, candidate, 'fondateur@gouv.test', {
        organisationName: 'Association Nouvelle',
        role: 'admin',
      });

      const result = await db.queryOne<{ org: string }>(
        asUser(superAdmin),
        `select public.approve_membership_request($1, 'admin', '{}', 'association-nouvelle') as org`,
        [requestId],
      );

      const org = await db.queryOne<{ slug: string; name: string }>(
        OWNER,
        'select slug, name from public.organisations where id = $1',
        [result!.org],
      );
      expect(org).toEqual({ slug: 'association-nouvelle', name: 'Association Nouvelle' });
    });

    it('refuse la création sans identifiant d’organisation', async () => {
      const candidate = await createAccount(db, 'sans-slug@gouv.test');
      const requestId = await createRequest(db, candidate, 'sans-slug@gouv.test', {
        organisationName: 'Sans identifiant',
      });
      const error = await expectError(
        db.query(asUser(superAdmin), `select public.approve_membership_request($1, 'admin')`, [
          requestId,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('PT400');
    });
  });
});

describe('droit à l’effacement', () => {
  let db: TestDb;
  let orgId: string;
  let admin: string;
  let editor: string;
  let survey: string;

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-erase', 'Organisation effacement');
    admin = await createAccount(db, 'admin@erase.test');
    editor = await createAccount(db, 'editor@erase.test');
    await activateMember(db, admin, orgId, 'admin');
    await activateMember(db, editor, orgId, 'editor');
    survey = await createSurvey(db, {
      organisationId: orgId,
      slug: 'avec-email',
      dedupField: 'email',
    });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('une personne concernée dépose une demande sans compte', async () => {
    const rows = await db.query<{ id: string }>(
      ANON,
      'select public.request_erasure($1, $2, $3) as id',
      [survey, 'marie@exemple.test', 'Je retire mon inscription'],
    );
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuse une demande sans identifiant ou sur un sondage inconnu', async () => {
    expect(
      sqlErrorCode(
        await expectError(
          db.query(ANON, 'select public.request_erasure($1, $2, null)', [survey, '   ']),
        ),
      ),
    ).toBe('PT400');

    expect(
      sqlErrorCode(
        await expectError(
          db.query(ANON, 'select public.request_erasure($1, $2, null)', [
            '00000000-0000-0000-0000-000000000000',
            'x@y.test',
          ]),
        ),
      ),
    ).toBe('PT404');
  });

  it("efface logiquement les réponses de la personne, et seulement les siennes", async () => {
    await db.query(ANON, 'select public.submit_survey_response($1, $2::jsonb, false, null, $3)', [
      survey,
      JSON.stringify({ email: 'paul@exemple.test' }),
      'paul@exemple.test',
    ]);
    await db.query(ANON, 'select public.submit_survey_response($1, $2::jsonb, false, null, $3)', [
      survey,
      JSON.stringify({ email: 'autre@exemple.test' }),
      'autre@exemple.test',
    ]);

    const requestId = (
      await db.query<{ id: string }>(ANON, 'select public.request_erasure($1, $2, null) as id', [
        survey,
        'PAUL@exemple.test',
      ])
    )[0]!.id;

    const affected = await db.queryOne<{ n: number }>(
      asUser(admin),
      'select public.apply_erasure($1, false) as n',
      [requestId],
    );
    expect(affected?.n).toBe(1);

    const live = await db.query<{ data: { email: string } }>(
      OWNER,
      'select data from public.survey_responses where survey_id = $1 and deleted_at is null',
      [survey],
    );
    expect(live.map((r) => r.data.email)).toEqual(['autre@exemple.test']);

    const request = await db.queryOne<{ status: string; affected_rows: number }>(
      OWNER,
      'select status, affected_rows from public.erasure_requests where id = $1',
      [requestId],
    );
    expect(request).toEqual({ status: 'done', affected_rows: 1 });
  });

  it('un editor ne peut pas exécuter un effacement', async () => {
    const requestId = (
      await db.query<{ id: string }>(ANON, 'select public.request_erasure($1, $2, null) as id', [
        survey,
        'autre@exemple.test',
      ])
    )[0]!.id;

    const error = await expectError(
      db.query(asUser(editor), 'select public.apply_erasure($1, false)', [requestId]),
    );
    expect(sqlErrorCode(error)).toBe('PT403');
  });

  it('permet un effacement définitif tracé', async () => {
    const requestId = (
      await db.query<{ id: string }>(ANON, 'select public.request_erasure($1, $2, null) as id', [
        survey,
        'autre@exemple.test',
      ])
    )[0]!.id;

    const affected = await db.queryOne<{ n: number }>(
      asUser(admin),
      'select public.apply_erasure($1, true) as n',
      [requestId],
    );
    expect(affected?.n).toBe(1);

    const remaining = await db.query(
      OWNER,
      `select id from public.survey_responses
        where survey_id = $1 and dedup_key = app.dedup_hash($1, 'autre@exemple.test')`,
      [survey],
    );
    expect(remaining).toEqual([]);

    const audit = await db.query<{ action: string }>(
      OWNER,
      "select action from public.audit_log where action = 'erasure.applied' and target_id = $1",
      [requestId],
    );
    expect(audit).toHaveLength(1);
  });
});

describe('purges de conservation', () => {
  let db: TestDb;
  let orgId: string;
  let admin: string;
  let superAdmin: string;
  let survey: string;

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-purge', 'Organisation purge');
    admin = await createAccount(db, 'admin@purge.test');
    superAdmin = await createAccount(db, 'super@purge.test');
    await activateMember(db, admin, orgId, 'admin');
    await activateMember(db, superAdmin, null, 'super_admin');
    survey = await createSurvey(db, { organisationId: orgId, slug: 'a-purger' });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('efface les réponses dont la conservation est écoulée', async () => {
    const expired = await insertResponse(db, survey, { q: 'vieux' });
    const fresh = await insertResponse(db, survey, { q: 'récent' });
    await db.query(
      OWNER,
      "update public.survey_responses set purge_after = now() - interval '1 day' where id = $1",
      [expired],
    );

    const purged = await db.queryOne<{ n: number }>(
      asUser(superAdmin),
      'select public.purge_expired_responses() as n',
    );
    expect(purged?.n).toBe(1);

    const remaining = await db.query<{ id: string }>(
      OWNER,
      'select id from public.survey_responses where survey_id = $1',
      [survey],
    );
    expect(remaining.map((r) => r.id)).toEqual([fresh]);
  });

  it('efface définitivement les réponses supprimées au-delà du délai de grâce', async () => {
    const old = await insertResponse(db, survey, { q: 'corbeille' });
    await db.query(
      OWNER,
      "update public.survey_responses set deleted_at = now() - interval '31 days' where id = $1",
      [old],
    );
    const recent = await insertResponse(db, survey, { q: 'corbeille récente' });
    await db.query(OWNER, 'update public.survey_responses set deleted_at = now() where id = $1', [
      recent,
    ]);

    const purged = await db.queryOne<{ n: number }>(
      asUser(superAdmin),
      'select public.purge_expired_responses() as n',
    );
    expect(purged?.n).toBe(1);

    const still = await db.query(OWNER, 'select id from public.survey_responses where id = $1', [
      recent,
    ]);
    expect(still).toHaveLength(1);
  });

  it('est idempotente : un second appel ne supprime rien', async () => {
    const purged = await db.queryOne<{ n: number }>(
      asUser(superAdmin),
      'select public.purge_expired_responses() as n',
    );
    expect(purged?.n).toBe(0);
  });

  it('purge les sondages supprimés au-delà du délai de grâce', async () => {
    const doomed = await createSurvey(db, { organisationId: orgId, slug: 'sondage-supprime' });
    await db.query(
      OWNER,
      "update public.surveys set deleted_at = now() - interval '31 days' where id = $1",
      [doomed],
    );

    const purged = await db.queryOne<{ n: number }>(
      asUser(superAdmin),
      'select public.purge_deleted_surveys() as n',
    );
    expect(purged?.n).toBe(1);
  });

  it("n'est pas exécutable par un admin d'organisation", async () => {
    expect(
      sqlErrorCode(await expectError(db.query(asUser(admin), 'select public.purge_expired_responses()'))),
    ).toBe('PT403');
    expect(
      sqlErrorCode(await expectError(db.query(asUser(admin), 'select public.purge_deleted_surveys()'))),
    ).toBe('PT403');
  });

  it('est exécutable en contexte serveur de confiance (cron)', async () => {
    const purged = await db.queryOne<{ n: number }>(
      OWNER,
      'select public.purge_expired_responses() as n',
    );
    expect(purged?.n).toBe(0);
  });
});
