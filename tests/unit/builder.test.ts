import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPE_LABELS,
  canAddField,
  conditionCandidates,
  danglingConditions,
  dedupCandidates,
  defaultField,
  defaultStep,
  moveItem,
  removeField,
  removeStep,
  uniqueIdentifier,
  usedIdentifiers,
} from '@/lib/survey/builder';
import { FIELD_TYPES, validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';

function schemaOf(steps: unknown[]): SurveySchema {
  const result = validateSurveySchema({ version: 1, steps });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
}

const base = schemaOf([
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
        label: 'Combien ?',
        condition: { field: 'venue', op: 'equals', value: 'oui' },
      },
    ],
  },
  {
    id: 'etape_2',
    condition: { field: 'venue', op: 'answered' },
    fields: [{ id: 'remarque', type: 'textarea', label: 'Remarque' }],
  },
]);

describe('identifiants', () => {
  it('dérive un identifiant lisible et conforme', () => {
    expect(uniqueIdentifier('Votre Adresse Électronique', new Set())).toBe(
      'votre_adresse_electronique',
    );
    expect(uniqueIdentifier('  ---  ', new Set())).toBe('champ');
    // Un identifiant ne peut pas commencer par un chiffre.
    expect(uniqueIdentifier('2027', new Set())).toBe('q2027');
  });

  it('évite les collisions par suffixe numéroté', () => {
    const used = new Set(['nom', 'nom_2']);
    expect(uniqueIdentifier('Nom', used)).toBe('nom_3');
  });

  it('recense tous les identifiants du schéma', () => {
    expect([...usedIdentifiers(base)].sort()).toEqual([
      'accompagnants',
      'etape_1',
      'etape_2',
      'remarque',
      'venue',
    ]);
  });
});

describe('champs créés par l’éditeur', () => {
  it.each(FIELD_TYPES)('%s : un champ neuf est immédiatement valide', (type) => {
    // Laisser l'éditeur produire un état invalide se paierait au moment
    // d'enregistrer, après le travail de l'utilisateur.
    const field = defaultField(type, new Set());
    const result = validateSurveySchema({
      version: 1,
      steps: [{ id: 'etape_1', fields: [field] }],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('donne deux options aux champs à choix, jamais zéro', () => {
    for (const type of ['select', 'radio', 'checkbox'] as const) {
      const field = defaultField(type, new Set());
      expect('options' in field && field.options).toHaveLength(2);
    }
  });

  it('nomme chaque type dans le sélecteur d’ajout', () => {
    for (const type of FIELD_TYPES) {
      expect(FIELD_TYPE_LABELS[type], type).toBeTruthy();
    }
  });

  it('une étape neuve est valide et contient déjà une question', () => {
    const step = defaultStep(new Set());
    const result = validateSurveySchema({ version: 1, steps: [step] });
    expect(result.ok).toBe(true);
    expect(step.fields).toHaveLength(1);
  });

  it('ne réutilise jamais un identifiant existant', () => {
    const used = usedIdentifiers(base);
    const field = defaultField('text', used);
    expect(used.has(field.id)).toBe(false);
  });
});

describe('déplacement', () => {
  it('déplace un élément et borne les indices', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    // Au-delà des bornes, on s'arrête au bord plutôt que de perdre l'élément.
    expect(moveItem(['a', 'b'], 0, 99)).toEqual(['b', 'a']);
    expect(moveItem(['a', 'b'], 1, -5)).toEqual(['b', 'a']);
  });

  it('ne modifie pas le tableau d’origine', () => {
    const original = ['a', 'b'];
    moveItem(original, 0, 1);
    expect(original).toEqual(['a', 'b']);
  });

  it('ignore un indice de départ invalide', () => {
    expect(moveItem(['a'], 5, 0)).toEqual(['a']);
  });
});

describe('suppression', () => {
  it('nettoie les conditions qui référençaient le champ supprimé', () => {
    // Sans ce nettoyage, le schéma deviendrait invalide et l'éditeur
    // refuserait d'enregistrer sans que l'utilisateur comprenne pourquoi.
    const next = removeField(base, 'venue');
    expect(validateSurveySchema(next).ok).toBe(true);

    const accompagnants = next.steps[0]!.fields.find((field) => field.id === 'accompagnants');
    expect(accompagnants?.condition).toBeUndefined();
    expect(next.steps[1]!.condition).toBeUndefined();
  });

  it('conserve les conditions qui ne référençaient pas le champ', () => {
    const next = removeField(base, 'remarque');
    expect(next.steps[0]!.fields[1]!.condition).toEqual({
      field: 'venue',
      op: 'equals',
      value: 'oui',
    });
  });

  it('allège un groupe de conditions au lieu de tout perdre', () => {
    const composite = schemaOf([
      {
        id: 'etape_1',
        fields: [
          { id: 'a', type: 'text', label: 'A' },
          { id: 'b', type: 'text', label: 'B' },
          {
            id: 'c',
            type: 'text',
            label: 'C',
            condition: {
              all: [
                { field: 'a', op: 'answered' },
                { field: 'b', op: 'answered' },
              ],
            },
          },
        ],
      },
    ]);

    const next = removeField(composite, 'a');
    expect(next.steps[0]!.fields[1]!.condition).toEqual({
      all: [{ field: 'b', op: 'answered' }],
    });
    expect(validateSurveySchema(next).ok).toBe(true);
  });

  it('supprime une étape et tout ce qui dépendait de ses champs', () => {
    const next = removeStep(base, 'etape_1');
    expect(next.steps.map((step) => step.id)).toEqual(['etape_2']);
    // L'étape 2 dépendait d'un champ de l'étape 1 : sa condition disparaît.
    expect(next.steps[0]!.condition).toBeUndefined();
    expect(validateSurveySchema(next).ok).toBe(true);
  });

  it('ignore une étape inexistante', () => {
    expect(removeStep(base, 'inexistante')).toEqual(base);
  });
});

describe('aides de l’éditeur', () => {
  it('ne propose comme condition que les champs PRÉCÉDENTS', () => {
    // Une condition qui regarde en avant serait inévaluable à l'affichage.
    expect(conditionCandidates(base, 'accompagnants').map((field) => field.id)).toEqual(['venue']);
    expect(conditionCandidates(base, 'venue')).toEqual([]);
    expect(conditionCandidates(base, 'remarque').map((field) => field.id)).toEqual([
      'venue',
      'accompagnants',
    ]);
  });

  it('ne propose comme clé anti-doublon que des valeurs scalaires', () => {
    const schema = schemaOf([
      {
        id: 'etape_1',
        fields: [
          { id: 'email', type: 'email', label: 'Adresse' },
          { id: 'nom', type: 'text', label: 'Nom' },
          {
            id: 'jours',
            type: 'checkbox',
            label: 'Jours',
            options: [{ value: 'lundi', label: 'Lundi' }],
          },
        ],
      },
    ]);
    expect(dedupCandidates(schema).map((field) => field.id)).toEqual(['email', 'nom']);
  });

  it('signale quand le plafond de champs est atteint', () => {
    expect(canAddField(base)).toBe(true);

    const saturated = schemaOf(
      Array.from({ length: 4 }, (_, stepIndex) => ({
        id: `etape_${stepIndex}`,
        fields: Array.from({ length: 50 }, (_, fieldIndex) => ({
          id: `champ_${stepIndex}_${fieldIndex}`,
          type: 'text',
          label: 'Question',
        })),
      })),
    );
    expect(canAddField(saturated)).toBe(false);
  });

  it('repère une condition devenue orpheline', () => {
    expect(danglingConditions(base)).toEqual([]);

    const broken = {
      ...base,
      steps: [
        {
          ...base.steps[0]!,
          fields: [base.steps[0]!.fields[1]!],
        },
      ],
    };
    expect(danglingConditions(broken)).toContain('accompagnants');
  });
});
