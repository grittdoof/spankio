import { describe, expect, it } from 'vitest';
import {
  answerText,
  guestList,
  initialsOf,
  normaliseSearch,
  parseGuestFilter,
} from '@/lib/survey/guests';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import type { AttendanceSettings } from '@/lib/survey/attendance';

/**
 * Liste d'accueil.
 *
 * Ces tests fixent surtout deux refus : ne rien DEVINER (le nom d'un invité est
 * désigné, sans quoi la rangée est titrée par sa date) et ne jamais afficher la
 * VALEUR d'une option à la place de son libellé — celle-ci est un identifiant
 * figé à la création, qui ne veut rien dire pour une personne.
 */

const schema: SurveySchema = (() => {
  const result = validateSurveySchema({
    version: 1,
    steps: [
      {
        id: 'etape_1',
        fields: [
          {
            id: 'presence',
            type: 'radio',
            label: 'Serez-vous présent ?',
            options: [
              { value: 'oui', label: 'Oui' },
              { value: 'non', label: 'Non' },
            ],
          },
          { id: 'accompagnants', type: 'number', label: 'Combien ?', min: 0, max: 10 },
          { id: 'nom', type: 'text', label: 'Nom et prénom' },
          { id: 'email', type: 'email', label: 'Adresse électronique' },
          {
            id: 'societe',
            type: 'select',
            label: 'Société',
            allowOther: true,
            options: [
              { value: 'option_1', label: 'Spie batignolles' },
              { value: 'option_2', label: 'Ville de Paris' },
            ],
          },
          {
            id: 'regimes',
            type: 'checkbox',
            label: 'Régimes',
            options: [
              { value: 'option_1', label: 'Végétarien' },
              { value: 'option_2', label: 'Sans gluten' },
            ],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
})();

const field = (id: string) => schema.steps[0]!.fields.find((f) => f.id === id)!;

const SETTINGS: AttendanceSettings = {
  presenceField: 'presence',
  presenceValue: 'oui',
  partyField: 'accompagnants',
  partyMode: 'extra',
  identityField: 'nom',
  detailField: 'societe',
};

const response = (
  id: string,
  data: Record<string, unknown>,
  submittedAt = '2026-09-01T10:00:00Z',
) => ({ id, submitted_at: submittedAt, data });

describe('texte d’une réponse', () => {
  it('rend le LIBELLÉ d’une option, jamais sa valeur', () => {
    expect(answerText(field('societe'), { societe: 'option_1' })).toBe('Spie batignolles');
  });

  it('rend la saisie libre quand l’option « autre » a été choisie', () => {
    expect(
      answerText(field('societe'), { societe: 'other', societe__other: 'Atelier Sauvage' }),
    ).toBe('Atelier Sauvage');
  });

  it('ne rend rien pour un « autre » resté vide, plutôt que le mot « other »', () => {
    expect(answerText(field('societe'), { societe: 'other' })).toBeNull();
  });

  it('joint les libellés d’un choix multiple', () => {
    expect(answerText(field('regimes'), { regimes: ['option_2', 'option_1'] })).toBe(
      'Sans gluten, Végétarien',
    );
  });

  it('ne rend rien pour une absence de réponse', () => {
    expect(answerText(field('nom'), {})).toBeNull();
    expect(answerText(field('nom'), { nom: '' })).toBeNull();
  });
});

describe('initiales', () => {
  it('prend au plus deux lettres, une par mot', () => {
    expect(initialsOf('Camille Arnoult')).toBe('CA');
    expect(initialsOf('Jean Pierre Marie Dupont')).toBe('JP');
    expect(initialsOf('Nadia')).toBe('N');
  });

  it('compte les lettres accentuées pour une seule', () => {
    expect(initialsOf('Élodie Marchand')).toBe('ÉM');
  });

  it('ignore ce qui n’est pas une lettre', () => {
    expect(initialsOf('  42 ')).toBe('');
    expect(initialsOf('')).toBe('');
  });
});

describe('recherche', () => {
  it('ignore la casse ET les accents', () => {
    expect(normaliseSearch('  Élodie ')).toBe('elodie');
  });

  it('trouve « Élodie » en tapant « elodie »', () => {
    const list = guestList(
      schema,
      SETTINGS,
      [
        response('1', { presence: 'oui', nom: 'Élodie Marchand' }),
        response('2', { presence: 'oui', nom: 'Karim Zebiri' }),
      ],
      { search: 'elodie' },
    );
    expect(list.rows.map((row) => row.id)).toEqual(['1']);
  });

  it('cherche aussi dans ce qui n’est PAS affiché', () => {
    // « Sans gluten » n'apparaît sur aucune rangée : la chercher doit pourtant
    // ramener la ligne, sinon la recherche paraîtrait cassée.
    const list = guestList(
      schema,
      SETTINGS,
      [
        response('1', { presence: 'oui', nom: 'A', regimes: ['option_2'] }),
        response('2', { presence: 'oui', nom: 'B' }),
      ],
      { search: 'gluten' },
    );
    expect(list.rows.map((row) => row.id)).toEqual(['1']);
  });
});

describe('filtres', () => {
  const responses = [
    response('1', { presence: 'oui', nom: 'Camille Arnoult', societe: 'option_1', accompagnants: 2 }),
    response('2', { presence: 'non', nom: 'Karim Zebiri' }),
    response('3', { nom: 'Thomas Reverdy' }),
    response('4', { presence: 'oui', nom: 'Sofia Nunes' }),
  ];

  it('ne retient que des clés connues', () => {
    expect(parseGuestFilter('presents')).toBe('attending');
    expect(parseGuestFilter('nimporte')).toBe('all');
  });

  it('compte AVANT de filtrer : une puce ne change pas de valeur selon la puce active', () => {
    const filtered = guestList(schema, SETTINGS, responses, { filter: 'declined' });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.counts).toEqual({ all: 4, attending: 2, declined: 1, unknown: 1 });
    expect(filtered.hidden).toBe(3);
  });

  it('compose la rangée avec le nom, la seconde information et l’effectif', () => {
    const list = guestList(schema, SETTINGS, responses);
    expect(list.rows[0]).toMatchObject({
      name: 'Camille Arnoult',
      initials: 'CA',
      detail: 'Spie batignolles',
      status: 'attending',
      people: 3,
      ambiguous: false,
    });
  });

  it('conserve l’ordre reçu : la liste est déjà triée par la requête', () => {
    const list = guestList(schema, SETTINGS, responses);
    expect(list.rows.map((row) => row.id)).toEqual(['1', '2', '3', '4']);
  });
});

describe('sans désignation', () => {
  it('ne devine aucun nom : la rangée n’en a pas', () => {
    const list = guestList(
      schema,
      { presenceField: 'presence', presenceValue: 'oui' },
      [response('1', { presence: 'oui', nom: 'Camille Arnoult' })],
    );
    expect(list.rows[0]!.name).toBeNull();
    expect(list.rows[0]!.initials).toBe('');
    expect(list.rows[0]!.detail).toBeNull();
    // L'horodatage reste disponible : c'est lui qui titrera la rangée.
    expect(list.rows[0]!.submittedAt).toBe('2026-09-01T10:00:00Z');
  });

  it('sans comptage configuré, tout est « sans réponse » et personne n’est compté', () => {
    const list = guestList(schema, {}, [response('1', { presence: 'oui' })]);
    expect(list.rows[0]!.status).toBe('unknown');
    expect(list.rows[0]!.people).toBe(0);
  });

  it('signale un effectif indéterminé plutôt que de l’arbitrer', () => {
    // Ambiguïté RÉELLE : la question du nombre peut porter un effectif, elle
    // était affichée, et elle est restée vide.
    const list = guestList(schema, SETTINGS, [
      response('1', { presence: 'oui', nom: 'A' }),
    ]);
    expect(list.rows[0]!.ambiguous).toBe(true);
    expect(list.rows[0]!.people).toBe(1);
  });

  it('ne signale RIEN quand la désignation est simplement incohérente', () => {
    // « Régimes » est une case à cocher aux libellés non numériques : elle ne
    // peut porter aucun effectif. La désigner est une erreur de réglage, pas
    // une ambiguïté de réponse — et marquer « à vérifier » chaque rangée
    // ferait passer une désignation cassée pour un problème de données.
    const list = guestList(
      schema,
      { ...SETTINGS, partyField: 'regimes' },
      [response('1', { presence: 'oui', nom: 'A', regimes: ['option_1', 'option_2'] })],
    );
    expect(list.rows[0]!.ambiguous).toBe(false);
    expect(list.rows[0]!.people).toBe(1);
  });
});
