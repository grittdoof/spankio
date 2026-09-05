import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH as patchSurvey } from '@/app/api/admin/surveys/[id]/route';
import { GET as geocode } from '@/app/api/admin/geocode/route';
import { resetGlobalSlots } from '@/lib/security/global-throttle';
import { createTestDb, type TestDb } from '../helpers/db';
import {
  createRouteHarness,
  jsonRequest,
  readJson,
  type ApiError,
  type RouteHarness,
} from '../helpers/route';
import { seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * Module événement : réglages du sondage et relais de géocodage.
 *
 * L'enjeu propre à ce module est l'ouverture vers l'extérieur — un bucket
 * public et un service tiers — donc ce qui est vérifié ici, c'est qu'aucune
 * des deux ne devient une porte dérobée.
 */

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * Le relais de géocodage compose son `User-Agent` à partir de l'adresse du
 * site : sans variables publiques, la route lèverait avant d'atteindre ce qui
 * est testé ici.
 */
function stubPublicEnv(): void {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://exemple.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'cle-anonyme-de-test');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://exemple.test');
}

interface SurveyBody {
  survey: { id: string; banner_path: string | null; event_lat: number | null };
}

describe('module événement', () => {
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

  beforeEach(() => {
    api.actAs(a.editor);
    resetGlobalSlots();
    stubPublicEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  describe('chemin de bannière', () => {
    const pathFor = (organisationId: string, surveyId: string) =>
      `${organisationId}/${surveyId}/20260905T134512-abc123.jpg`;

    it('accepte le chemin du dossier de ce sondage', async () => {
      const { status, body } = await readJson<SurveyBody>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, {
            bannerPath: pathFor(a.organisationId, a.eventSurvey),
          }),
          params(a.eventSurvey),
        ),
      );

      expect(status).toBe(200);
      expect(body.survey.banner_path).toBe(pathFor(a.organisationId, a.eventSurvey));
    });

    it('refuse un chemin pointant vers le dossier d’une AUTRE organisation', async () => {
      // Le bucket est public : sans ce contrôle, une organisation illustrerait
      // sa page avec le fichier d'une autre, sans jamais rien téléverser.
      const { status, body } = await readJson<ApiError>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, {
            bannerPath: pathFor(b.organisationId, b.eventSurvey),
          }),
          params(a.eventSurvey),
        ),
      );

      expect(status).toBe(400);
      expect(body.error.fields?.['bannerPath']).toBeDefined();
    });

    it('refuse le chemin d’un AUTRE sondage de la même organisation', async () => {
      const { status } = await readJson<ApiError>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, {
            bannerPath: pathFor(a.organisationId, a.survey),
          }),
          params(a.eventSurvey),
        ),
      );
      expect(status).toBe(400);
    });

    it.each([
      'quelconque.jpg',
      '../../etc/passwd',
      'a/b/c/d.jpg',
    ])('refuse le chemin arbitraire « %s »', async (candidate) => {
      const { status } = await readJson<ApiError>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, {
            bannerPath: candidate,
          }),
          params(a.eventSurvey),
        ),
      );
      expect(status).toBe(400);
    });

    it('accepte le retrait de la bannière', async () => {
      const { status, body } = await readJson<SurveyBody>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, { bannerPath: null }),
          params(a.eventSurvey),
        ),
      );
      expect(status).toBe(200);
      expect(body.survey.banner_path).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('coordonnées de l’événement', () => {
    it('enregistre une position valide', async () => {
      const { status, body } = await readJson<SurveyBody>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, {
            eventLat: 45.764043,
            eventLng: 4.835659,
          }),
          params(a.eventSurvey),
        ),
      );
      expect(status).toBe(200);
      expect(Number(body.survey.event_lat)).toBeCloseTo(45.764043, 5);
    });

    it.each([
      ['latitude', { eventLat: 91 }],
      ['longitude', { eventLng: 181 }],
    ])('refuse une %s hors bornes', async (_label, patch) => {
      const { status } = await readJson<ApiError>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, patch),
          params(a.eventSurvey),
        ),
      );
      expect(status).toBe(400);
    });

    it('ne laisse pas une autre organisation régler cet événement', async () => {
      api.actAs(b.editor);
      const { status } = await readJson<ApiError>(
        await patchSurvey(
          jsonRequest('PATCH', `/api/admin/surveys/${a.eventSurvey}`, { eventLat: 10 }),
          params(a.eventSurvey),
        ),
      );
      // Le RLS masque la ligne : 404, pas 403 — un 403 confirmerait son
      // existence.
      expect(status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('relais de géocodage', () => {
    const nominatimReply = (rows: unknown) =>
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const row = {
      display_name: '12 Rue des Lilas, Lyon, France',
      lat: '45.764043',
      lon: '4.835659',
      type: 'house',
    };

    it('refuse un visiteur sans session', async () => {
      api.actAsAnonymous();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const { status } = await readJson<ApiError>(
        await geocode(jsonRequest('GET', '/api/admin/geocode?q=Lyon')),
      );

      expect(status).toBe(401);
      // Rien n'est parti vers le tiers : la session est vérifiée AVANT.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each(['', 'ly', '  '])('refuse une recherche trop courte (« %s »)', async (term) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const { status, body } = await readJson<ApiError>(
        await geocode(jsonRequest('GET', `/api/admin/geocode?q=${encodeURIComponent(term)}`)),
      );

      expect(status).toBe(400);
      expect(body.error.code).toBe('invalid_input');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('relaie les résultats après les avoir reconstruits', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(nominatimReply([row]));

      const { status, body } = await readJson<{
        results: { label: string; latitude: number }[];
      }>(await geocode(jsonRequest('GET', '/api/admin/geocode?q=12 rue des Lilas')));

      expect(status).toBe(200);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]?.latitude).toBe(45.764043);
    });

    it('envoie un user-agent identifiant l’application, comme l’exige OSM', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(nominatimReply([row]));

      await geocode(jsonRequest('GET', '/api/admin/geocode?q=Lyon'));

      const init = fetchSpy.mock.calls[0]?.[1];
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['user-agent']).toMatch(/^spankio/);
    });

    it('écarte une entrée aux coordonnées impossibles au lieu de la relayer', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        nominatimReply([{ ...row, lat: '91' }, row]),
      );

      const { body } = await readJson<{ results: unknown[] }>(
        await geocode(jsonRequest('GET', '/api/admin/geocode?q=Lyon')),
      );
      expect(body.results).toHaveLength(1);
    });

    it('refuse le second appel de la même seconde, plafond imposé par OSM', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(nominatimReply([row]));

      const first = await readJson<{ results: unknown[] }>(
        await geocode(jsonRequest('GET', '/api/admin/geocode?q=Lyon')),
      );
      const second = await readJson<ApiError>(
        await geocode(jsonRequest('GET', '/api/admin/geocode?q=Marseille')),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    });

    it('ne relaie pas l’erreur du tiers telle quelle', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Bandwidth limit exceeded', { status: 429 }),
      );

      const { status, body } = await readJson<ApiError>(
        await geocode(jsonRequest('GET', '/api/admin/geocode?q=Lyon')),
      );

      expect(status).toBe(500);
      expect(body.error.message).not.toContain('Bandwidth');
    });

    it('survit à un tiers injoignable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('délai dépassé'));

      const { status, body } = await readJson<ApiError>(
        await geocode(jsonRequest('GET', '/api/admin/geocode?q=Lyon')),
      );

      expect(status).toBe(500);
      expect(body.error.message).toContain('momentanément indisponible');
    });
  });
});
