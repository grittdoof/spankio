import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as submit } from '@/app/api/public/submit/route';
import { RATE_LIMITS, resetMemoryLimiter } from '@/lib/security/rate-limit';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';
import {
  createRouteHarness,
  jsonRequest,
  readJson,
  type ApiError,
  type RouteHarness,
} from '../helpers/route';
import { createOrganisation, createSurvey } from '../helpers/seed';

/**
 * La surface la plus exposée de la plateforme : ouverte sans compte, sur une
 * URL publique. Ces tests exécutent la VRAIE route contre le VRAI RLS.
 */

const SCHEMA = {
  version: 1,
  steps: [
    {
      id: 'etape_1',
      fields: [
        { id: 'nom', type: 'text', label: 'Votre nom', required: true },
        { id: 'email', type: 'email', label: 'Adresse électronique' },
        {
          id: 'presence',
          type: 'radio',
          label: 'Serez-vous présent ?',
          options: [
            { value: 'oui', label: 'Oui' },
            { value: 'non', label: 'Non' },
          ],
        },
        {
          id: 'accompagnants',
          type: 'number',
          label: 'Combien de personnes ?',
          min: 1,
          max: 10,
          condition: { field: 'presence', op: 'equals', value: 'oui' },
        },
      ],
    },
  ],
};

interface Created {
  responseId: string;
  surveyId: string;
  kind: string;
}

describe('POST /api/public/submit', () => {
  let db: TestDb;
  let api: RouteHarness;
  let orgId: string;

  beforeAll(async () => {
    db = await createTestDb();
    api = createRouteHarness(db);
    orgId = await createOrganisation(db, 'org-publique', 'Organisation Publique');

    await createSurvey(db, { organisationId: orgId, slug: 'ouvert', schema: SCHEMA });
    await createSurvey(db, {
      organisationId: orgId,
      slug: 'brouillon',
      status: 'draft',
      schema: SCHEMA,
    });
    await createSurvey(db, {
      organisationId: orgId,
      slug: 'avec-consentement',
      schema: SCHEMA,
      requireConsent: true,
    });
    await createSurvey(db, {
      organisationId: orgId,
      slug: 'sans-doublon',
      schema: SCHEMA,
      dedupField: 'email',
    });
    await createSurvey(db, {
      organisationId: orgId,
      slug: 'quota',
      schema: SCHEMA,
      responseLimit: 1,
    });
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  beforeEach(() => {
    // Le répondant est anonyme : c'est tout l'enjeu.
    api.actAsAnonymous();
    resetMemoryLimiter();
  });

  function payload(slug: string, data: unknown, consentGiven = false) {
    return {
      organisationSlug: 'org-publique',
      surveySlug: slug,
      data,
      consentGiven,
    };
  }

  it('enregistre une réponse valide sans aucun compte', async () => {
    const { status, body } = await readJson<Created>(
      await submit(
        jsonRequest('POST', '/api/public/submit', payload('ouvert', { nom: 'Camille Martin' })),
      ),
    );

    expect(status).toBe(201);
    expect(body.responseId).toMatch(/^[0-9a-f-]{36}$/);

    const stored = await db.queryOne<{ data: Record<string, unknown>; organisation_id: string }>(
      OWNER,
      'select data, organisation_id from public.survey_responses where id = $1',
      [body.responseId],
    );
    expect(stored?.data).toEqual({ nom: 'Camille Martin' });
    // L'organisation vient du sondage, jamais du client.
    expect(stored?.organisation_id).toBe(orgId);
  });

  it('refuse un sondage inexistant ou non publié', async () => {
    for (const slug of ['inconnu', 'brouillon']) {
      const response = await submit(
        jsonRequest('POST', '/api/public/submit', payload(slug, { nom: 'Camille' })),
      );
      expect(response.status, slug).toBe(404);
    }
  });

  it('refuse une organisation inexistante', async () => {
    const response = await submit(
      jsonRequest('POST', '/api/public/submit', {
        organisationSlug: 'organisation-fantome',
        surveySlug: 'ouvert',
        data: { nom: 'Camille' },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('signale les champs fautifs pour que le répondant puisse corriger', async () => {
    const { status, body } = await readJson<ApiError>(
      await submit(jsonRequest('POST', '/api/public/submit', payload('ouvert', {}))),
    );
    expect(status).toBe(400);
    expect(body.error.fields).toEqual({ nom: 'required' });
  });

  it('refuse une clé absente du schéma', async () => {
    const { status, body } = await readJson<ApiError>(
      await submit(
        jsonRequest(
          'POST',
          '/api/public/submit',
          payload('ouvert', { nom: 'Camille', injecte: 'valeur' }),
        ),
      ),
    );
    expect(status).toBe(400);
    expect(body.error.fields).toHaveProperty('injecte', 'unknown_field');
  });

  it('refuse une adresse invalide', async () => {
    const { body } = await readJson<ApiError>(
      await submit(
        jsonRequest(
          'POST',
          '/api/public/submit',
          payload('ouvert', { nom: 'Camille', email: 'pas-une-adresse' }),
        ),
      ),
    );
    expect(body.error.fields).toEqual({ email: 'invalid_email' });
  });

  it('retire sans erreur un champ rendu inapplicable', async () => {
    const { status, body } = await readJson<Created>(
      await submit(
        jsonRequest(
          'POST',
          '/api/public/submit',
          payload('ouvert', { nom: 'Camille', presence: 'non', accompagnants: 4 }),
        ),
      ),
    );
    expect(status).toBe(201);

    const stored = await db.queryOne<{ data: Record<string, unknown> }>(
      OWNER,
      'select data from public.survey_responses where id = $1',
      [body.responseId],
    );
    expect(stored?.data).toEqual({ nom: 'Camille', presence: 'non' });
  });

  it('refuse un corps trop volumineux avant de l’analyser', async () => {
    const response = await submit(
      jsonRequest(
        'POST',
        '/api/public/submit',
        payload('ouvert', { nom: 'x'.repeat(100_000) }),
      ),
    );
    expect(response.status).toBe(413);
  });

  describe('consentement', () => {
    it('refuse une soumission sans consentement quand il est exigé', async () => {
      const { status, body } = await readJson<ApiError>(
        await submit(
          jsonRequest(
            'POST',
            '/api/public/submit',
            payload('avec-consentement', { nom: 'Camille' }, false),
          ),
        ),
      );
      expect(status).toBe(412);
      expect(body.error.code).toBe('consent_required');
    });

    it('stocke une preuve composée PAR LE SERVEUR', async () => {
      const { status, body } = await readJson<Created>(
        await submit(
          jsonRequest(
            'POST',
            '/api/public/submit',
            payload('avec-consentement', { nom: 'Camille' }, true),
          ),
        ),
      );
      expect(status).toBe(201);

      const stored = await db.queryOne<{ consent_given: boolean; consent_text: string }>(
        OWNER,
        'select consent_given, consent_text from public.survey_responses where id = $1',
        [body.responseId],
      );

      expect(stored?.consent_given).toBe(true);
      // Le texte reprend les mentions RGPD du sondage. Le client ne peut pas
      // l'influencer : la route n'accepte aucun champ de texte.
      expect(stored?.consent_text).toContain('Organisation Publique');
      expect(stored?.consent_text).toContain('Finalité : Recenser un besoin');
      expect(stored?.consent_text).toContain('Base légale : votre consentement');
      expect(stored?.consent_text).toContain('Durée de conservation : 1 an');
    });

    it('ne stocke aucun texte quand le consentement n’est pas donné', async () => {
      const { body } = await readJson<Created>(
        await submit(
          jsonRequest('POST', '/api/public/submit', payload('ouvert', { nom: 'Sans consentement' })),
        ),
      );
      const stored = await db.queryOne<{ consent_text: string | null }>(
        OWNER,
        'select consent_text from public.survey_responses where id = $1',
        [body.responseId],
      );
      expect(stored?.consent_text).toBeNull();
    });
  });

  describe('anti-doublon et quota', () => {
    it('refuse une seconde réponse avec la même valeur de dédoublonnage', async () => {
      const first = await submit(
        jsonRequest(
          'POST',
          '/api/public/submit',
          payload('sans-doublon', { nom: 'Camille', email: 'Camille@Exemple.test' }),
        ),
      );
      expect(first.status).toBe(201);

      const second = await submit(
        jsonRequest(
          'POST',
          '/api/public/submit',
          payload('sans-doublon', { nom: 'Camille', email: 'camille@exemple.test' }),
        ),
      );
      const { status, body } = await readJson<ApiError>(second);
      expect(status).toBe(409);
      expect(body.error.code).toBe('conflict');
    });

    it('refuse au-delà du plafond de réponses', async () => {
      const first = await submit(
        jsonRequest('POST', '/api/public/submit', payload('quota', { nom: 'Première' })),
      );
      expect(first.status).toBe(201);

      const second = await submit(
        jsonRequest('POST', '/api/public/submit', payload('quota', { nom: 'Seconde' })),
      );
      expect(second.status).toBe(429);
    });
  });

  it('limite le débit par appelant', async () => {
    const ip = '198.51.100.77';
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMITS.publicSubmit.limit + 1; i += 1) {
      const response = await submit(
        jsonRequest('POST', '/api/public/submit', payload('ouvert', { nom: `Réponse ${i}` }), {
          ip,
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 201)).toHaveLength(
      RATE_LIMITS.publicSubmit.limit,
    );
  });

  it('n’accepte aucune écriture directe : la table reste fermée', async () => {
    // La route passe par la fonction SQL ; aucune policy d'insertion n'existe.
    const policies = await db.query<{ cmd: string }>(
      OWNER,
      `select cmd from pg_policies
        where schemaname = 'public' and tablename = 'survey_responses' and cmd = 'INSERT'`,
    );
    expect(policies).toEqual([]);
  });
});
