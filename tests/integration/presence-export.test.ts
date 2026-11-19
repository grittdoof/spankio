import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as setCheckin } from '@/app/api/checkin/[id]/route';
import { GET as presence } from '@/app/api/admin/surveys/[id]/presence/route';
import { GET as summary } from '@/app/api/admin/surveys/[id]/synthese/route';
import { PATCH as patchSurvey } from '@/app/api/admin/surveys/[id]/route';
import { createTestDb, type TestDb } from '../helpers/db';
import { createRouteHarness, jsonRequest, readJson, type RouteHarness } from '../helpers/route';
import {
  assignStaff,
  createSurvey,
  insertResponse,
  seedTwoTenants,
  type Tenant,
} from '../helpers/seed';

/**
 * La feuille de présence, de bout en bout.
 *
 * Ce qui est vérifié ici n'est pas qu'une fonction pure calcule bien — c'est
 * déjà couvert — mais que le chemin ENTIER tient : des arrivées pointées par
 * une hôtesse au travers de la vraie route de pointage, relues par la route
 * d'export sous les vraies policies, et rendues dans un fichier qu'on peut
 * ouvrir. Une feuille juste dans un module pur et fausse dans le fichier
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
            { value: 'oui', label: 'Oui' },
            { value: 'non', label: 'Non' },
          ],
        },
        {
          id: 'accompagnants',
          type: 'select',
          label: 'Nombre de personnes vous accompagnant',
          options: [
            { value: 'a0', label: '0' },
            { value: 'a1', label: '1' },
          ],
        },
        { id: 'nom', type: 'text', label: 'Nom' },
        { id: 'societe', type: 'text', label: 'Société' },
      ],
    },
  ],
};

describe('feuille de présence', () => {
  let db: TestDb;
  let api: RouteHarness;
  let a: Tenant;
  let b: Tenant;
  let surveyId: string;
  let venue: string;
  let absente: string;

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

    venue = await insertResponse(db, surveyId, {
      presence: 'oui',
      accompagnants: 'a1',
      nom: 'Alice Bernard',
      societe: 'ACME',
    });
    absente = await insertResponse(db, surveyId, {
      presence: 'oui',
      nom: 'Zoé Durand',
      societe: 'ACME',
    });
    await insertResponse(db, surveyId, { presence: 'non', nom: 'Bruno Petit' });

    api.actAs(a.admin);
    await patchSurvey(
      jsonRequest('PATCH', `/api/admin/surveys/${surveyId}`, {
        settings: {
          attendance: {
            presenceField: 'presence',
            presenceValue: 'oui',
            partyField: 'accompagnants',
            partyMode: 'extra',
            identityFields: ['nom'],
            detailField: 'societe',
          },
        },
      }),
      params(surveyId),
    );

    // Les arrivées passent par la VRAIE route de pointage, avec un compte
    // d'accueil affecté : un état inséré à la main dans la table ne prouverait
    // rien du chemin qu'empruntent les hôtesses.
    await assignStaff(db, surveyId, a.host, a.organisationId);
    api.actAs(a.host);
    const arrival = await readJson(
      await setCheckin(
        jsonRequest('POST', `/api/checkin/${surveyId}`, {
          responseId: venue,
          seat: 0,
          arrived: true,
          expectedVersion: null,
          opId: randomUUID(),
        }),
        params(surveyId),
      ),
    );
    expect(arrival.status).toBe(200);

    // Un cadeau remis à quelqu'un que la porte n'avait pas pointé : le
    // rapport le dit, il n'invente pas l'arrivée qui va avec.
    const gift = await readJson(
      await setCheckin(
        jsonRequest('POST', `/api/checkin/${surveyId}`, {
          responseId: absente,
          seat: 0,
          kind: 'gift',
          arrived: true,
          expectedVersion: null,
          opId: randomUUID(),
        }),
        params(surveyId),
      ),
    );
    expect(gift.status).toBe(200);
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  it('écrit une ligne par PERSONNE, venue ou non', async () => {
    api.actAs(a.admin);
    const response = await presence(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/presence?format=csv`),
      params(surveyId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('gala-presence-');

    const lines = (await response.text()).split('\r\n').filter((line) => line !== '');
    expect(lines[0]).toContain('Nom;Précision;Annoncé;Présence;Heure d’arrivée');

    // Classée de A à Z, l'accompagnante restant collée à son hôte. Alice est
    // entrée ; sa place accompagnante n'a pas été pointée, et elle n'est donc
    // pas venue — l'arrivée de l'un ne vaut pas celle de l'autre.
    expect(lines[1]).toContain('Alice Bernard;ACME;Présent;Venu(e);');
    expect(lines[2]).toContain('Invité;accompagnant(e) de Alice Bernard;Présent;Non venu(e)');
    expect(lines[3]).toContain('Bruno Petit;;Décline;Non venu(e)');
    // Le cadeau se lit même sans arrivée.
    expect(lines[4]).toMatch(/Zoé Durand;ACME;Présent;Non venu\(e\);;\d{2}\/\d{2} \d{2}:\d{2}/);
  });

  it('produit un classeur que l’on peut ouvrir', async () => {
    api.actAs(a.admin);
    const response = await presence(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/presence?format=xlsx`),
      params(surveyId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toContain('.xlsx');

    const bytes = new Uint8Array(await response.arrayBuffer());
    // « PK » : la signature d'une archive ZIP, donc d'un classeur.
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Alice Bernard');
    expect(text).toContain('Non venu(e)');
  });

  it('refuse un format inconnu plutôt que d’en choisir un', async () => {
    api.actAs(a.admin);
    const response = await presence(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/presence?format=pdf`),
      params(surveyId),
    );
    expect(response.status).toBe(400);
  });

  it('reste refusée à une autre organisation', async () => {
    // Le RLS masque la ligne : la feuille d'un tenant n'existe pas pour
    // l'autre, et un 404 ne confirme même pas son existence.
    api.actAs(b.editor);
    const response = await presence(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/presence?format=csv`),
      params(surveyId),
    );
    expect(response.status).toBe(404);
  });

  it('produit une synthèse Word, chiffrée et sans aucun nom', async () => {
    // La synthèse se transmet là où la liste ne peut pas aller : elle ne doit
    // donc porter que des chiffres, jamais une personne.
    api.actAs(a.admin);
    const response = await summary(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/synthese?format=docx`),
      params(surveyId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('wordprocessingml.document');
    expect(response.headers.get('content-disposition')).toContain('gala-synthese-');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Ce qui s’est passé');
    expect(text).toContain('Quand les gens sont arrivés');
    expect(text).not.toContain('Alice Bernard');
  });

  it('refuse à la synthèse un format qu’elle ne produit pas', async () => {
    // Le PDF sort de la page imprimable, pas d'ici : le dire plutôt que de
    // rendre un fichier qui ne serait pas celui qu'on a demandé.
    api.actAs(a.admin);
    const response = await summary(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/synthese?format=pdf`),
      params(surveyId),
    );
    expect(response.status).toBe(400);
  });

  it('garde la synthèse hors de portée d’une autre organisation', async () => {
    api.actAs(b.editor);
    const response = await summary(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/synthese?format=docx`),
      params(surveyId),
    );
    expect(response.status).toBe(404);
  });

  it('refuse un visiteur sans session', async () => {
    api.actAsAnonymous();
    const response = await presence(
      jsonRequest('GET', `/api/admin/surveys/${surveyId}/presence?format=csv`),
      params(surveyId),
    );
    expect(response.status).toBe(401);
  });
});
