import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER, asUser, createTestDb, expectError, sqlErrorCode, type Actor, type TestDb } from '../helpers/db';
import { assignStaff, insertResponse, seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * POINTAGE DES ARRIVÉES — lot 2 du module « Accueil ».
 *
 * Ce fichier vérifie trois choses qu'aucune relecture ne peut garantir :
 *
 *  1. l'IDEMPOTENCE — un réessai après un réseau coupé ne re-bascule pas
 *     l'invité ;
 *  2. la CONCURRENCE — deux hôtesses sur la même rangée, une seule gagne, et
 *     la perdante l'apprend ;
 *  3. l'IMPOSSIBILITÉ d'écrire autrement que par la porte.
 *
 * Les deux premières sont exactement les pannes d'une soirée : du réseau qui
 * tombe, et plusieurs personnes au même endroit.
 */

interface CheckinState {
  response_id: string;
  arrived_at: string | null;
  people_in: number | null;
  version: number;
  by_profile: string | null;
  replayed: boolean;
}

describe('pointage des arrivées', () => {
  let db: TestDb;
  let a: Tenant;
  let b: Tenant;

  /** Appelle la porte et rend l'état écrit. */
  async function setCheckin(
    actor: Actor,
    responseId: string,
    arrived: boolean,
    expectedVersion: number | null,
    opts: { opId?: string; peopleIn?: number | null } = {},
  ): Promise<CheckinState> {
    const row = await db.queryOne<{ etat: CheckinState }>(
      actor,
      'select public.set_checkin($1, $2, $3, $4, $5) as etat',
      [responseId, arrived, opts.opId ?? randomUUID(), expectedVersion, opts.peopleIn ?? null],
    );
    return row!.etat;
  }

  function call(
    actor: Actor,
    responseId: string,
    arrived: boolean,
    expectedVersion: number | null,
    opts: { opId?: string; peopleIn?: number | null } = {},
  ): Promise<unknown> {
    return db.query(
      actor,
      'select public.set_checkin($1, $2, $3, $4, $5) as etat',
      [responseId, arrived, opts.opId ?? randomUUID(), expectedVersion, opts.peopleIn ?? null],
    );
  }

  /** Une réponse neuve sur l'événement de A : chaque test part d'un état vierge. */
  async function freshResponse(): Promise<string> {
    return insertResponse(db, a.eventSurvey, { nom: `Invité ${randomUUID().slice(0, 8)}` });
  }

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
  describe('idempotence', () => {
    /**
     * LE test du lot. Le téléphone envoie, perd le réseau avant la réponse,
     * réessaie avec le même `op_id`. Sans idempotence, le second appel
     * re-bascule l'invité et l'efface — un présent qui redevient absent tout
     * seul, et personne ne comprend pourquoi.
     */
    it('le même op_id rejoué ne produit qu’une seule transition', async () => {
      const response = await freshResponse();
      const opId = randomUUID();

      const first = await setCheckin(asUser(a.host), response, true, 0, { opId });
      const second = await setCheckin(asUser(a.host), response, true, 0, { opId });

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.version).toBe(first.version);
      expect(second.arrived_at).toBe(first.arrived_at);

      const log = await db.query(
        OWNER,
        'select id from public.event_checkin_log where response_id = $1',
        [response],
      );
      expect(log).toHaveLength(1);
    });

    it('un op_id rejoué ne rend pas un refus : c’est un réessai, pas une faute', async () => {
      const response = await freshResponse();
      const opId = randomUUID();
      await setCheckin(asUser(a.host), response, true, 0, { opId });

      // La version a bougé ; rejouer avec l'ancienne ne doit PAS lever PT409,
      // puisque l'opération est déjà enregistrée.
      const replay = await setCheckin(asUser(a.host), response, true, 0, { opId });
      expect(replay.replayed).toBe(true);
      expect(replay.version).toBe(1);
    });

    it('deux op_id distincts produisent bien deux transitions', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);
      const second = await setCheckin(asUser(a.host), response, false, 1);

      expect(second.version).toBe(2);
      expect(second.arrived_at).toBeNull();

      const log = await db.query(
        OWNER,
        'select id from public.event_checkin_log where response_id = $1',
        [response],
      );
      expect(log).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  describe('concurrence', () => {
    it('une version périmée est refusée', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);

      // Seconde hôtesse, qui croit encore la ligne à 0.
      const error = await expectError(call(asUser(a.admin), response, false, 0));
      expect(sqlErrorCode(error)).toBe('PT409');
    });

    it('un refus de version ne laisse aucune trace', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);
      await expectError(call(asUser(a.admin), response, false, 0));

      const row = await db.queryOne<{ version: number; arrived_at: string | null }>(
        OWNER,
        'select version, arrived_at from public.event_checkins where response_id = $1',
        [response],
      );
      expect(row?.version).toBe(1);
      expect(row?.arrived_at).not.toBeNull();

      const log = await db.query(
        OWNER,
        'select id from public.event_checkin_log where response_id = $1',
        [response],
      );
      expect(log).toHaveLength(1);
    });

    it('une version nulle passe outre le contrôle, délibérément', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);
      const forced = await setCheckin(asUser(a.admin), response, false, null);
      expect(forced.version).toBe(2);
      expect(forced.arrived_at).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  describe('sémantique de l’état', () => {
    it('une première arrivée crée la ligne en version 1', async () => {
      const response = await freshResponse();
      const state = await setCheckin(asUser(a.host), response, true, 0);
      expect(state.version).toBe(1);
      expect(state.arrived_at).not.toBeNull();
      expect(state.by_profile).toBe(a.host);
    });

    it('repointer quelqu’un ne le fait pas arriver une seconde fois', async () => {
      const response = await freshResponse();
      const first = await setCheckin(asUser(a.host), response, true, 0);
      const again = await setCheckin(asUser(a.host), response, true, 1);

      expect(again.arrived_at).toBe(first.arrived_at);
      expect(again.version).toBe(2);
    });

    it('un dé-pointage efface l’effectif avec l’arrivée', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0, { peopleIn: 3 });
      const off = await setCheckin(asUser(a.host), response, false, 1);

      expect(off.arrived_at).toBeNull();
      expect(off.people_in).toBeNull();
    });

    it('l’effectif réellement entré est conservé tel quel', async () => {
      const response = await freshResponse();
      const state = await setCheckin(asUser(a.host), response, true, 0, { peopleIn: 1 });
      expect(state.people_in).toBe(1);
    });

    it('un effectif non précisé reste null, jamais zéro', async () => {
      const response = await freshResponse();
      const state = await setCheckin(asUser(a.host), response, true, 0);
      expect(state.people_in).toBeNull();
    });

    it('la contrainte refuse un effectif sans arrivée, même au propriétaire', async () => {
      const response = await freshResponse();
      const error = await expectError(
        db.query(
          OWNER,
          `insert into public.event_checkins (response_id, survey_id, organisation_id, people_in)
           values ($1, $2, $3, 2)`,
          [response, a.eventSurvey, a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('23514');
    });
  });

  // --------------------------------------------------------------------------
  describe('droits', () => {
    it('le host affecté pointe, et la source dit « desk »', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);
      const log = await db.queryOne<{ source: string }>(
        OWNER,
        'select source from public.event_checkin_log where response_id = $1',
        [response],
      );
      expect(log?.source).toBe('desk');
    });

    it('l’administrateur pointe aussi, et la source dit « admin »', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.admin), response, true, 0);
      const log = await db.queryOne<{ source: string }>(
        OWNER,
        'select source from public.event_checkin_log where response_id = $1',
        [response],
      );
      expect(log?.source).toBe('admin');
    });

    it('la source n’est pas transmise : un poste ne peut pas se déclarer admin', async () => {
      // La signature ne comporte aucun paramètre de source — ce test fige
      // cette absence, qui est la raison pour laquelle elle n'est pas forgeable.
      const args = await db.queryOne<{ args: string }>(
        OWNER,
        `select pg_get_function_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'set_checkin'`,
      );
      expect(args?.args).not.toContain('source');
    });

    it('un viewer ne pointe pas', async () => {
      const response = await freshResponse();
      const error = await expectError(call(asUser(a.viewer), response, true, 0));
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('un host SANS affectation ne pointe pas', async () => {
      const response = await freshResponse();
      const error = await expectError(call(asUser(a.idleHost), response, true, 0));
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('un host de B ne pointe pas un invité de A', async () => {
      const response = await freshResponse();
      const error = await expectError(call(asUser(b.host), response, true, 0));
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('une affectation expirée ne pointe plus', async () => {
      const response = await freshResponse();
      await assignStaff(db, a.eventSurvey, a.host, a.organisationId, '2020-01-01T00:00:00Z');
      try {
        const error = await expectError(call(asUser(a.host), response, true, 0));
        expect(sqlErrorCode(error)).toBe('42501');
      } finally {
        await assignStaff(db, a.eventSurvey, a.host, a.organisationId, null);
      }
    });

    it('une réponse supprimée est introuvable, pas refusée', async () => {
      const response = await freshResponse();
      await db.query(
        OWNER,
        'update public.survey_responses set deleted_at = now() where id = $1',
        [response],
      );
      const error = await expectError(call(asUser(a.host), response, true, 0));
      expect(sqlErrorCode(error)).toBe('PT404');
    });

    it('le module retiré referme la porte', async () => {
      const response = await freshResponse();
      await db.query(
        OWNER,
        `update public.organisation_modules set enabled = false
          where organisation_id = $1 and module_key = 'checkin'`,
        [a.organisationId],
      );
      try {
        const error = await expectError(call(asUser(a.host), response, true, 0));
        expect(sqlErrorCode(error)).toBe('42501');
      } finally {
        await db.query(
          OWNER,
          `update public.organisation_modules set enabled = true
            where organisation_id = $1 and module_key = 'checkin'`,
          [a.organisationId],
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  describe('aucune écriture hors de la porte', () => {
    it.each([
      ['admin', (t: Tenant) => t.admin],
      ['host', (t: Tenant) => t.host],
    ])('le %s ne peut pas insérer un pointage directement', async (_label, pick) => {
      const response = await freshResponse();
      const error = await expectError(
        db.query(
          asUser(pick(a)),
          `insert into public.event_checkins (response_id, survey_id, organisation_id, arrived_at)
           values ($1, $2, $3, now())`,
          [response, a.eventSurvey, a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    /**
     * Le refus arrive PLUS TÔT qu'une policy : `event_checkins` n'accorde que
     * `select` à `authenticated`, donc PostgreSQL refuse la table entière au
     * lieu de filtrer les lignes. C'est la différence entre « aucune ligne ne
     * te concerne » et « cette table ne t'est pas ouverte en écriture », et
     * c'est la seconde qu'on veut ici.
     */
    it('personne ne peut modifier un pointage directement', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);
      const error = await expectError(
        db.query(
          asUser(a.admin),
          'update public.event_checkins set arrived_at = null where response_id = $1',
          [response],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');

      const still = await db.queryOne<{ arrived_at: string | null }>(
        OWNER,
        'select arrived_at from public.event_checkins where response_id = $1',
        [response],
      );
      expect(still?.arrived_at).not.toBeNull();
    });

    it('le journal n’accepte aucune écriture, même d’un administrateur', async () => {
      const error = await expectError(
        db.query(
          asUser(a.admin),
          `insert into public.event_checkin_log
             (op_id, response_id, survey_id, organisation_id, arrived, source)
           values ($1, $2, $3, $4, true, 'desk')`,
          [randomUUID(), a.eventResponse, a.eventSurvey, a.organisationId],
        ),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });
  });

  // --------------------------------------------------------------------------
  describe('lecture', () => {
    it('le host affecté lit les pointages de son événement', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);
      const rows = await db.query<{ response_id: string }>(
        asUser(a.host),
        'select response_id from public.event_checkins where response_id = $1',
        [response],
      );
      expect(rows).toEqual([{ response_id: response }]);
    });

    it('les pointages de B sont invisibles depuis A', async () => {
      const responseB = await insertResponse(db, b.eventSurvey, { nom: 'Invité B' });
      await setCheckin(asUser(b.host), responseB, true, 0);

      const rows = await db.query(
        asUser(a.admin),
        'select response_id from public.event_checkins where response_id = $1',
        [responseB],
      );
      expect(rows).toEqual([]);
    });

    it('un host sans affectation ne lit aucun pointage', async () => {
      const response = await freshResponse();
      await setCheckin(asUser(a.host), response, true, 0);
      const rows = await db.query(asUser(a.idleHost), 'select response_id from public.event_checkins');
      expect(rows).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  describe('une correction ne perd pas l’arrivée', () => {
    /**
     * Défaut qui serait apparu au premier essai réel, et au pire endroit :
     * corriger une faute dans un nom aurait fait réapparaître comme ABSENT
     * quelqu'un présent dans la salle depuis une heure. Une correction n'est
     * pas une modification — c'est une suppression logique plus une copie — et
     * l'arrivée est accrochée à l'identifiant.
     */
    it('le pointage suit la copie corrigée', async () => {
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Mme Dupont' });
      const before = await setCheckin(asUser(a.host), response, true, 0, { peopleIn: 2 });

      const corrected = await db.queryOne<{ id: string }>(
        asUser(a.admin),
        `select public.correct_survey_response($1, $2::jsonb) as id`,
        [response, JSON.stringify({ nom: 'Mme Dupond' })],
      );

      const moved = await db.queryOne<{ arrived_at: string; people_in: number }>(
        OWNER,
        'select arrived_at, people_in from public.event_checkins where response_id = $1',
        [corrected!.id],
      );
      // Même INSTANT, pas même chaîne : le jsonb de la porte sérialise en UTC
      // (« …Z ») et la lecture directe de la colonne rend le décalage local
      // (« …+01:00 »). Comparer les textes ferait échouer ce test six mois par
      // an, pour une heure parfaitement identique.
      expect(new Date(moved!.arrived_at).getTime()).toBe(
        new Date(before.arrived_at!).getTime(),
      );
      expect(moved?.people_in).toBe(2);

      // Et plus rien n'est accroché à l'originale.
      const left = await db.query(
        OWNER,
        'select response_id from public.event_checkins where response_id = $1',
        [response],
      );
      expect(left).toEqual([]);
    });

    it('le journal garde l’ancien identifiant : c’est là que la transition a eu lieu', async () => {
      const response = await insertResponse(db, a.eventSurvey, { nom: 'M. Martin' });
      await setCheckin(asUser(a.host), response, true, 0);
      await db.query(
        asUser(a.admin),
        `select public.correct_survey_response($1, $2::jsonb)`,
        [response, JSON.stringify({ nom: 'M. Martín' })],
      );

      const log = await db.query(
        OWNER,
        'select id from public.event_checkin_log where response_id = $1',
        [response],
      );
      expect(log).toHaveLength(1);
    });
  });
});
