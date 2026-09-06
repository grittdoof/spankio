import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as exportResponses } from '@/app/api/admin/surveys/[id]/export/route';
import { PATCH as patchSurvey } from '@/app/api/admin/surveys/[id]/route';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';
import { createRouteHarness, jsonRequest, readJson, type RouteHarness } from '../helpers/route';
import { createSurvey, insertResponse, seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * Effectif attendu dans l'export.
 *
 * Ce qui compte ici n'est pas qu'une fonction calcule bien — c'est déjà
 * couvert — mais que le RÉGLAGE traverse tout le chemin : enregistré par
 * l'éditeur dans `settings`, relu par la route d'export, appliqué aux vraies
 * réponses. Un comptage juste dans une fonction pure et absent du fichier
 * téléchargé ne servirait à personne.
 */

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const SCHEMA = {
  version: 1,
  steps: [
    {
      id: 'etape_1',
      fields: [
        {
          id: 'presence',
          type: 'radio',
          label: 'Serez-vous présent ?',
          required: true,
          options: [
            { value: 'oui', label: 'Oui, je serai présent' },
            { value: 'non', label: 'Non, je ne pourrai pas venir' },
          ],
        },
        {
          id: 'accompagnants',
          type: 'select',
          label: 'Nombre de personnes vous accompagnant',
          options: [
            { value: 'a0', label: '0' },
            { value: 'a2', label: '2' },
          ],
        },
        { id: 'nom', type: 'text', label: 'Nom et prénom' },
      ],
    },
  ],
};

describe('effectif attendu, de bout en bout', () => {
  let db: TestDb;
  let api: RouteHarness;
  let a: Tenant;
  let b: Tenant;
  let surveyId: string;

  beforeAll(async () => {
    db = await createTestDb();
    api = createRouteHarness(db);
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;

    surveyId = await createSurvey(db, {
      organisationId: a.organisationId,
      slug: 'gala',
      title: 'Gala',
      moduleKey: 'event',
      kind: 'event',
      schema: SCHEMA,
    });

    await insertResponse(db, surveyId, {
      presence: 'oui',
      accompagnants: 'a2',
      nom: 'Alice Martin',
    });
    await insertResponse(db, surveyId, {
      presence: 'oui',
      accompagnants: 'a0',
      nom: 'Bruno Petit',
    });
    await insertResponse(db, surveyId, { presence: 'non', nom: 'Chloé Durand' });
    // Présente, mais sans effectif : à vérifier, jamais arbitrée.
    await insertResponse(db, surveyId, { presence: 'oui', nom: 'David Roux' });
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  beforeEach(() => {
    api.actAs(a.admin);
  });

  it('n’ajoute aucune colonne tant que le comptage n’est pas configuré', async () => {
    const response = await exportResponses(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/export?format=csv`),
      params(surveyId),
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    // Compter des réponses reste exact : on n'invente pas un effectif que
    // l'organisation n'a pas défini.
    expect(body).not.toContain('Présence;');
    expect(body).toContain('Date de réponse');
  });

  it('enregistre le réglage par la route de mise à jour', async () => {
    const { status } = await readJson(
      await patchSurvey(
        jsonRequest('PATCH', `/api/admin/surveys/${surveyId}`, {
          settings: {
            attendance: {
              presenceField: 'presence',
              presenceValue: 'oui',
              partyField: 'accompagnants',
              partyMode: 'extra',
            },
          },
        }),
        params(surveyId),
      ),
    );
    expect(status).toBe(200);

    const stored = await db.queryOne<{ settings: unknown }>(
      OWNER,
      'select settings from public.surveys where id = $1',
      [surveyId],
    );
    expect(stored?.settings).toMatchObject({
      attendance: { presenceField: 'presence', presenceValue: 'oui' },
    });
  });

  it('ouvre le fichier sur la présence et l’effectif', async () => {
    const response = await exportResponses(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/export?format=csv`),
      params(surveyId),
    );
    const body = await response.text();
    const lines = body.split('\r\n').filter((line) => line !== '');

    expect(lines[0]?.startsWith('Présence;Personnes;')).toBe(true);

    // Les réponses sortent de la plus récente à la plus ancienne.
    const joined = lines.slice(1).join('\n');
    expect(joined).toContain('Présent;3;');
    expect(joined).toContain('Présent;1;');
    expect(joined).toContain('Décline;0;');
    // L'effectif indéterminé est DIT, pas remplacé par un chiffre sûr de lui.
    expect(joined).toContain('Présent;1 (à vérifier);');
  });

  it('reste refusé à une autre organisation', async () => {
    // Le RLS masque la ligne : l'export d'un tenant n'existe pas pour l'autre.
    api.actAs(b.editor);
    const response = await exportResponses(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/export?format=csv`),
      params(surveyId),
    );
    expect(response.status).toBe(404);
  });
});
