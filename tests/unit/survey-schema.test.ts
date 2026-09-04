import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  OTHER_VALUE,
  conditionDepth,
  conditionFields,
  validateDraftSchema,
  validateSurveySchema,
  type Condition,
} from '@/lib/survey/schema';
import { SCHEMA_LIMITS } from '@/lib/survey/limits';

/** Étape minimale valide, à compléter par les tests. */
const step = (fields: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'etape_1',
  fields,
  ...extra,
});

const schema = (steps: unknown[]) => ({ version: 1, steps });

const textField = (extra: Record<string, unknown> = {}) => ({
  id: 'nom',
  type: 'text',
  label: 'Votre nom',
  ...extra,
});

function issues(input: unknown): string[] {
  const result = validateSurveySchema(input);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('structure du schéma', () => {
  it('accepte un sondage minimal', () => {
    const result = validateSurveySchema(schema([step([textField()])]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.steps).toHaveLength(1);
      // Les valeurs par défaut sont appliquées.
      expect(result.schema.steps[0]!.hideIntro).toBe(false);
      expect(result.schema.steps[0]!.fields[0]!.required).toBe(false);
    }
  });

  it('refuse un schéma sans étape', () => {
    expect(validateSurveySchema(schema([])).ok).toBe(false);
  });

  it('accepte un brouillon sans étape', () => {
    const result = validateDraftSchema({ version: 1, steps: [] });
    expect(result.ok).toBe(true);
  });

  it('refuse une entrée qui n’est pas un objet', () => {
    for (const input of [null, 'texte', 42, [], undefined]) {
      expect(validateSurveySchema(input).ok).toBe(false);
    }
  });

  it('refuse un type de champ inconnu', () => {
    expect(validateSurveySchema(schema([step([textField({ type: 'fichier' })])])).ok).toBe(false);
  });

  it('couvre exactement les onze types annoncés', () => {
    expect([...FIELD_TYPES]).toEqual([
      'text',
      'email',
      'tel',
      'textarea',
      'select',
      'radio',
      'checkbox',
      'checkbox_grid',
      'scale',
      'date',
      'number',
    ]);
  });

  it('refuse un identifiant de champ non conforme', () => {
    for (const id of ['Nom', '1nom', 'nom-complet', 'nom complet', '', 'a'.repeat(65)]) {
      expect(validateSurveySchema(schema([step([textField({ id })])])).ok, id).toBe(false);
    }
  });

  it('refuse deux champs de même identifiant, même dans des étapes différentes', () => {
    expect(
      issues(
        schema([
          step([textField()], { id: 'etape_1' }),
          step([textField()], { id: 'etape_2' }),
        ]),
      ),
    ).toContain('duplicate_field_id');
  });

  it('refuse deux étapes de même identifiant', () => {
    expect(
      issues(
        schema([
          step([textField({ id: 'a' })]),
          step([textField({ id: 'b' })], { id: 'etape_1' }),
        ]),
      ),
    ).toContain('duplicate_step_id');
  });

  it('refuse un sondage dépassant le plafond de champs', () => {
    const steps = Array.from({ length: 5 }, (_, s) =>
      step(
        Array.from({ length: SCHEMA_LIMITS.maxFieldsPerStep }, (_, f) =>
          textField({ id: `champ_${s}_${f}` }),
        ),
        { id: `etape_${s}` },
      ),
    );
    expect(issues(schema(steps))).toContain('too_many_fields');
  });
});

describe('options des champs à choix', () => {
  const select = (extra: Record<string, unknown> = {}) => ({
    id: 'choix',
    type: 'select',
    label: 'Votre choix',
    options: [
      { value: 'oui', label: 'Oui' },
      { value: 'non', label: 'Non' },
    ],
    ...extra,
  });

  it('accepte une liste d’options valide', () => {
    expect(validateSurveySchema(schema([step([select()])])).ok).toBe(true);
  });

  it('refuse une liste vide', () => {
    expect(validateSurveySchema(schema([step([select({ options: [] })])])).ok).toBe(false);
  });

  it('refuse deux options de même valeur', () => {
    expect(
      issues(
        schema([
          step([
            select({
              options: [
                { value: 'oui', label: 'Oui' },
                { value: 'oui', label: 'Oui bis' },
              ],
            }),
          ]),
        ]),
      ),
    ).toContain('duplicate_option_value');
  });

  it('refuse « other » comme option quand le choix libre est activé', () => {
    expect(
      issues(
        schema([
          step([
            select({
              allowOther: true,
              options: [{ value: OTHER_VALUE, label: 'Autre' }],
            }),
          ]),
        ]),
      ),
    ).toContain('reserved_option_value');
  });

  it('refuse des bornes de sélection incohérentes', () => {
    expect(
      issues(
        schema([
          step([select({ type: 'checkbox', minSelected: 3, maxSelected: 2 })]),
        ]),
      ),
    ).toContain('inconsistent_selection_bounds');
  });

  it('refuse un minimum de sélection inatteignable', () => {
    expect(
      issues(schema([step([select({ type: 'checkbox', minSelected: 5 })])])),
    ).toContain('unreachable_selection_bound');
  });
});

describe('bornes des champs numériques, d’échelle et de date', () => {
  it('refuse une échelle dont la borne basse dépasse la haute', () => {
    expect(
      issues(
        schema([step([{ id: 'note', type: 'scale', label: 'Note', min: 5, max: 1 }])]),
      ),
    ).toContain('inconsistent_scale');
  });

  it('refuse un nombre aux bornes inversées', () => {
    expect(
      issues(
        schema([step([{ id: 'quantite', type: 'number', label: 'Quantité', min: 10, max: 2 }])]),
      ),
    ).toContain('inconsistent_number_bounds');
  });

  it('refuse des dates aux bornes inversées', () => {
    expect(
      issues(
        schema([
          step([{ id: 'jour', type: 'date', label: 'Jour', min: '2027-06-01', max: '2027-01-01' }]),
        ]),
      ),
    ).toContain('inconsistent_date_bounds');
  });

  it('refuse une date de borne mal formée', () => {
    expect(
      validateSurveySchema(
        schema([step([{ id: 'jour', type: 'date', label: 'Jour', min: '01/06/2027' }])]),
      ).ok,
    ).toBe(false);
  });
});

describe('grilles de cases à cocher', () => {
  const grid = (extra: Record<string, unknown> = {}) => ({
    id: 'grille',
    type: 'checkbox_grid',
    label: 'Vos disponibilités',
    rows: [
      { value: 'lundi', label: 'Lundi' },
      { value: 'mardi', label: 'Mardi' },
    ],
    columns: [
      { value: 'matin', label: 'Matin' },
      { value: 'apres_midi', label: 'Après-midi' },
    ],
    ...extra,
  });

  it('accepte une grille valide', () => {
    expect(validateSurveySchema(schema([step([grid()])])).ok).toBe(true);
  });

  it('refuse deux lignes de même valeur', () => {
    expect(
      issues(
        schema([
          step([
            grid({
              rows: [
                { value: 'lundi', label: 'Lundi' },
                { value: 'lundi', label: 'Lundi bis' },
              ],
            }),
          ]),
        ]),
      ),
    ).toContain('duplicate_option_value');
  });

  it('refuse une grille sans colonne', () => {
    expect(validateSurveySchema(schema([step([grid({ columns: [] })])])).ok).toBe(false);
  });
});

describe('conditions', () => {
  const conditional = (condition: unknown) =>
    schema([
      step([
        {
          id: 'present',
          type: 'radio',
          label: 'Venez-vous ?',
          options: [
            { value: 'oui', label: 'Oui' },
            { value: 'non', label: 'Non' },
          ],
        },
        { id: 'accompagnants', type: 'number', label: 'Combien ?', condition },
      ]),
    ]);

  it('accepte une condition sur un champ défini avant', () => {
    expect(
      validateSurveySchema(conditional({ field: 'present', op: 'equals', value: 'oui' })).ok,
    ).toBe(true);
  });

  it('refuse une condition qui regarde en avant', () => {
    const forward = schema([
      step([
        { id: 'a', type: 'text', label: 'A', condition: { field: 'b', op: 'answered' } },
        { id: 'b', type: 'text', label: 'B' },
      ]),
    ]);
    expect(issues(forward)).toContain('unknown_condition_field');
  });

  it('refuse une condition qui se référence elle-même', () => {
    const selfRef = schema([
      step([{ id: 'a', type: 'text', label: 'A', condition: { field: 'a', op: 'answered' } }]),
    ]);
    expect(issues(selfRef)).toContain('unknown_condition_field');
  });

  it('refuse une condition trop profondément imbriquée', () => {
    const nest = (depth: number): Condition =>
      depth === 0
        ? { field: 'present', op: 'answered' }
        : { all: [nest(depth - 1)] };
    expect(issues(conditional(nest(SCHEMA_LIMITS.maxConditionDepth + 1)))).toContain(
      'condition_too_deep',
    );
  });

  it('refuse un groupe de conditions trop large', () => {
    const branches = Array.from({ length: SCHEMA_LIMITS.maxConditionBranches + 1 }, () => ({
      field: 'present',
      op: 'answered',
    }));
    expect(validateSurveySchema(conditional({ any: branches })).ok).toBe(false);
  });

  it('mesure la profondeur et recense les champs référencés', () => {
    const condition: Condition = {
      all: [
        { field: 'a', op: 'equals', value: 'x' },
        { any: [{ field: 'b', op: 'answered' }, { field: 'c', op: 'includes', value: 'y' }] },
      ],
    };
    expect(conditionDepth(condition)).toBe(3);
    expect(conditionFields(condition).sort()).toEqual(['a', 'b', 'c']);
  });

  it('accepte une condition d’étape référençant une étape antérieure', () => {
    const twoSteps = schema([
      step([{ id: 'present', type: 'text', label: 'Présent ?' }], { id: 'etape_1' }),
      step([{ id: 'detail', type: 'text', label: 'Détail' }], {
        id: 'etape_2',
        condition: { field: 'present', op: 'answered' },
      }),
    ]);
    expect(validateSurveySchema(twoSteps).ok).toBe(true);
  });
});
