import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as readDelta, POST as setCheckin } from '@/app/api/checkin/[id]/route';
import { POST as addWalkin } from '@/app/api/checkin/[id]/invite/route';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';
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
    seat: number;
    arrivedAt: string | null;
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
        seat: 0,
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
        seat: 0,
      });
      const second = await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId,
        expectedVersion: 0,
        seat: 0,
      });

      expect(first.status).toBe(200);
      // Un réessai après un réseau coupé n'est PAS une faute : 200, et l'état
      // courant. Un 409 ferait clignoter un refus sur un pointage réussi.
      expect(second.status).toBe(200);
      const replayed = second.body as StateBody;
      expect(replayed.replayed).toBe(true);
      expect(replayed.version).toBe(1);
      // Le rejeu rend l'état courant SANS rien réappliquer.
      expect(replayed.seat).toBe(0);
      expect(replayed.arrivedAt).not.toBeNull();
    });

    it('refuse une version périmée, et le dit en 409', async () => {
      api.actAs(a.host);
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Concurrence' });

      await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: 0,
        seat: 0,
      });

      const stale = await post(a.eventSurvey, {
        responseId: response,
        arrived: false,
        opId: randomUUID(),
        expectedVersion: 0,
        seat: 0,
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
        seat: 0,
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
        seat: 0,
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
        seat: 0,
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
        seat: 0,
      });

      // Dé-pointer une personne jamais pointée est sans objet, pas une faute :
      // la ligne existe, sans heure d'arrivée.
      expect(status).toBe(200);
      expect((body as StateBody).arrivedAt).toBeNull();
    });

    it('pointe un accompagnant sans toucher à son hôte', async () => {
      api.actAs(a.host);
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Jean Martin' });

      const host = await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: 0,
        seat: 0,
      });
      const companion = await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: 0,
        seat: 1,
      });

      expect(host.status).toBe(200);
      expect(companion.status).toBe(200);
      // La version est par SIÈGE : annoncer 0 sur le siège 1 après avoir
      // pointé le siège 0 ne doit pas être refusé.
      expect((companion.body as StateBody).seat).toBe(1);
      expect((companion.body as StateBody).version).toBe(1);
    });

    it('refuse un identifiant d’opération qui n’est pas un UUID', async () => {
      api.actAs(a.host);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: 'pas-un-uuid',
        expectedVersion: null,
        seat: 0,
      });
      expect(status).toBe(400);
    });

    it('refuse un siège hors des bornes', async () => {
      api.actAs(a.host);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: null,
        seat: 5000,
      });
      expect(status).toBe(400);
    });

    it('refuse un corps SANS siège', async () => {
      // Un siège par défaut pointerait l'hôte à la place de l'accompagnant,
      // en silence : mieux vaut un 400 franc.
      api.actAs(a.host);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: null,
      });
      expect(status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  describe('cadeau et invité de dernière minute', () => {
    const SCHEMA = {
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [
            { id: 'nom', type: 'text', label: 'Quel est votre nom ?', required: true },
            { id: 'prenom', type: 'text', label: 'Quel est votre prénom ?', required: false },
            { id: 'societe', type: 'text', label: 'Société', required: false },
          ],
        },
      ],
    };

    beforeAll(async () => {
      await db.query(OWNER, 'update public.surveys set schema = $1, settings = $2 where id = $3', [
        JSON.stringify(SCHEMA),
        JSON.stringify({
          attendance: { identityFields: ['prenom', 'nom'], detailField: 'societe' },
        }),
        a.eventSurvey,
      ]);
    });

    async function invite(surveyId: string, body: Record<string, unknown>) {
      return readJson(
        await addWalkin(
          jsonRequest('POST', `/api/checkin/${surveyId}/invite`, body),
          params(surveyId),
        ),
      );
    }

    interface WalkinBody {
      guest: { id: string; name: string | null; detail: string | null; walkIn: boolean };
      state: { responseId: string; seat: number; arrivedAt: string | null; version: number };
      replayed: boolean;
    }

    it('remet un cadeau par la même route, sans toucher à l’arrivée', async () => {
      api.actAs(a.host);
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Cadeau' });
      const { status, body } = await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        kind: 'gift',
        opId: randomUUID(),
        expectedVersion: 0,
        seat: 0,
      });
      expect(status).toBe(200);
      const state = body as StateBody & { giftAt: string | null };
      expect(state.giftAt).not.toBeNull();
      expect(state.arrivedAt).toBeNull();
    });

    it('un corps SANS geste reste une arrivée — un poste resté ouvert pendant le déploiement', async () => {
      api.actAs(a.host);
      const response = await insertResponse(db, a.eventSurvey, { nom: 'Ancien poste' });
      const { status, body } = await post(a.eventSurvey, {
        responseId: response,
        arrived: true,
        opId: randomUUID(),
        expectedVersion: 0,
        seat: 0,
      });
      expect(status).toBe(200);
      expect((body as StateBody).arrivedAt).not.toBeNull();
    });

    it('refuse un geste inconnu', async () => {
      api.actAs(a.host);
      const { status } = await post(a.eventSurvey, {
        responseId: a.eventResponse,
        arrived: true,
        kind: 'depart',
        opId: randomUUID(),
        expectedVersion: null,
        seat: 0,
      });
      expect(status).toBe(400);
    });

    it('ajoute une personne, nommée comme la liste la nomme, et la pointe', async () => {
      api.actAs(a.host);
      const { status, body } = await invite(a.eventSurvey, {
        opId: randomUUID(),
        values: { nom: 'Martin', prenom: 'Lucie', societe: 'Atelier Martin', presence: 'oui' },
      });
      expect(status).toBe(200);
      const added = body as WalkinBody;
      expect(added.guest).toMatchObject({
        name: 'Lucie Martin',
        detail: 'Atelier Martin',
        walkIn: true,
      });
      expect(added.state.responseId).toBe(added.guest.id);
      expect(added.state.arrivedAt).not.toBeNull();

      // La clé non proposée (`presence`) n'a PAS été écrite : la personne n'a
      // rien annoncé, et la liste blanche vaut ici comme ailleurs.
      const row = await db.queryOne<{ data: Record<string, string>; origin: string }>(
        OWNER,
        'select data, origin from public.survey_responses where id = $1',
        [added.guest.id],
      );
      expect(row).toEqual({
        data: { nom: 'Martin', prenom: 'Lucie', societe: 'Atelier Martin' },
        origin: 'desk',
      });
    });

    it('le delta d’un autre poste transporte la personne ajoutée', async () => {
      api.actAs(a.host);
      const before = new Date(Date.now() - 1000).toISOString();
      const { body } = await invite(a.eventSurvey, {
        opId: randomUUID(),
        values: { nom: 'Arnaud', prenom: 'Paul' },
      });
      const added = body as WalkinBody;

      const delta = await readJson(
        await readDelta(
          jsonRequest('GET', `/api/checkin/${a.eventSurvey}?depuis=${encodeURIComponent(before)}`),
          params(a.eventSurvey),
        ),
      );
      const payload = delta.body as { guests: { id: string; name: string }[] };
      expect(payload.guests.map((guest) => guest.id)).toContain(added.guest.id);
    });

    it('refuse un ajout sans nom, avec un message qui nomme la question', async () => {
      api.actAs(a.host);
      const { status, body } = await invite(a.eventSurvey, {
        opId: randomUUID(),
        values: { societe: 'Seule' },
      });
      expect(status).toBe(400);
      expect((body as ApiError).error.message).toBe('Remplissez au moins « Quel est votre prénom ? ».');
    });

    it('un host de B ne voit pas l’événement de A : 404', async () => {
      api.actAs(b.host);
      const { status } = await invite(a.eventSurvey, {
        opId: randomUUID(),
        values: { nom: 'Intrus' },
      });
      expect(status).toBe(404);
    });
  });
});
