import { describe, expect, it } from 'vitest';
import {
  PRINT_SORT_SUBMITTED,
  parsePrintSort,
  printList,
  printSortOptions,
} from '@/lib/checkin/print';
import { guestList, type GuestResponse } from '@/lib/survey/guests';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import type { AttendanceSettings } from '@/lib/survey/attendance';

/**
 * Le listing papier et son classement.
 *
 * Deux refus sont fixés ici. D'abord que les critères soient les QUESTIONS du
 * formulaire et non une liste en dur : « Nom », « Prénom » et « Société »
 * n'existent pas dans une plateforme générique. Ensuite qu'un classement sur
 * une valeur INVISIBLE soit impossible — trier par société sans imprimer la
 * société produit un ordre que personne ne peut vérifier, et qu'on prendrait
 * pour un défaut.
 */

const schema: SurveySchema = (() => {
  const result = validateSurveySchema({
    version: 1,
    steps: [
      {
        id: 'etape_1',
        fields: [
          { id: 'nom', type: 'text', label: 'Nom' },
          { id: 'prenom', type: 'text', label: 'Prénom' },
          {
            id: 'societe',
            type: 'select',
            label: 'Société',
            options: [
              { value: 'option_1', label: 'Ville de Paris' },
              { value: 'option_2', label: 'Spie batignolles' },
            ],
          },
          { id: 'salle', type: 'text', label: 'Salle' },
          { id: 'mot', type: 'textarea', label: 'Un mot pour l’organisateur' },
          {
            id: 'regimes',
            type: 'checkbox',
            label: 'Régimes',
            options: [{ value: 'option_1', label: 'Végétarien' }],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
})();

const attendance: AttendanceSettings = { identityField: 'nom', detailField: 'prenom' };

function response(id: string, data: Record<string, unknown>, at: string): GuestResponse {
  return { id, submitted_at: at, data };
}

const RESPONSES: GuestResponse[] = [
  response('r1', { nom: 'Zola', prenom: 'Émile', societe: 'option_2', salle: 'Salle 10' }, '2026-11-01T10:00:00.000Z'),
  response('r2', { nom: 'Arnaud', prenom: 'Bea', societe: 'option_1', salle: 'Salle 2' }, '2026-11-02T10:00:00.000Z'),
  response('r3', { nom: 'Michel', prenom: 'Ana' }, '2026-11-03T10:00:00.000Z'),
];

function rowsOf() {
  return guestList(schema, attendance, RESPONSES).rows;
}

function namesFor(sortBy: string): (string | null)[] {
  const printed = printList(schema, attendance, rowsOf(), RESPONSES, sortBy);
  return printed.rows.map(({ row }) => row.name);
}

describe('printSortOptions', () => {
  it('ouvre sur l’ordre d’inscription, qui ne suppose rien', () => {
    expect(printSortOptions(schema)[0]).toEqual({
      value: PRINT_SORT_SUBMITTED,
      label: 'Ordre d’inscription',
    });
  });

  it('propose les questions du formulaire, par leur libellé', () => {
    const labels = printSortOptions(schema).map((option) => option.label);
    expect(labels).toContain('Nom');
    expect(labels).toContain('Prénom');
    expect(labels).toContain('Société');
  });

  it('écarte ce qui ne se classe pas', () => {
    // Un paragraphe libre trie sur une phrase entière, une case à cocher
    // multiple sur des libellés concaténés : exact, et inexploitable.
    const values = printSortOptions(schema).map((option) => option.value);
    expect(values).not.toContain('mot');
    expect(values).not.toContain('regimes');
  });
});

describe('parsePrintSort', () => {
  it('accepte une question du schéma', () => {
    expect(parsePrintSort('societe', schema, attendance)).toBe('societe');
  });

  it('retombe sur le nom désigné plutôt que sur rien', () => {
    expect(parsePrintSort(undefined, schema, attendance)).toBe('nom');
    expect(parsePrintSort('question_disparue', schema, attendance)).toBe('nom');
  });

  it('retombe sur l’ordre d’inscription sans désignation de nom', () => {
    // Sans question de nom désignée, inventer un classement reviendrait à
    // choisir à la place de l'organisation.
    expect(parsePrintSort(undefined, schema, {})).toBe(PRINT_SORT_SUBMITTED);
  });
});

describe('printList', () => {
  it('classe par la question choisie', () => {
    expect(namesFor('nom')).toEqual(['Arnaud', 'Michel', 'Zola']);
    expect(namesFor('prenom')).toEqual(['Michel', 'Arnaud', 'Zola']);
  });

  it('range les valeurs absentes en fin de liste', () => {
    // Une rangée sans société ne doit pas s'intercaler au hasard entre deux
    // sociétés : on la cherchera à la fin, pas au milieu.
    expect(namesFor('societe')).toEqual(['Zola', 'Arnaud', 'Michel']);
  });

  it('classe les nombres comme des nombres', () => {
    // « Salle 2 » avant « Salle 10 » : un tri strictement textuel inverse les
    // deux, et la liste paraît fausse.
    expect(namesFor('salle')).toEqual(['Arnaud', 'Zola', 'Michel']);
  });

  it('ajoute la colonne qui justifie le classement', () => {
    const printed = printList(schema, attendance, rowsOf(), RESPONSES, 'societe');
    expect(printed.sortColumn).toBe('Société');
    // Le LIBELLÉ de l'option, jamais sa valeur : « option_2 » ne veut rien
    // dire pour la personne qui tient la porte.
    expect(printed.rows[0]?.sortValue).toBe('Spie batignolles');
  });

  it('n’ajoute pas de colonne quand la question est déjà affichée', () => {
    expect(printList(schema, attendance, rowsOf(), RESPONSES, 'nom').sortColumn).toBeNull();
    expect(printList(schema, attendance, rowsOf(), RESPONSES, 'prenom').sortColumn).toBeNull();
    expect(
      printList(schema, attendance, rowsOf(), RESPONSES, PRINT_SORT_SUBMITTED).sortColumn,
    ).toBeNull();
  });

  it('écrit le classement appliqué, pour qu’il se lise sur le papier', () => {
    expect(printList(schema, attendance, rowsOf(), RESPONSES, 'societe').sortLabel).toBe('Société');
    expect(
      printList(schema, attendance, rowsOf(), RESPONSES, PRINT_SORT_SUBMITTED).sortLabel,
    ).toBe('Ordre d’inscription');
  });

  it('départage les égalités de façon stable', () => {
    // Deux homonymes sans autre différence changeraient d'ordre d'une
    // impression à l'autre, et l'on croirait la liste incohérente.
    const doubles: GuestResponse[] = [
      response('b', { nom: 'Martin', prenom: 'Zoé' }, '2026-11-05T10:00:00.000Z'),
      response('a', { nom: 'Martin', prenom: 'Zoé' }, '2026-11-04T10:00:00.000Z'),
    ];
    const rows = guestList(schema, attendance, doubles).rows;
    const printed = printList(schema, attendance, rows, doubles, 'nom');
    expect(printed.rows.map(({ row }) => row.id)).toEqual(['a', 'b']);
  });

  it('ne perd aucune rangée, quel que soit le classement', () => {
    for (const option of printSortOptions(schema)) {
      const printed = printList(schema, attendance, rowsOf(), RESPONSES, option.value);
      expect(printed.rows).toHaveLength(RESPONSES.length);
    }
  });
});
