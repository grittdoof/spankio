import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as submit } from '@/app/api/public/submit/route';
import { resolveRequestContext } from '@/lib/data/context';
import type { EmailMessage, EmailResult } from '@/lib/email/resend';
import { submitPublicResponse } from '@/lib/services/submission';
import { RATE_LIMITS, resetMemoryLimiter } from '@/lib/security/rate-limit';
import { OWNER, asUser, createTestDb, type TestDb } from '../helpers/db';
import {
  createRouteHarness,
  jsonRequest,
  readJson,
  type ApiError,
  type RouteHarness,
} from '../helpers/route';
import {
  activateMember,
  createAccount,
  createOrganisation,
  createSurvey,
  grantModule,
} from '../helpers/seed';

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
    // Le cas de production : la clé désigne une question que le schéma ne
    // contient pas (ou plus). Elle a été supprimée ou renommée depuis.
    await createSurvey(db, {
      organisationId: orgId,
      slug: 'cle-fantome',
      schema: SCHEMA,
      dedupField: 'courriel_disparu',
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

    /**
     * DÉFAUT RÉEL, constaté sur un formulaire d'inscription ouvert. Après avoir
     * refait ses questions, l'organisation gardait `dedup_field = 'email'`,
     * identifiant que le schéma ne contenait plus. Aucune valeur ne pouvait
     * donc être extraite, et la fonction SQL refusait la réponse : CHAQUE
     * inscription repartait en 400 « Les données envoyées sont invalides »,
     * pour une saisie parfaitement valide, sans un seul champ à corriger.
     */
    it('enregistre malgré une clé anti-doublon désignant une question absente', async () => {
      const first = await submit(
        jsonRequest(
          'POST',
          '/api/public/submit',
          payload('cle-fantome', { nom: 'Alix', email: 'alix@exemple.test' }),
        ),
      );
      expect(first.status).toBe(201);

      // Aucune unicité n'est appliquée — elle est INAPPLICABLE, et le journal
      // le dit à l'organisation. Elle n'est pas simulée sur une autre clé.
      const second = await submit(
        jsonRequest(
          'POST',
          '/api/public/submit',
          payload('cle-fantome', { nom: 'Alix', email: 'alix@exemple.test' }),
        ),
      );
      expect(second.status).toBe(201);

      const row = await db.queryOne<{ total: string; sans_cle: string }>(
        OWNER,
        `select count(*) as total, count(*) filter (where dedup_key is null) as sans_cle
           from public.survey_responses r
           join public.surveys s on s.id = r.survey_id
          where s.slug = 'cle-fantome'`,
      );
      expect(Number(row?.total)).toBe(2);
      expect(Number(row?.sans_cle)).toBe(2);
    });

    /**
     * Second visage du même défaut : la question désignée EXISTE, mais elle est
     * facultative — ou n'est posée qu'à une partie des répondants. Celui qui la
     * laisse vide n'a rien à corriger, et son envoi doit aboutir.
     */
    it('enregistre quand la question désignée est restée vide', async () => {
      const { status } = await readJson<Created>(
        await submit(
          jsonRequest('POST', '/api/public/submit', payload('sans-doublon', { nom: 'Sans mail' })),
        ),
      );
      expect(status).toBe(201);
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

describe('courriel de confirmation', () => {
  /**
   * L'envoi n'est pas testé ici — sans clé Resend, `sendEmail` dégrade en
   * silence, ce qui est précisément la propriété qui compte. Ce qui EST testé,
   * et qui ne se vérifie qu'ici : l'inscription aboutit quand même, et la
   * preuve stockée annonce l'envoi.
   */
  let db: TestDb;
  let surveyId: string;

  beforeAll(async () => {
    db = await createTestDb();
    createRouteHarness(db);
    const organisationId = await createOrganisation(db, 'org-conf', 'Organisation Conf');
    surveyId = await createSurvey(db, {
      organisationId,
      slug: 'avec-confirmation',
      kind: 'event',
      moduleKey: 'event',
      requireConsent: true,
      schema: SCHEMA,
      settings: {
        confirmation: { enabled: true, emailField: 'email' },
      },
    });
    await createSurvey(db, {
      organisationId,
      slug: 'titre-agenda',
      title: 'Une invitation au titre beaucoup trop long pour une case d’agenda',
      kind: 'event',
      moduleKey: 'event',
      schema: SCHEMA,
      eventStartsAt: '2027-06-01T17:00:00.000Z',
      settings: {
        confirmation: { enabled: true, emailField: 'email' },
        calendar: { title: 'Soirée des 180 ans' },
      },
    });
    await createSurvey(db, {
      organisationId,
      slug: 'sans-heure-de-fin',
      kind: 'event',
      moduleKey: 'event',
      schema: SCHEMA,
      eventStartsAt: '2027-06-01T17:00:00.000Z',
      eventEndsAt: '2027-06-01T21:00:00.000Z',
      settings: {
        confirmation: {
          enabled: true,
          emailField: 'email',
          hidden: ['endTime', 'recap'],
        },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    resetMemoryLimiter();
  });

  it('enregistre l’inscription même si aucun courriel ne peut partir', async () => {
    const response = await submit(
      jsonRequest('POST', '/api/public/submit', {
        organisationSlug: 'org-conf',
        surveySlug: 'avec-confirmation',
        consentGiven: true,
        data: { nom: 'Camille Arnoult', email: 'camille@exemple.test' },
      }),
    );

    // Règle absolue : un envoi d'email ne fait jamais échouer une action
    // métier. Sans clé Resend, l'inscription reste aboutie.
    expect(response.status).toBe(201);
  });

  it('annonce l’envoi dans la preuve stockée', async () => {
    await submit(
      jsonRequest('POST', '/api/public/submit', {
        organisationSlug: 'org-conf',
        surveySlug: 'avec-confirmation',
        consentGiven: true,
        data: { nom: 'Nadia Belkacem', email: 'nadia@exemple.test' },
      }),
    );

    const row = await db.queryOne<{ consent_text: string }>(
      OWNER,
      `select consent_text from public.survey_responses
        where survey_id = $1 and data ->> 'nom' = 'Nadia Belkacem'`,
      [surveyId],
    );

    // RÈGLE D'OR : ce que la mention affirme doit correspondre exactement à ce
    // que le code fait. L'adresse sert aussi à écrire au répondant, la preuve
    // le dit.
    expect(row?.consent_text).toContain('Courriel de confirmation');
  });

  /**
   * Le titre du rendez-vous ne se vérifie qu'ICI : la fonction pure est testée
   * ailleurs, mais rien ne prouverait qu'elle est appelée sur le chemin du
   * courriel. Et c'est le même titre que celui du fichier `.ics` et des liens
   * de la page — trois compositions donneraient trois rendez-vous.
   */
  it('reprend le titre de rendez-vous réglé dans les liens d’agenda', async () => {
    const captured: EmailMessage[] = [];
    const fake = (message: EmailMessage): Promise<EmailResult> => {
      captured.push(message);
      return Promise.resolve({ sent: true });
    };

    const context = await resolveRequestContext();
    const result = await submitPublicResponse(
      context,
      {
        organisationSlug: 'org-conf',
        surveySlug: 'titre-agenda',
        data: { nom: 'Salomé Diaz', email: 'salome@exemple.test' },
        consentGiven: true,
      },
      { sendEmail: fake, siteUrl: 'https://spankio.test' },
    );

    expect(result.ok).toBe(true);
    const message = captured[0]!;
    // Le titre réglé part dans les liens Google et Outlook. L'encodage est
    // celui de `URLSearchParams` — espaces en `+` — donc il est reproduit ici
    // au lieu d'être supposé.
    const encoded = new URLSearchParams({ text: 'Soirée des 180 ans' }).toString();
    expect(message.html).toContain(encoded);
    expect(message.html).not.toContain(
      new URLSearchParams({ text: 'Une invitation au titre beaucoup trop long' }).toString(),
    );
  });

  /**
   * Les interrupteurs du courriel ne se vérifient qu'ICI : le gabarit sait
   * omettre un bloc, mais rien ne prouverait que les RÉGLAGES l'atteignent. Le
   * service est donc appelé avec un envoi factice, et c'est le message
   * réellement composé qui est lu.
   */
  it('n’envoie que les blocs restés ouverts', async () => {
    const captured: EmailMessage[] = [];
    const fake = (message: EmailMessage): Promise<EmailResult> => {
      captured.push(message);
      return Promise.resolve({ sent: true });
    };

    const context = await resolveRequestContext();
    const result = await submitPublicResponse(
      context,
      {
        organisationSlug: 'org-conf',
        surveySlug: 'sans-heure-de-fin',
        data: { nom: 'Yann Le Goff', email: 'yann@exemple.test' },
        consentGiven: true,
      },
      { sendEmail: fake, siteUrl: 'https://spankio.test' },
    );

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const message = captured[0]!;

    // La date reste, l'heure de fin part : les deux se ferment séparément.
    expect(message.text).toContain('juin 2027');
    expect(message.text).not.toContain('Fin prévue');
    // Et le récapitulatif, fermé lui aussi, ne laisse pas d'intitulé orphelin.
    expect(message.text).not.toContain('Vos réponses');
    expect(message.text).not.toContain('Yann Le Goff');
  });
});

describe('correction d’une réponse', () => {
  /**
   * L'immuabilité n'est PAS relâchée : la correction est une copie, et
   * l'originale reste en base hors des comptages. Ces tests fixent les quatre
   * propriétés qui rendent ce choix défendable — sinon autant réécrire `data`
   * en place et perdre la correspondance entre la preuve et ce qu'elle prouve.
   */
  let db: TestDb;
  let orgId: string;
  let surveyId: string;
  /**
   * La correction s'exerce en tant qu'ADMINISTRATEUR, pas en propriétaire de
   * base : la fonction est `SECURITY DEFINER` et revérifie les droits de
   * l'appelant. Sans `auth.uid()`, elle refuse — et c'est le comportement
   * voulu, vérifié par le test d'isolation.
   */
  let admin: string;

  beforeAll(async () => {
    db = await createTestDb();
    createRouteHarness(db);
    orgId = await createOrganisation(db, 'org-correction', 'Organisation Correction');
    await grantModule(db, orgId, 'core');
    admin = await createAccount(db, 'admin@org-correction.test');
    await activateMember(db, admin, orgId, 'admin');
    surveyId = await createSurvey(db, {
      organisationId: orgId,
      slug: 'a-corriger',
      schema: SCHEMA,
      requireConsent: true,
      dedupField: 'email',
    });
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    resetMemoryLimiter();
  });

  async function submitOne(nom: string, email: string): Promise<string> {
    await submit(
      jsonRequest('POST', '/api/public/submit', {
        organisationSlug: 'org-correction',
        surveySlug: 'a-corriger',
        consentGiven: true,
        data: { nom, email, presence: 'oui', accompagnants: 1 },
      }),
    );
    const row = await db.queryOne<{ id: string }>(
      OWNER,
      `select id from public.survey_responses
        where survey_id = $1 and deleted_at is null and data ->> 'nom' = $2`,
      [surveyId, nom],
    );
    if (!row) throw new Error(`Réponse de ${nom} introuvable`);
    return row.id;
  }

  it('conserve l’originale, sa date et son consentement', async () => {
    const original = await submitOne('Camille Arnoult', 'camille@exemple.test');
    const before = await db.queryOne<{ submitted_at: string; consent_text: string }>(
      OWNER,
      'select submitted_at, consent_text from public.survey_responses where id = $1',
      [original],
    );

    const corrected = await db.queryOne<{ correct_survey_response: string }>(
      asUser(admin),
      'select public.correct_survey_response($1, $2::jsonb)',
      [original, JSON.stringify({ nom: 'Camille ARNOULT', email: 'camille@exemple.test' })],
    );
    const newId = corrected?.correct_survey_response;
    expect(newId).toBeTruthy();

    // L'originale n'est pas réécrite : elle sort des comptages, c'est tout.
    const old = await db.queryOne<{ deleted_at: string | null; data: { nom: string } }>(
      OWNER,
      'select deleted_at, data from public.survey_responses where id = $1',
      [original],
    );
    expect(old?.deleted_at).not.toBeNull();
    expect(old?.data.nom).toBe('Camille Arnoult');

    // La copie porte la correction, la MÊME date et la MÊME preuve.
    const fresh = await db.queryOne<{
      data: { nom: string };
      submitted_at: string;
      consent_text: string;
      corrects_id: string;
    }>(
      OWNER,
      `select data, submitted_at, consent_text, corrects_id
         from public.survey_responses where id = $1`,
      [newId],
    );
    expect(fresh?.data.nom).toBe('Camille ARNOULT');
    expect(fresh?.submitted_at).toEqual(before?.submitted_at);
    expect(fresh?.consent_text).toBe(before?.consent_text);
    expect(fresh?.corrects_id).toBe(original);
  });

  it('ne change pas le nombre de réponses vivantes', async () => {
    const original = await submitOne('Nadia Belkacem', 'nadia@exemple.test');
    const count = async () =>
      (
        await db.queryOne<{ n: string }>(
          OWNER,
          `select count(*) as n from public.survey_responses
            where survey_id = $1 and deleted_at is null`,
          [surveyId],
        )
      )?.n;

    const before = await count();
    await db.query(asUser(admin), 'select public.correct_survey_response($1, $2::jsonb)', [
      original,
      JSON.stringify({ nom: 'Nadia BELKACEM', email: 'nadia@exemple.test' }),
    ]);
    expect(await count()).toBe(before);
  });

  it('garde la clé anti-doublon exploitable : l’index est partiel', async () => {
    // Si l'index n'excluait pas les lignes supprimées, la copie porterait une
    // clé déjà prise et l'insertion échouerait.
    const original = await submitOne('Thomas Reverdy', 'thomas@exemple.test');
    const corrected = await db.queryOne<{ correct_survey_response: string }>(
      asUser(admin),
      'select public.correct_survey_response($1, $2::jsonb)',
      [original, JSON.stringify({ nom: 'Thomas REVERDY', email: 'thomas@exemple.test' })],
    );
    expect(corrected?.correct_survey_response).toBeTruthy();
  });

  it('refuse de corriger une réponse déjà corrigée', async () => {
    // Elle est en suppression logique : elle n'existe plus pour l'appelant.
    const original = await submitOne('Karim Zebiri', 'karim@exemple.test');
    await db.query(asUser(admin), 'select public.correct_survey_response($1, $2::jsonb)', [
      original,
      JSON.stringify({ nom: 'Karim ZEBIRI', email: 'karim@exemple.test' }),
    ]);

    let failed = false;
    try {
      await db.query(asUser(admin), 'select public.correct_survey_response($1, $2::jsonb)', [
        original,
        JSON.stringify({ nom: 'Encore', email: 'karim@exemple.test' }),
      ]);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('journalise la correction sans recopier la réponse', async () => {
    const original = await submitOne('Sofia Nunes', 'sofia@exemple.test');
    await db.query(asUser(admin), 'select public.correct_survey_response($1, $2::jsonb)', [
      original,
      JSON.stringify({ nom: 'Sofia NUNES', email: 'sofia@exemple.test' }),
    ]);

    const entry = await db.queryOne<{ meta: Record<string, unknown> }>(
      OWNER,
      `select meta from public.audit_log
        where action = 'survey_response_corrected'
          and meta ->> 'corrects_id' = $1`,
      [original],
    );
    expect(entry).toBeTruthy();
    // Le journal n'est pas une seconde copie des données personnelles.
    expect(JSON.stringify(entry?.meta)).not.toContain('Sofia');
  });
});
