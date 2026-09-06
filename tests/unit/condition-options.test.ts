import { describe, expect, it } from 'vitest';
import {
  buildCondition,
  conditionOperators,
  conditionParts,
  conditionValues,
  describeCondition,
  operatorNeedsValue,
} from '@/lib/survey/condition-options';
import { evaluateCondition } from '@/lib/survey/conditions';
import { FIELD_TYPES, validateDraftSchema, type SurveyField } from '@/lib/survey/schema';

/**
 * Ce qu'une condition peut dire.
 *
 * L'éditeur ne proposait qu'« a une réponse », alors que le moteur évalue six
 * opérateurs : une organisation ne pouvait pas écrire « n'afficher que si la
 * réponse est Oui ». Ces tests fixent ce qui est proposable par type de
 * question, et vérifient que ce qui est composé ici se déclenche réellement
 * dans le moteur — deux définitions divergentes auraient produit des
 * conditions muettes.
 */

function fieldOf(raw: unknown): SurveyField {
  const parsed = validateDraftSchema({ version: 1, steps: [{ id: 'e1', fields: [raw] }] });
  if (!parsed.ok) throw new Error(`Champ de test invalide : ${JSON.stringify(parsed.issues)}`);
  return parsed.schema.steps[0]!.fields[0]!;
}

const radio = fieldOf({
  id: 'venue',
  type: 'radio',
  label: 'Venez-vous ?',
  options: [
    { value: 'oui', label: 'Oui' },
    { value: 'non', label: 'Non' },
  ],
});

const checkbox = fieldOf({
  id: 'repas',
  type: 'checkbox',
  label: 'Repas',
  options: [
    { value: 'midi', label: 'Déjeuner' },
    { value: 'soir', label: 'Dîner' },
  ],
});

const grid = fieldOf({
  id: 'creneaux',
  type: 'checkbox_grid',
  label: 'Créneaux',
  rows: [
    { value: 'lundi', label: 'Lundi' },
    { value: 'mardi', label: 'Mardi' },
  ],
  columns: [
    { value: 'matin', label: 'Matin' },
    { value: 'apresmidi', label: 'Après-midi' },
  ],
});

const scale = fieldOf({ id: 'note', type: 'scale', label: 'Note', min: 1, max: 5 });
const text = fieldOf({ id: 'nom', type: 'text', label: 'Votre nom' });

describe('opérateurs proposés', () => {
  it('offre l’égalité sur un choix unique', () => {
    const ops = conditionOperators(radio).map((choice) => choice.op);
    expect(ops).toContain('equals');
    expect(ops).toContain('not_equals');
    // `includes` n'a pas de sens ici : la réponse est une valeur unique.
    expect(ops).not.toContain('includes');
  });

  it('offre l’appartenance sur un choix multiple', () => {
    const ops = conditionOperators(checkbox).map((choice) => choice.op);
    expect(ops).toContain('includes');
    expect(ops).toContain('not_includes');
    // `equals` échouerait dès qu'une seconde case est cochée : la réponse
    // cesse alors d'être une valeur unique.
    expect(ops).not.toContain('equals');
  });

  it('traite une grille comme un choix multiple', () => {
    expect(conditionOperators(grid).map((c) => c.op)).toContain('includes');
  });

  it('offre l’égalité sur une échelle, dont les valeurs sont closes', () => {
    expect(conditionOperators(scale).map((c) => c.op)).toContain('equals');
  });

  it.each(['text', 'textarea', 'email', 'tel', 'number', 'date'])(
    'n’offre QUE la présence sur une réponse libre (%s)',
    (type) => {
      const field = fieldOf(
        type === 'number'
          ? { id: 'n', type, label: 'Combien ?' }
          : { id: 'q', type, label: 'Question' },
      );
      expect(conditionOperators(field).map((c) => c.op)).toEqual([
        'answered',
        'not_answered',
      ]);
    },
  );

  it('propose toujours la présence, quel que soit le type', () => {
    for (const type of FIELD_TYPES) {
      const field = fieldOf(
        type === 'select' || type === 'radio' || type === 'checkbox'
          ? { id: 'q', type, label: 'Q', options: [{ value: 'a', label: 'A' }] }
          : type === 'checkbox_grid'
            ? {
                id: 'q',
                type,
                label: 'Q',
                rows: [{ value: 'r', label: 'R' }],
                columns: [{ value: 'c', label: 'C' }],
              }
            : type === 'scale'
              ? { id: 'q', type, label: 'Q', min: 1, max: 3 }
              : { id: 'q', type, label: 'Q' },
      );
      const ops = conditionOperators(field).map((choice) => choice.op);
      expect(ops, `type ${type}`).toContain('answered');
      expect(ops, `type ${type}`).toContain('not_answered');
    }
  });
});

describe('valeurs proposées', () => {
  it('reprend les options d’un choix', () => {
    expect(conditionValues(radio)).toEqual([
      { value: 'oui', label: 'Oui' },
      { value: 'non', label: 'Non' },
    ]);
  });

  it('reprend les COLONNES d’une grille, pas ses lignes', () => {
    // Le moteur compare l'union des colonnes cochées : proposer les lignes
    // laisserait croire à une condition que rien n'évalue.
    expect(conditionValues(grid).map((choice) => choice.value)).toEqual([
      'matin',
      'apresmidi',
    ]);
  });

  it('énumère les crans d’une échelle', () => {
    expect(conditionValues(scale).map((choice) => choice.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('ne propose aucune valeur pour une réponse libre', () => {
    expect(conditionValues(text)).toEqual([]);
  });
});

describe('composition', () => {
  it('compose une égalité sur une option existante', () => {
    expect(buildCondition(radio, 'equals', 'oui')).toEqual({
      field: 'venue',
      op: 'equals',
      value: 'oui',
    });
  });

  it('compose une présence sans valeur', () => {
    expect(buildCondition(text, 'answered', null)).toEqual({
      field: 'nom',
      op: 'answered',
    });
  });

  it('refuse une comparaison sans valeur', () => {
    // Sans valeur, la condition ne se déclencherait jamais, et l'organisation
    // croirait avoir posé une règle.
    expect(buildCondition(radio, 'equals', null)).toBeNull();
    expect(buildCondition(radio, 'equals', '')).toBeNull();
  });

  it('refuse une valeur absente de la question observée', () => {
    expect(buildCondition(radio, 'equals', 'peut-etre')).toBeNull();
  });

  it('refuse un opérateur que le type ne permet pas', () => {
    expect(buildCondition(text, 'equals', 'Jean')).toBeNull();
    expect(buildCondition(checkbox, 'equals', 'midi')).toBeNull();
    expect(buildCondition(radio, 'includes', 'oui')).toBeNull();
  });

  it('dit quels opérateurs exigent une valeur', () => {
    expect(operatorNeedsValue('equals')).toBe(true);
    expect(operatorNeedsValue('not_includes')).toBe(true);
    expect(operatorNeedsValue('answered')).toBe(false);
  });
});

describe('ce qui est composé se déclenche vraiment', () => {
  it('une égalité s’ouvre sur la bonne réponse et se referme sur l’autre', () => {
    const condition = buildCondition(radio, 'equals', 'oui');
    expect(condition).not.toBeNull();
    expect(evaluateCondition(condition!, { venue: 'oui' })).toBe(true);
    expect(evaluateCondition(condition!, { venue: 'non' })).toBe(false);
    expect(evaluateCondition(condition!, {})).toBe(false);
  });

  it('une appartenance suit une case cochée parmi plusieurs', () => {
    const condition = buildCondition(checkbox, 'includes', 'soir');
    expect(evaluateCondition(condition!, { repas: ['midi', 'soir'] })).toBe(true);
    expect(evaluateCondition(condition!, { repas: ['midi'] })).toBe(false);
  });

  it('une négation s’applique aussi à une question sans réponse', () => {
    // « autre que Oui » est vrai quand rien n'a été répondu : c'est la lecture
    // littérale, et celle du moteur.
    const condition = buildCondition(radio, 'not_equals', 'oui');
    expect(evaluateCondition(condition!, {})).toBe(true);
    expect(evaluateCondition(condition!, { venue: 'non' })).toBe(true);
    expect(evaluateCondition(condition!, { venue: 'oui' })).toBe(false);
  });

  it('une colonne de grille se déclenche quelle que soit la ligne', () => {
    const condition = buildCondition(grid, 'includes', 'matin');
    expect(evaluateCondition(condition!, { creneaux: { mardi: ['matin'] } })).toBe(true);
    expect(evaluateCondition(condition!, { creneaux: { lundi: ['apresmidi'] } })).toBe(false);
  });

  it('un cran d’échelle se compare bien qu’il soit numérique', () => {
    const condition = buildCondition(scale, 'equals', '4');
    expect(evaluateCondition(condition!, { note: 4 })).toBe(true);
    expect(evaluateCondition(condition!, { note: 5 })).toBe(false);
  });
});

describe('relecture', () => {
  it('décompose une condition simple pour réafficher l’éditeur', () => {
    expect(conditionParts({ field: 'venue', op: 'equals', value: 'oui' })).toEqual({
      field: 'venue',
      op: 'equals',
      value: 'oui',
    });
    expect(conditionParts({ field: 'nom', op: 'answered' })).toEqual({
      field: 'nom',
      op: 'answered',
      value: null,
    });
  });

  it('renonce sur une condition composée', () => {
    // L'éditeur ne sait pas construire `all` / `any` : prétendre l'afficher
    // l'écraserait au premier changement.
    expect(conditionParts({ all: [{ field: 'venue', op: 'answered' }] })).toBeNull();
    expect(conditionParts(undefined)).toBeNull();
  });

  it('rédige une phrase relisible', () => {
    expect(describeCondition({ field: 'venue', op: 'equals', value: 'oui' }, [radio])).toBe(
      '« Venez-vous ? » a pour réponse « Oui »',
    );
    expect(describeCondition({ field: 'nom', op: 'not_answered' }, [text])).toBe(
      '« Votre nom » n’a pas reçu de réponse',
    );
  });

  it('n’affiche rien quand la question observée a disparu', () => {
    // Mieux vaut ne rien dire qu'une phrase citant un identifiant technique.
    expect(describeCondition({ field: 'parti', op: 'answered' }, [radio])).toBeNull();
    expect(describeCondition({ field: 'venue', op: 'equals', value: 'parti' }, [radio])).toBeNull();
  });
});
