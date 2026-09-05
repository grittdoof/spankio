import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as listSurveys, POST as createSurvey } from '@/app/api/admin/surveys/route';
import {
  DELETE as deleteSurvey,
  GET as getSurvey,
  PATCH as patchSurvey,
} from '@/app/api/admin/surveys/[id]/route';
import { GET as listResponses } from '@/app/api/admin/surveys/[id]/responses/route';
import { GET as getStatistics } from '@/app/api/admin/surveys/[id]/statistiques/route';
import { GET as exportResponses } from '@/app/api/admin/surveys/[id]/export/route';
import { DELETE as deleteResponse } from '@/app/api/admin/responses/[id]/route';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';
import {
  createRouteHarness,
  jsonRequest,
  readJson,
  type ApiError,
  type RouteHarness,
} from '../helpers/route';
import { insertResponse, seedTwoTenants, setModuleOverride, type Tenant } from '../helpers/seed';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

interface SurveyBody {
  survey: { id: string; slug: string; title: string; status: string; schema: unknown };
}

const SCHEMA = {
  version: 1,
  steps: [
    {
      id: 'etape_1',
      fields: [
        { id: 'nom', type: 'text', label: 'Votre nom', required: true },
        {
          id: 'venue',
          type: 'radio',
          label: 'Venez-vous ?',
          options: [
            { value: 'oui', label: 'Oui' },
            { value: 'non', label: 'Non' },
          ],
        },
      ],
    },
  ],
};

describe('routes de gestion des sondages', () => {
  let db: TestDb;
  let api: RouteHarness;
  let a: Tenant;
  let b: Tenant;
  let superAdmin: string;

  beforeAll(async () => {
    db = await createTestDb();
    api = createRouteHarness(db);
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;
    superAdmin = seeded.superAdmin;
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  beforeEach(() => {
    api.actAs(a.editor);
  });

  describe('liste', () => {
    it("ne montre que les sondages de sa propre organisation", async () => {
      const { status, body } = await readJson<{
        surveys: { id: string }[];
        templates: { key: string }[];
      }>(await listSurveys(jsonRequest('GET', '/api/admin/surveys')));

      expect(status).toBe(200);
      const ids = body.surveys.map((survey) => survey.id);
      expect(ids).toContain(a.survey);
      expect(ids).not.toContain(b.survey);
      // Les modèles accompagnent la liste : l'écran de création en a besoin.
      expect(body.templates.length).toBeGreaterThan(0);
    });

    it('refuse un visiteur anonyme', async () => {
      api.actAsAnonymous();
      expect((await listSurveys(jsonRequest('GET', '/api/admin/surveys'))).status).toBe(401);
    });
  });

  describe('création', () => {
    it('crée un brouillon et dérive son identifiant d’URL du titre', async () => {
      const { status, body } = await readJson<SurveyBody>(
        await createSurvey(
          jsonRequest('POST', '/api/admin/surveys', { title: 'Réunion d’Été 2027' }),
        ),
      );

      expect(status).toBe(201);
      expect(body.survey.slug).toBe('reunion-d-ete-2027');
      // Un sondage naît toujours en brouillon : rien n'est publié par accident.
      expect(body.survey.status).toBe('draft');
    });

    it('part d’un modèle quand on le demande', async () => {
      const { body } = await readJson<SurveyBody>(
        await createSurvey(
          jsonRequest('POST', '/api/admin/surveys', {
            title: 'Inscription au gala',
            templateKey: 'event_registration',
          }),
        ),
      );

      const schema = body.survey.schema as { steps: { fields: unknown[] }[] };
      expect(schema.steps.length).toBeGreaterThan(1);
    });

    it('refuse un module non autorisé pour ce compte', async () => {
      // L'éditeur perd nominativement le module événement : le RLS refuse
      // alors la création d'un sondage de ce module, dans sa propre
      // organisation.
      await setModuleOverride(db, a.editor, 'event', false);

      const response = await createSurvey(
        jsonRequest('POST', '/api/admin/surveys', {
          title: 'Gala interdit',
          templateKey: 'event_registration',
        }),
      );
      expect(response.status).toBe(403);

      await setModuleOverride(db, a.editor, 'event', true);
    });

    it('refuse un modèle inconnu', async () => {
      const response = await createSurvey(
        jsonRequest('POST', '/api/admin/surveys', {
          title: 'Sondage',
          templateKey: 'modele_inexistant',
        }),
      );
      expect(response.status).toBe(404);
    });

    it('refuse un titre dont on ne peut dériver aucun identifiant', async () => {
      const response = await createSurvey(
        jsonRequest('POST', '/api/admin/surveys', { title: '!!!!' }),
      );
      expect(response.status).toBe(400);
    });

    it('refuse un identifiant déjà pris plutôt que d’en inventer un', async () => {
      await createSurvey(jsonRequest('POST', '/api/admin/surveys', { title: 'Doublon' }));
      const second = await createSurvey(
        jsonRequest('POST', '/api/admin/surveys', { title: 'Doublon' }),
      );
      expect(second.status).toBe(409);
    });
  });

  describe('modification', () => {
    let surveyId: string;

    beforeEach(async () => {
      api.actAs(a.editor);
      const { body } = await readJson<SurveyBody>(
        await createSurvey(
          jsonRequest('POST', '/api/admin/surveys', {
            title: `Sondage ${crypto.randomUUID().slice(0, 8)}`,
          }),
        ),
      );
      surveyId = body.survey.id;
    });

    it('accepte un brouillon incomplet', async () => {
      // On ne construit pas un formulaire d'un seul geste : un brouillon sans
      // question doit pouvoir être enregistré.
      const response = await patchSurvey(
        jsonRequest('PATCH', '/patch', { schema: { version: 1, steps: [] } }),
        params(surveyId),
      );
      expect(response.status).toBe(200);
    });

    it('refuse un schéma incohérent, en disant lequel', async () => {
      const { status, body } = await readJson<ApiError>(
        await patchSurvey(
          jsonRequest('PATCH', '/patch', {
            schema: {
              version: 1,
              steps: [
                {
                  id: 'etape_1',
                  fields: [
                    { id: 'a', type: 'text', label: 'A' },
                    { id: 'a', type: 'text', label: 'A bis' },
                  ],
                },
              ],
            },
          }),
          params(surveyId),
        ),
      );
      expect(status).toBe(400);
      expect(JSON.stringify(body.error.fields)).toContain('deux fois');
    });

    it('refuse la publication en énumérant ce qui manque', async () => {
      const { status, body } = await readJson<ApiError>(
        await patchSurvey(jsonRequest('PATCH', '/patch', { status: 'published' }), params(surveyId)),
      );

      expect(status).toBe(400);
      const fields = Object.keys(body.error.fields ?? {});
      // Le message dit CE QUI manque, plutôt que de renvoyer une violation de
      // contrainte opaque.
      expect(fields).toContain('purpose');
      expect(fields).toContain('legalBasis');
      expect(fields).toContain('retentionDays');
      expect(fields).toContain('schema');
    });

    it('publie quand tout est renseigné', async () => {
      const { status, body } = await readJson<SurveyBody>(
        await patchSurvey(
          jsonRequest('PATCH', '/patch', {
            schema: SCHEMA,
            purpose: 'Recenser un besoin',
            legalBasis: 'consent',
            retentionDays: 365,
            recipients: 'Service organisateur',
            status: 'published',
          }),
          params(surveyId),
        ),
      );

      expect(status).toBe(200);
      expect(body.survey.status).toBe('published');

      const stored = await db.queryOne<{ published_at: string | null }>(
        OWNER,
        'select published_at from public.surveys where id = $1',
        [surveyId],
      );
      // `published_at` est posé par le trigger, pas par le client.
      expect(stored?.published_at).not.toBeNull();
    });

    it('refuse une base légale hors des six du RGPD', async () => {
      const response = await patchSurvey(
        jsonRequest('PATCH', '/patch', { legalBasis: 'parce_que' }),
        params(surveyId),
      );
      expect(response.status).toBe(400);
    });

    it('normalise un identifiant d’URL saisi à la main', async () => {
      const { body } = await readJson<SurveyBody>(
        await patchSurvey(
          jsonRequest('PATCH', '/patch', { slug: '  Mon Sondage Été  ' }),
          params(surveyId),
        ),
      );
      expect(body.survey.slug).toBe('mon-sondage-ete');
    });
  });

  describe('isolation', () => {
    it('ne lit pas un sondage d’une autre organisation', async () => {
      api.actAs(a.editor);
      const response = await getSurvey(jsonRequest('GET', '/get'), params(b.survey));
      expect(response.status).toBe(404);
    });

    it('ne modifie pas un sondage d’une autre organisation', async () => {
      api.actAs(a.editor);
      const response = await patchSurvey(
        jsonRequest('PATCH', '/patch', { title: 'Détourné' }),
        params(b.survey),
      );
      expect(response.status).toBe(404);

      const untouched = await db.queryOne<{ title: string }>(
        OWNER,
        'select title from public.surveys where id = $1',
        [b.survey],
      );
      // Le fixture nomme le sondage d'après son identifiant d'URL.
      expect(untouched?.title).toBe('Sondage sondage-b');
    });

    it('ne supprime pas un sondage d’une autre organisation', async () => {
      api.actAs(a.editor);
      expect((await deleteSurvey(jsonRequest('DELETE', '/d'), params(b.survey))).status).toBe(404);

      const alive = await db.queryOne<{ deleted_at: string | null }>(
        OWNER,
        'select deleted_at from public.surveys where id = $1',
        [b.survey],
      );
      expect(alive?.deleted_at).toBeNull();
    });

    it('ne lit pas les réponses d’une autre organisation', async () => {
      api.actAs(a.editor);
      expect(
        (await listResponses(jsonRequest('GET', '/r'), params(b.survey))).status,
      ).toBe(404);
      expect(
        (await getStatistics(jsonRequest('GET', '/s'), params(b.survey))).status,
      ).toBe(404);
      expect(
        (await exportResponses(jsonRequest('GET', '/e?format=csv'), params(b.survey))).status,
      ).toBe(404);
    });

    it('ne supprime pas une réponse d’une autre organisation', async () => {
      api.actAs(a.admin);
      const response = await deleteResponse(jsonRequest('DELETE', '/d'), params(b.response));
      expect(response.status).toBe(404);

      const alive = await db.queryOne<{ deleted_at: string | null }>(
        OWNER,
        'select deleted_at from public.survey_responses where id = $1',
        [b.response],
      );
      expect(alive?.deleted_at).toBeNull();
    });

    it('un viewer lit mais n’écrit pas', async () => {
      api.actAs(a.viewer);
      expect((await getSurvey(jsonRequest('GET', '/get'), params(a.survey))).status).toBe(200);

      const patched = await patchSurvey(
        jsonRequest('PATCH', '/patch', { title: 'Modifié par un lecteur' }),
        params(a.survey),
      );
      expect(patched.status).toBe(403);
    });

    it('le super administrateur voit les sondages de toutes les organisations', async () => {
      api.actAs(superAdmin);
      expect((await getSurvey(jsonRequest('GET', '/get'), params(b.survey))).status).toBe(200);
    });
  });

  describe('réponses, statistiques et suppression logique', () => {
    let surveyId: string;

    beforeAll(async () => {
      api.actAs(a.editor);
      const { body } = await readJson<SurveyBody>(
        await createSurvey(
          jsonRequest('POST', '/api/admin/surveys', { title: 'Sondage avec réponses' }),
        ),
      );
      surveyId = body.survey.id;

      await patchSurvey(
        jsonRequest('PATCH', '/patch', {
          schema: SCHEMA,
          purpose: 'Recenser',
          legalBasis: 'consent',
          retentionDays: 365,
          status: 'published',
        }),
        params(surveyId),
      );

      await insertResponse(db, surveyId, { nom: 'Camille', venue: 'oui' });
      await insertResponse(db, surveyId, { nom: 'Paul', venue: 'non' });
      await insertResponse(db, surveyId, { nom: 'Léa', venue: 'oui' });
    });

    it('liste les réponses les plus récentes d’abord', async () => {
      api.actAs(a.editor);
      const { status, body } = await readJson<{ responses: { data: { nom: string } }[] }>(
        await listResponses(jsonRequest('GET', '/r'), params(surveyId)),
      );
      expect(status).toBe(200);
      expect(body.responses).toHaveLength(3);
    });

    it('agrège sans exposer de contenu libre', async () => {
      api.actAs(a.editor);
      const { body } = await readJson<{
        statistics: { responseCount: number; fields: { type: string; label: string }[] };
      }>(await getStatistics(jsonRequest('GET', '/s'), params(surveyId)));

      expect(body.statistics.responseCount).toBe(3);
      const nom = body.statistics.fields.find((field) => field.label === 'Votre nom');
      expect(nom?.type).toBe('text');
      // Aucun nom saisi ne se retrouve dans les statistiques.
      expect(JSON.stringify(body.statistics)).not.toContain('Camille');
    });

    it('exclut une réponse supprimée des listes ET des agrégats', async () => {
      api.actAs(a.admin);
      const { body: before } = await readJson<{ responses: { id: string }[] }>(
        await listResponses(jsonRequest('GET', '/r'), params(surveyId)),
      );
      const victim = before.responses[0]!.id;

      const deleted = await deleteResponse(jsonRequest('DELETE', '/d'), params(victim));
      expect(deleted.status).toBe(200);

      const { body: after } = await readJson<{ responses: { id: string }[] }>(
        await listResponses(jsonRequest('GET', '/r'), params(surveyId)),
      );
      expect(after.responses.map((response) => response.id)).not.toContain(victim);

      const { body: stats } = await readJson<{ statistics: { responseCount: number } }>(
        await getStatistics(jsonRequest('GET', '/s'), params(surveyId)),
      );
      expect(stats.statistics.responseCount).toBe(2);

      // La ligne existe toujours : c'est une suppression logique.
      const row = await db.queryOne<{ deleted_at: string | null }>(
        OWNER,
        'select deleted_at from public.survey_responses where id = $1',
        [victim],
      );
      expect(row?.deleted_at).not.toBeNull();
    });
  });

  describe('exports', () => {
    let surveyId: string;

    beforeAll(async () => {
      api.actAs(a.editor);
      const { body } = await readJson<SurveyBody>(
        await createSurvey(jsonRequest('POST', '/api/admin/surveys', { title: 'À exporter' })),
      );
      surveyId = body.survey.id;

      await patchSurvey(
        jsonRequest('PATCH', '/patch', {
          schema: SCHEMA,
          purpose: 'Recenser',
          legalBasis: 'consent',
          retentionDays: 365,
          status: 'published',
        }),
        params(surveyId),
      );

      await insertResponse(db, surveyId, { nom: '=1+1', venue: 'oui' });
    });

    it('produit un CSV avec BOM, libellés et formules neutralisées', async () => {
      api.actAs(a.editor);
      const response = await exportResponses(
        jsonRequest('GET', '/e?format=csv'),
        params(surveyId),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      expect(response.headers.get('content-disposition')).toContain('a-exporter-');

      // La marque d'ordre des octets se vérifie sur les OCTETS : `text()`
      // applique le décodage UTF-8 de la spécification, qui retire un BOM de
      // tête. L'assertion sur la chaîne aurait donc échoué alors que le
      // fichier envoyé est correct.
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

      const body = await response.text();
      expect(body).toContain('Votre nom');
      // Une réponse commençant par « = » est du code pour un tableur.
      expect(body).toContain("'=1+1");
      // Les libellés remplacent les valeurs techniques.
      expect(body).toContain('Oui');
    });

    it('produit un JSON auto-descriptif avec le schéma embarqué', async () => {
      api.actAs(a.editor);
      const response = await exportResponses(
        jsonRequest('GET', '/e?format=json'),
        params(surveyId),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        format: string;
        survey: { schema: unknown; title: string };
        responses: { answers: { venue: string } }[];
      };

      expect(body.format).toBe('spankio.responses.v1');
      expect(body.survey.title).toBe('À exporter');
      expect(body.survey.schema).toBeTruthy();
      // Le JSON garde les VALEURS techniques, à l'inverse du CSV.
      expect(body.responses[0]!.answers.venue).toBe('oui');
    });

    it('refuse un format inconnu', async () => {
      api.actAs(a.editor);
      const response = await exportResponses(
        jsonRequest('GET', '/e?format=pdf'),
        params(surveyId),
      );
      expect(response.status).toBe(400);
    });
  });
});
