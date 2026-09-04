import { describe, expect, it } from 'vitest';
import { MAX_LENGTHS, MAX_PAYLOAD_BYTES } from '@/lib/survey/limits';
import { OTHER_VALUE, otherKey, validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import {
  dedupValueFrom,
  missingRequiredFields,
  payloadSize,
  validateResponse,
  type ResponseErrorCode,
} from '@/lib/survey/validate-response';

/**
 * Barrière serveur : ces tests décrivent ce qu'un client hostile ne peut PAS
 * faire passer. Chaque cas correspond à une tentative plausible, pas à une
 * curiosité théorique.
 */

/**
 * Caractères construits par point de code : les écrire littéralement rendrait
 * le fichier illisible et le corromprait au copier-coller — alors que c'est
 * précisément ce que la validation doit retirer.
 */
const ZERO_WIDTH = String.fromCodePoint(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const NUL = String.fromCodePoint(0x00);

function build(fields: unknown[]): SurveySchema {
  const result = validateSurveySchema({ version: 1, steps: [{ id: 'etape_1', fields }] });
  if (!result.ok) throw new Error(`Schéma de test invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
}

function codes(schema: SurveySchema, data: unknown): ResponseErrorCode[] {
  const result = validateResponse(schema, data);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

function accepted(schema: SurveySchema, data: unknown): Record<string, unknown> {
  const result = validateResponse(schema, data);
  if (!result.ok) throw new Error(`Refus inattendu : ${JSON.stringify(result.errors)}`);
  return result.value.data;
}

describe('forme du payload', () => {
  const schema = build([{ id: 'nom', type: 'text', label: 'Nom' }]);

  it('refuse ce qui n’est pas un objet', () => {
    for (const input of [null, undefined, 'texte', 42, [], true]) {
      expect(codes(schema, input)).toContain('payload_not_object');
    }
  });

  it('refuse un payload dépassant le plafond', () => {
    expect(codes(schema, { nom: 'x'.repeat(MAX_PAYLOAD_BYTES) })).toContain('payload_too_large');
  });

  it('refuse un nombre de clés anormal', () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) data[`champ_${i}`] = 'x';
    expect(codes(schema, data)).toContain('too_many_fields');
  });

  it('refuse une clé inconnue plutôt que de l’ignorer', () => {
    // Ignorer silencieusement laisserait un client faire grossir `data`.
    expect(codes(schema, { nom: 'Camille', injecte: 'valeur' })).toContain('unknown_field');
  });

  it('ne renvoie jamais un payload plus gros que celui reçu', () => {
    const data = { nom: '  Camille   Martin  ' };
    const result = validateResponse(schema, data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(payloadSize(result.value.data)).toBeLessThanOrEqual(payloadSize(data));
    }
  });
});

describe('champs texte', () => {
  const schema = build([
    { id: 'nom', type: 'text', label: 'Nom', required: true },
    { id: 'commentaire', type: 'textarea', label: 'Commentaire' },
  ]);

  it('accepte et normalise une saisie', () => {
    expect(accepted(schema, { nom: '  Camille   Martin ' })).toEqual({ nom: 'Camille Martin' });
  });

  it('exige un champ requis', () => {
    expect(codes(schema, {})).toContain('required');
    expect(codes(schema, { nom: '   ' })).toContain('required');
  });

  it('refuse une valeur qui n’est pas une chaîne', () => {
    expect(codes(schema, { nom: 42 })).toContain('not_a_string');
    expect(codes(schema, { nom: ['a'] })).toContain('not_a_string');
    expect(codes(schema, { nom: { a: 1 } })).toContain('not_a_string');
  });

  it('refuse un texte trop long', () => {
    expect(codes(schema, { nom: 'a'.repeat(MAX_LENGTHS.text + 1) })).toContain('too_long');
  });

  it('mesure la longueur APRÈS nettoyage, sinon la limite serait contournable', () => {
    const invisible = 'a'.repeat(MAX_LENGTHS.text) + ZERO_WIDTH.repeat(50);
    expect(accepted(schema, { nom: invisible })['nom']).toHaveLength(MAX_LENGTHS.text);
  });

  it('retire les caractères de contrôle et les marques de direction', () => {
    // Un RLO permet d'afficher une valeur à l'envers dans un export.
    expect(accepted(schema, { nom: `Camille ${RIGHT_TO_LEFT_OVERRIDE}Martin` })).toEqual({
      nom: 'Camille Martin',
    });
    expect(accepted(schema, { nom: `Cami${NUL}lle` })).toEqual({ nom: 'Camille' });
  });

  it('conserve les sauts de ligne d’un textarea, pas ceux d’un texte simple', () => {
    expect(accepted(schema, { nom: 'Camille\nMartin' })['nom']).toBe('Camille Martin');
    expect(accepted(schema, { nom: 'x', commentaire: 'ligne 1\nligne 2' })['commentaire']).toBe(
      'ligne 1\nligne 2',
    );
  });

  it('respecte une longueur maximale déclarée dans le schéma', () => {
    const court = build([{ id: 'nom', type: 'text', label: 'Nom', maxLength: 5 }]);
    expect(codes(court, { nom: 'Camille' })).toContain('too_long');
    expect(accepted(court, { nom: 'Cami' })).toEqual({ nom: 'Cami' });
  });
});

describe('adresse et téléphone', () => {
  const schema = build([
    { id: 'email', type: 'email', label: 'Adresse' },
    { id: 'tel', type: 'tel', label: 'Téléphone' },
  ]);

  it('accepte une adresse plausible', () => {
    expect(accepted(schema, { email: 'camille@exemple.test' })['email']).toBe(
      'camille@exemple.test',
    );
  });

  it('refuse une adresse implausible', () => {
    for (const email of ['camille', 'camille@', '@exemple.test', 'camille@exemple', 'a b@c.test']) {
      expect(codes(schema, { email }), email).toContain('invalid_email');
    }
  });

  it('accepte un téléphone aux formats courants', () => {
    for (const tel of ['0102030405', '01 02 03 04 05', '+33 1 02 03 04 05', '(01) 02-03-04-05']) {
      expect(codes(schema, { tel }), tel).toEqual([]);
    }
  });

  it('refuse un téléphone qui n’en est pas un', () => {
    expect(codes(schema, { tel: 'appelez-moi' })).toContain('invalid_tel');
  });
});

describe('nombres et échelles', () => {
  const schema = build([
    { id: 'quantite', type: 'number', label: 'Quantité', min: 1, max: 10 },
    { id: 'note', type: 'scale', label: 'Note', min: 1, max: 5 },
  ]);

  it('accepte un nombre envoyé comme texte (formulaire sans JavaScript)', () => {
    expect(accepted(schema, { quantite: '3' })).toEqual({ quantite: 3 });
    // Virgule décimale : une saisie française normale.
    expect(accepted(schema, { quantite: '2,5' })).toEqual({ quantite: 2.5 });
  });

  it('refuse ce qui n’est pas un nombre', () => {
    for (const value of ['trois', {}, [], true, 'NaN', 'Infinity']) {
      expect(codes(schema, { quantite: value })).toContain('not_a_number');
    }
  });

  it('refuse une valeur hors bornes', () => {
    expect(codes(schema, { quantite: 0 })).toContain('out_of_range');
    expect(codes(schema, { quantite: 11 })).toContain('out_of_range');
  });

  it('exige un entier pour une échelle', () => {
    expect(codes(schema, { note: 3.5 })).toContain('not_an_integer');
    expect(accepted(schema, { note: '4' })).toEqual({ note: 4 });
  });

  it('refuse une note hors de l’échelle', () => {
    expect(codes(schema, { note: 0 })).toContain('out_of_range');
    expect(codes(schema, { note: 6 })).toContain('out_of_range');
  });

  it('traite une chaîne vide comme une absence de réponse', () => {
    expect(accepted(schema, { quantite: '', note: '' })).toEqual({});
  });
});

describe('dates', () => {
  const schema = build([
    { id: 'jour', type: 'date', label: 'Jour', min: '2027-01-01', max: '2027-12-31' },
  ]);

  it('accepte une date réelle dans les bornes', () => {
    expect(accepted(schema, { jour: '2027-06-15' })).toEqual({ jour: '2027-06-15' });
  });

  it('refuse une date qui n’existe pas', () => {
    for (const jour of ['2027-02-31', '2027-13-01', '2027-00-10', '2027-04-31']) {
      expect(codes(schema, { jour }), jour).toContain('invalid_date');
    }
  });

  it('refuse un format non ISO', () => {
    expect(codes(schema, { jour: '15/06/2027' })).toContain('invalid_date');
  });

  it('refuse une date hors bornes', () => {
    expect(codes(schema, { jour: '2026-12-31' })).toContain('date_out_of_range');
    expect(codes(schema, { jour: '2028-01-01' })).toContain('date_out_of_range');
  });
});

describe('choix unique', () => {
  const schema = build([
    {
      id: 'venue',
      type: 'radio',
      label: 'Venez-vous ?',
      options: [
        { value: 'oui', label: 'Oui' },
        { value: 'non', label: 'Non' },
      ],
      allowOther: true,
    },
  ]);

  it('accepte une option du schéma', () => {
    expect(accepted(schema, { venue: 'oui' })).toEqual({ venue: 'oui' });
  });

  it('refuse une option inventée', () => {
    expect(codes(schema, { venue: 'peut_etre' })).toContain('unknown_option');
  });

  it('accepte le choix libre avec sa saisie', () => {
    expect(
      accepted(schema, { venue: OTHER_VALUE, [otherKey('venue')]: '  Sous réserve ' }),
    ).toEqual({ venue: OTHER_VALUE, [otherKey('venue')]: 'Sous réserve' });
  });

  it('traite un choix libre sans saisie comme une absence de réponse', () => {
    expect(accepted(schema, { venue: OTHER_VALUE })).toEqual({});
  });

  it('refuse le choix libre si le schéma ne l’autorise pas', () => {
    const strict = build([
      {
        id: 'venue',
        type: 'select',
        label: 'Venez-vous ?',
        options: [{ value: 'oui', label: 'Oui' }],
      },
    ]);
    expect(codes(strict, { venue: OTHER_VALUE })).toContain('unknown_option');
  });
});

describe('choix multiple', () => {
  const schema = build([
    {
      id: 'jours',
      type: 'checkbox',
      label: 'Jours possibles',
      options: [
        { value: 'lundi', label: 'Lundi' },
        { value: 'mardi', label: 'Mardi' },
        { value: 'mercredi', label: 'Mercredi' },
      ],
      minSelected: 1,
      maxSelected: 2,
    },
  ]);

  it('accepte une sélection valide', () => {
    expect(accepted(schema, { jours: ['lundi', 'mardi'] })).toEqual({ jours: ['lundi', 'mardi'] });
  });

  it('accepte une case unique envoyée comme chaîne', () => {
    expect(accepted(schema, { jours: 'lundi' })).toEqual({ jours: ['lundi'] });
  });

  it('réordonne selon le schéma, pas selon l’envoi', () => {
    // Sans cela, deux réponses identiques donneraient des colonnes d'export
    // différentes selon l'ordre de clic.
    expect(accepted(schema, { jours: ['mardi', 'lundi'] })['jours']).toEqual(['lundi', 'mardi']);
  });

  it('refuse une option inconnue et les doublons', () => {
    expect(codes(schema, { jours: ['lundi', 'jeudi'] })).toContain('unknown_option');
    expect(codes(schema, { jours: ['lundi', 'lundi'] })).toContain('duplicate_selection');
  });

  it('applique les bornes de sélection', () => {
    expect(codes(schema, { jours: ['lundi', 'mardi', 'mercredi'] })).toContain('too_many_selected');
  });

  it('refuse une valeur qui n’est pas une liste', () => {
    expect(codes(schema, { jours: { lundi: true } })).toContain('not_a_list');
    expect(codes(schema, { jours: [1, 2] })).toContain('not_a_string');
  });
});

describe('grille de cases à cocher', () => {
  const schema = build([
    {
      id: 'dispos',
      type: 'checkbox_grid',
      label: 'Disponibilités',
      rows: [
        { value: 'lundi', label: 'Lundi' },
        { value: 'mardi', label: 'Mardi' },
      ],
      columns: [
        { value: 'matin', label: 'Matin' },
        { value: 'apres_midi', label: 'Après-midi' },
      ],
    },
  ]);

  it('accepte une grille valide et la réordonne', () => {
    expect(
      accepted(schema, { dispos: { mardi: ['apres_midi', 'matin'], lundi: ['matin'] } })['dispos'],
    ).toEqual({ lundi: ['matin'], mardi: ['matin', 'apres_midi'] });
  });

  it('refuse une ligne ou une colonne inconnue', () => {
    expect(codes(schema, { dispos: { dimanche: ['matin'] } })).toContain('unknown_grid_row');
    expect(codes(schema, { dispos: { lundi: ['soir'] } })).toContain('unknown_option');
  });

  it('refuse ce qui n’est pas une grille', () => {
    expect(codes(schema, { dispos: ['matin'] })).toContain('not_a_grid');
    expect(codes(schema, { dispos: 'matin' })).toContain('not_a_grid');
  });

  it('applique le choix unique par ligne quand il est demandé', () => {
    const single = build([
      {
        id: 'dispos',
        type: 'checkbox_grid',
        label: 'Disponibilités',
        rows: [{ value: 'lundi', label: 'Lundi' }],
        columns: [
          { value: 'matin', label: 'Matin' },
          { value: 'apres_midi', label: 'Après-midi' },
        ],
        singleChoicePerRow: true,
      },
    ]);
    expect(codes(single, { dispos: { lundi: ['matin', 'apres_midi'] } })).toContain(
      'single_choice_per_row',
    );
  });

  it('ignore une ligne sans colonne cochée', () => {
    expect(accepted(schema, { dispos: { lundi: [] } })).toEqual({});
  });
});

describe('champs conditionnels', () => {
  const schema = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [
            {
              id: 'venue',
              type: 'radio',
              label: 'Venez-vous ?',
              options: [
                { value: 'oui', label: 'Oui' },
                { value: 'non', label: 'Non' },
              ],
            },
            {
              id: 'accompagnants',
              type: 'number',
              label: 'Combien de personnes ?',
              required: true,
              condition: { field: 'venue', op: 'equals', value: 'oui' },
            },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error('schéma de test invalide');
    return result.schema;
  })();

  it('exige le champ conditionnel quand la condition est remplie', () => {
    expect(codes(schema, { venue: 'oui' })).toContain('required');
    expect(accepted(schema, { venue: 'oui', accompagnants: 2 })).toEqual({
      venue: 'oui',
      accompagnants: 2,
    });
  });

  it('n’exige rien quand le champ est masqué', () => {
    expect(accepted(schema, { venue: 'non' })).toEqual({ venue: 'non' });
  });

  it('retire — sans erreur — la valeur d’un champ devenu inapplicable', () => {
    // Cas réel : le répondant répond « oui », saisit 3, puis revient et coche
    // « non ». Refuser serait transformer une navigation normale en erreur.
    const result = validateResponse(schema, { venue: 'non', accompagnants: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toEqual({ venue: 'non' });
      expect(result.value.dropped).toEqual(['accompagnants']);
    }
  });

  it('recense les champs requis manquants pour le renderer', () => {
    expect(missingRequiredFields(schema, { venue: 'oui' })).toEqual(['accompagnants']);
    expect(missingRequiredFields(schema, { venue: 'non' })).toEqual([]);
  });
});

describe('clé anti-doublon', () => {
  it('extrait la valeur du champ désigné', () => {
    expect(dedupValueFrom({ email: 'camille@exemple.test' }, 'email')).toBe(
      'camille@exemple.test',
    );
    expect(dedupValueFrom({ numero: 42 }, 'numero')).toBe('42');
  });

  it('renvoie null quand le champ est absent, vide ou non scalaire', () => {
    expect(dedupValueFrom({}, 'email')).toBeNull();
    expect(dedupValueFrom({ email: '   ' }, 'email')).toBeNull();
    expect(dedupValueFrom({ email: ['a'] }, 'email')).toBeNull();
    expect(dedupValueFrom({ email: 'a@b.test' }, null)).toBeNull();
  });
});
