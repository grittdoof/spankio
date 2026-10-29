import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as readDelta, POST as setCheckin } from '@/app/api/checkin/[id]/route';
import { createTestDb, type TestDb } from '../helpers/db';
import {
  createRouteHarness,
  jsonRequest,
  readJson,
  type ApiError,
  type RouteHarness,
} from '../helpers/route';
import { insertResponse, seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * La route de pointage, exécutée POUR DE VRAI contre les vraies policies.
 *
 * C'est le chemin qui portera les arrivées d'une soirée. Les tests unitaires
 * disent ce que l'écran montre ; ceux-ci disent ce que la base accepte, et
 * surtout ce qu'elle refuse.
 */

type Params = { params: Promise<{ id: string }> };

function params(id: string): Params {
  return { params: Promise.resolve({ id }) };
}

describe('routes du poste d’accueil', () => {
  let db: TestDb;
  let api: RouteHarness;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    db = await createTestDb();
    api = createRouteHarness(db);
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  async function post(
    surveyId: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    return readJson(
      await setCheckin(
        jsonRequest('POST', `/api/checkin/${surveyId}`, body),
        params(surveyId),
      ),
    );
  }

  interface StateBody {
    response_id?: string;
    responseId: string;
    arrivedAt: string | null;
    peopleIn: number | null;
    version: number;
    replayed: boolean;
  }

  describe('ce qu’une hôtesse affectée peut faire', () => {
    it('pointe une arrivée, et reçoit l’état ÉCRIT', async () => {
      api.actAs(a.host);
      const { status, body } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: 0,
        peopleIn: null,
      });

      expect(status).toBe(200);
      const state = body as StateBody;
      // L'écran affiche ce que la base CONTIENT, jamais ce qu'il espérait y
      // mettre : la route rend donc l'état, pas un booléen.
      expect(state.arrivedAt).not.toBeNull();
      expect(state.version).toBe(1);
      expect(state.replayed).toBe(false);
    });

    it('rejoue le même op_id sans erreur et sans seconde transition', async () => {
      api.actAs(a.host);
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Rejeu' });
      const opId = randomUUID();

      const first = await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId,
        expectedVersion: 0,
        peopleIn: 2,
      });
      const second = await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId,
        expectedVersion: 0,
        peopleIn: 99,
      });

      expect(first.status).toBe(200);
      // Un réessai après un réseau coupé n'est PAS une faute : 200, et l'état
      // courant. Un 409 ferait clignoter un refus sur un pointage réussi.
      expect(second.status).toBe(200);
      const replayed = second.body as StateBody;
      expect(replayed.replayed).toBe(true);
      expect(replayed.version).toBe(1);
      // Le rejeu ne RÉAPPLIQUE rien : 99 n'est pas écrit.
      expect(replayed.peopleIn).toBe(2);
    });

    it('refuse une version périmée, et le dit en 409', async () => {
      api.actAs(a.host);
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Concurrence' });

      await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: 0,
        peopleIn: null,
      });

      const stale = await post(a.eventSurvey, {
        responseId: response,
        arrived: false,
        opId: randomUUID(),
        expectedVersion: 0,
        peopleIn: null,
      });

      expect(stale.status).toBe(409);
      expect((stale.body as ApiError).error.code).toBe('conflict');
    });

    it('lit le delta de SON événement', async () => {
      api.actAs(a.host);
      const { status, body } = await readJson<{ states: StateBody[]; at: string }>(
        await readDelta(
          jsonRequest('GET', `/api/checkin/${a.eventSurvey}`),
          params(a.eventSurvey),
        ),
      );

      expect(status).toBe(200);
      expect(body.states.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    });

    it('ne rend, depuis un curseur, que ce qui a bougé après lui', async () => {
      api.actAs(a.host);
      const future = new Date(Date.now() + 60_000).toISOString();
      const { body } = await readJson<{ states: StateBody[] }>(
        await readDelta(
          jsonRequest('GET', `/api/checkin/${a.eventSurvey}?depuis=${encodeURIComponent(future)}`),
          params(a.eventSurvey),
        ),
      );
      expect(body.states).toEqual([]);
    });
  });

  describe('ce que la route refuse', () => {
    it('refuse un visiteur sans session', async () => {
      api.actAsAnonymous();
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: null,
        peopleIn: null,
      });
      expect(status).toBe(401);
    });

    it('refuse un compte d’accueil SANS affectation', async () => {
      // Le rôle seul n'ouvre rien : c'est l'affectation qui ouvre, et ce test
      // est le seul à distinguer les deux.
      api.actAs(a.idleHost);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: null,
        peopleIn: null,
      });
      expect(status).toBe(403);
    });

    it('refuse l’hôtesse d’une AUTRE organisation', async () => {
      api.actAs(b.host);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: null,
        peopleIn: null,
      });
      // Isolation : la réponse de A n'existe pas pour l'hôtesse de B.
      expect([403, 404]).toContain(status);
    });

    it('ne laisse pas voir le delta d’un événement non affecté', async () => {
      api.actAs(b.host);
      const { body } = await readJson<{ states: StateBody[] }>(
        await readDelta(
          jsonRequest('GET', `/api/checkin/${a.eventSurvey}`),
          params(a.eventSurvey),
        ),
      );
      // Le RLS masque : la liste est vide, et non « interdite » — un refus
      // confirmerait l'existence de l'événement.
      expect(body.states).toEqual([]);
    });

    it('efface l’effectif avec l’arrivée plutôt que de le refuser', async () => {
      api.actAs(a.host);
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Incohérent' });
      const { status, body } = await post(a.eventSurvey, {
        responseId: response,
        arrived: false,
        opId: randomUUID(),
        expectedVersion: 0,
        peopleIn: 3,
      });

      // Un nombre d'entrants SANS entrée ne veut rien dire, et la contrainte de
      // table le refuserait. Plutôt que de renvoyer une erreur sur une
      // incohérence que le serveur sait trancher, la fonction efface
      // l'effectif en même temps que l'arrivée.
      expect(status).toBe(200);
      expect((body as StateBody).arrivedAt).toBeNull();
      expect((body as StateBody).peopleIn).toBeNull();
    });

    it('refuse un identifiant d’opération qui n’est pas un UUID', async () => {
      api.actAs(a.host);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: 'pas-un-uuid',
        expectedVersion: null,
        peopleIn: null,
      });
      expect(status).toBe(400);
    });

    it('refuse un effectif hors des bornes de la colonne', async () => {
      api.actAs(a.host);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: null,
        peopleIn: 5000,
      });
      expect(status).toBe(400);
    });
  });
});
