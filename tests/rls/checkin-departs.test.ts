import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON, OWNER, asUser, createTestDb, expectError, sqlErrorCode, type Actor, type TestDb } from '../helpers/db';
import { insertResponse, seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * L'INVITÉ DE DERNIÈRE MINUTE ET LE CADEAU AU DÉPART.
 *
 * Deux portes, et les mêmes trois questions que pour l'arrivée : un réessai
 * ne double rien, deux postes concurrents ne s'écrasent pas, et personne
 * n'écrit autrement que par la porte. S'y ajoute ce qui est propre à l'ajout
 * de porte : aucune preuve de consentement fabriquée, et une origine que rien
 * ne peut requalifier — pas même une correction.
 */

interface State {
  response_id: string;
  seat: number;
  arrived_at: string | null;
  gift_at: string | null;
  version: number;
  replayed: boolean;
}

interface Walkin extends State {
  submitted_at: string;
  data: Record<string, string>;
}

const SCHEMA = {
  steps: [
    {
      id: 'identite',
      title: 'Identité',
      fields: [
        { id: 'nom', type: 'text', label: 'Nom', required: true },
        { id: 'prenom', type: 'text', label: 'Prénom', required: false },
        { id: 'societe', type: 'text', label: 'Société', required: false },
      ],
    },
  ],
};

describe('départs et invités de dernière minute', () => {
  let db: TestDb;
  let a: Tenant;
  let b: Tenant;

  async function gift(
    actor: Actor,
    responseId: string,
    given: boolean,
    expectedVersion: number | null,
    opts: { opId?: string; seat?: number } = {},
  ): Promise<State> {
    const row = await db.queryOne<{ etat: State }>(
      actor,
      `select public.set_checkin($1, $2, $3, $4, $5, 'gift') as etat`,
      [responseId, opts.seat ?? 0, given, opts.opId ?? randomUUID(), expectedVersion],
    );
    return row!.etat;
  }

  async function arrive(actor: Actor, responseId: string, expectedVersion: number | null): Promise<State> {
    const row = await db.queryOne<{ etat: State }>(
      actor,
      // Appel à CINQ arguments, comme le code déjà en production : la
      // migration ne doit pas couper le poste entre son application et le
      // déploiement qui l'exploite.
      'select public.set_checkin($1, $2, $3, $4, $5) as etat',
      [responseId, 0, true, randomUUID(), expectedVersion],
    );
    return row!.etat;
  }

  function walkinCall(actor: Actor, data: unknown, opId: string = randomUUID(), survey?: string) {
    return db.query<{ etat: Walkin }>(actor, 'select public.add_walkin($1, $2, $3) as etat', [
      survey ?? a.eventSurvey,
      JSON.stringify(data),
      opId,
    ]);
  }

  async function addWalkin(actor: Actor, data: unknown, opId: string = randomUUID()): Promise<Walkin> {
    const rows = await walkinCall(actor, data, opId);
    return rows[0]!.etat;
  }

  async function freshResponse(): Promise<string> {
    return insertResponse(db, a.eventSurvey, { nom: `Invité ${randomUUID().slice(0, 8)}` });
  }

  beforeAll(async () => {
    db = await createTestDb();
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;
    await db.query(OWNER, 'update public.surveys set schema = $1 where id in ($2, $3)', [
      JSON.stringify(SCHEMA),
      a.eventSurvey,
      b.eventSurvey,
    ]);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  // --------------------------------------------------------------------------
  describe('cadeau', () => {
    it('un cadeau se remet sans toucher à l’arrivée', async () => {
      const response = await freshResponse();
      const arrived = await arrive(asUser(a.host), response, 0);
      const given = await gift(asUser(a.host), response, true, 1);

      expect(given.gift_at).not.toBeNull();
      expect(given.arrived_at).toBe(arrived.arrived_at);
      expect(given.version).toBe(2);
    });

    it('dé-pointer l’arrivée ne retire pas le cadeau, et l’inverse', async () => {
      const response = await freshResponse();
      await arrive(asUser(a.host), response, 0);
      await gift(asUser(a.host), response, true, 1);

      const unarrived = await db.queryOne<{ etat: State }>(
        asUser(a.host),
        'select public.set_checkin($1, 0, false, $2, 2) as etat',
        [response, randomUUID()],
      );
      expect(unarrived!.etat.arrived_at).toBeNull();
      expect(unarrived!.etat.gift_at).not.toBeNull();

      const ungift = await gift(asUser(a.host), response, false, 3);
      expect(ungift.gift_at).toBeNull();
    });

    it('un cadeau remis à quelqu’un qu’on a oublié de pointer est enregistré, sans inventer d’arrivée', async () => {
      const response = await freshResponse();
      const given = await gift(asUser(a.host), response, true, 0);
      expect(given.gift_at).not.toBeNull();
      expect(given.arrived_at).toBeNull();
    });

    it('redonner un cadeau garde l’heure de la première remise', async () => {
      const response = await freshResponse();
      const first = await gift(asUser(a.host), response, true, 0);
      const again = await gift(asUser(a.host), response, true, 1);
      expect(again.gift_at).toBe(first.gift_at);
    });

    it('le cadeau est par SIÈGE : celui de l’accompagnant ne touche pas l’hôte', async () => {
      const response = await freshResponse();
      await gift(asUser(a.host), response, true, 0, { seat: 1 });
      const host = await db.queryOne<{ gift_at: string | null }>(
        OWNER,
        'select gift_at from public.event_checkins where response_id = $1 and seat = 0',
        [response],
      );
      expect(host).toBeUndefined();
    });

    it('la version est partagée par les deux gestes : un cadeau sur une ligne périmée est refusé', async () => {
      const response = await freshResponse();
      await arrive(asUser(a.host), response, 0);
      const error = await expectError(
        db.query(asUser(a.host), `select public.set_checkin($1, 0, true, $2, 0, 'gift')`, [
          response,
          randomUUID(),
        ]),
      );
      expect(sqlErrorCode(error)).toBe('PT409');
    });

    it('le même op_id rejoué ne remet pas deux fois', async () => {
      const response = await freshResponse();
      const opId = randomUUID();
      await gift(asUser(a.host), response, true, 0, { opId });
      const replay = await gift(asUser(a.host), response, true, 0, { opId });
      expect(replay.replayed).toBe(true);
      const log = await db.query<{ action: string }>(
        OWNER,
        'select action from public.event_checkin_log where response_id = $1',
        [response],
      );
      expect(log.map((row) => row.action)).toEqual(['gift']);
    });

    it('un geste inconnu est refusé', async () => {
      const response = await freshResponse();
      const error = await expectError(
        db.query(asUser(a.host), `select public.set_checkin($1, 0, true, $2, 0, 'cadeau')`, [
          response,
          randomUUID(),
        ]),
      );
      expect(sqlErrorCode(error)).toBe('22023');
    });

    it('un host de B ne remet pas de cadeau à un invité de A', async () => {
      const response = await freshResponse();
      const error = await expectError(
        db.query(asUser(b.host), `select public.set_checkin($1, 0, true, $2, 0, 'gift')`, [
          response,
          randomUUID(),
        ]),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('une seule signature exposée : l’ancienne porte à cinq arguments a disparu', async () => {
      const rows = await db.query<{ args: string }>(
        OWNER,
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'set_checkin'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.args).toContain('p_kind');
    });
  });

  // --------------------------------------------------------------------------
  describe('invité de dernière minute', () => {
    it('le host affecté ajoute quelqu’un, déjà arrivé, sur le siège 0', async () => {
      const added = await addWalkin(asUser(a.host), {
        nom: 'Martin',
        prenom: 'Lucie',
        societe: 'Atelier Martin',
      });

      expect(added.replayed).toBe(false);
      expect(added.seat).toBe(0);
      expect(added.arrived_at).not.toBeNull();
      expect(added.version).toBe(1);
      expect(added.data).toEqual({ nom: 'Martin', prenom: 'Lucie', societe: 'Atelier Martin' });
    });

    it('aucune preuve de consentement n’est fabriquée, et l’origine le dit', async () => {
      const added = await addWalkin(asUser(a.host), { nom: 'Sans consentement' });
      const row = await db.queryOne<{
        origin: string;
        consent_given: boolean;
        consent_text: string | null;
        dedup_key: string | null;
      }>(
        OWNER,
        'select origin, consent_given, consent_text, dedup_key from public.survey_responses where id = $1',
        [added.response_id],
      );
      expect(row).toEqual({
        origin: 'desk',
        consent_given: false,
        consent_text: null,
        dedup_key: null,
      });
    });

    it('le journal dit « ajouté à l’entrée », par le poste', async () => {
      const added = await addWalkin(asUser(a.host), { nom: 'Journalisé' });
      const log = await db.queryOne<{ action: string; source: string; arrived: boolean; seat: number }>(
        OWNER,
        'select action, source, arrived, seat from public.event_checkin_log where response_id = $1',
        [added.response_id],
      );
      expect(log).toEqual({ action: 'walkin', source: 'desk', arrived: true, seat: 0 });
    });

    it('un réessai avec le même op_id ne crée pas d’homonyme', async () => {
      const opId = randomUUID();
      const first = await addWalkin(asUser(a.host), { nom: 'Réessai' }, opId);
      const second = await addWalkin(asUser(a.host), { nom: 'Réessai' }, opId);

      expect(second.replayed).toBe(true);
      expect(second.response_id).toBe(first.response_id);
      const rows = await db.query(
        OWNER,
        `select id from public.survey_responses where survey_id = $1 and data->>'nom' = 'Réessai'`,
        [a.eventSurvey],
      );
      expect(rows).toHaveLength(1);
    });

    it('une clé absente du schéma est refusée : ce chemin ne range pas un document dans data', async () => {
      const error = await expectError(walkinCall(asUser(a.host), { nom: 'X', commentaire: 'Y' }));
      expect(sqlErrorCode(error)).toBe('22023');
    });

    it('une valeur non textuelle, trop longue, ou des champs tous vides sont refusés', async () => {
      for (const data of [
        { nom: 42 },
        { nom: 'x'.repeat(201) },
        { nom: '   ', prenom: '' },
        ['nom'],
      ]) {
        const error = await expectError(walkinCall(asUser(a.host), data));
        expect(sqlErrorCode(error)).toBe('22023');
      }
    });

    it('un host de B ne peut pas ajouter à l’événement de A : introuvable, pas refusé', async () => {
      const error = await expectError(walkinCall(asUser(b.host), { nom: 'Intrus' }));
      expect(sqlErrorCode(error)).toBe('PT404');
    });

    it('un host sans affectation et un viewer ne peuvent rien ajouter', async () => {
      for (const actor of [asUser(a.idleHost), asUser(a.viewer)]) {
        const error = await expectError(walkinCall(actor, { nom: 'Refusé' }));
        expect(sqlErrorCode(error)).toBe('PT404');
      }
    });

    it('un visiteur anonyme ne peut pas même appeler la fonction', async () => {
      const error = await expectError(
        db.query(ANON, 'select public.add_walkin($1, $2, $3)', [
          a.eventSurvey,
          JSON.stringify({ nom: 'Anonyme' }),
          randomUUID(),
        ]),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('l’administrateur peut ajouter aussi, et la source dit « admin »', async () => {
      const added = await addWalkin(asUser(a.admin), { nom: 'Ajouté par l’admin' });
      const log = await db.queryOne<{ source: string }>(
        OWNER,
        'select source from public.event_checkin_log where response_id = $1',
        [added.response_id],
      );
      expect(log?.source).toBe('admin');
    });

    it('on lui remet un cadeau comme à n’importe quel invité', async () => {
      const added = await addWalkin(asUser(a.host), { nom: 'Cadeau' });
      const given = await gift(asUser(a.host), added.response_id, true, added.version);
      expect(given.gift_at).not.toBeNull();
      expect(given.arrived_at).toBe(added.arrived_at);
    });

    it('l’origine est immuable', async () => {
      const added = await addWalkin(asUser(a.host), { nom: 'Immuable' });
      const error = await expectError(
        db.query(OWNER, `update public.survey_responses set origin = 'form' where id = $1`, [
          added.response_id,
        ]),
      );
      expect(sqlErrorCode(error)).toBe('42501');
    });

    it('une correction PRÉSERVE l’origine et emporte l’arrivée', async () => {
      const added = await addWalkin(asUser(a.host), { nom: 'Martn' });
      const corrected = await db.queryOne<{ id: string }>(
        asUser(a.admin),
        'select public.correct_survey_response($1, $2) as id',
        [added.response_id, JSON.stringify({ nom: 'Martin' })],
      );
      const row = await db.queryOne<{ origin: string }>(
        OWNER,
        'select origin from public.survey_responses where id = $1',
        [corrected!.id],
      );
      expect(row?.origin).toBe('desk');

      const state = await db.queryOne<{ arrived_at: string | null }>(
        OWNER,
        'select arrived_at from public.event_checkins where response_id = $1 and seat = 0',
        [corrected!.id],
      );
      expect(state?.arrived_at).not.toBeNull();
    });

    it('une inscription du formulaire reste « form » par défaut', async () => {
      const response = await freshResponse();
      const row = await db.queryOne<{ origin: string }>(
        OWNER,
        'select origin from public.survey_responses where id = $1',
        [response],
      );
      expect(row?.origin).toBe('form');
    });
  });
});
