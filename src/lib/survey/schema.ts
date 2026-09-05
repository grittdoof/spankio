import { z } from 'zod';
import { MAX_LENGTHS, SCALE_BOUNDS, SCHEMA_LIMITS } from './limits';

/**
 * Schéma d'un sondage : étapes, champs, options, conditions.
 *
 * C'est le PRINCIPE FONDATEUR de la plateforme. Cette structure vit dans
 * `surveys.schema` (jsonb) : créer un nouveau type de sondage ne demande
 * aucune migration SQL, et il n'existe jamais de table par type de question.
 *
 * Ce fichier définit la forme, et la VALIDE. Un schéma qui arrive par l'API
 * est une entrée non fiable comme une autre : le builder visuel de l'étape 6
 * ne sera qu'un des producteurs possibles.
 */

/** Les onze types de champ du MVP. Aucun autre n'est accepté. */
export const FIELD_TYPES = [
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
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Types acceptant une liste d'options. */
export const CHOICE_TYPES = ['select', 'radio', 'checkbox'] as const;

/**
 * Identifiant de champ, d'étape ou d'option.
 *
 * Contraint volontairement : ces identifiants deviennent des clés de `data`,
 * des en-têtes de colonne CSV et des `id` HTML. Un identifiant libre y
 * poserait des problèmes à chacune de ces trois étapes.
 */
const identifier = z
  .string()
  .min(1)
  .max(MAX_LENGTHS.identifier)
  .regex(/^[a-z][a-z0-9_]*$/, {
    message:
      'Un identifiant commence par une lettre minuscule et ne contient que des lettres, chiffres et tirets bas.',
  });

const label = z.string().trim().min(1).max(MAX_LENGTHS.label);
const hint = z.string().trim().max(MAX_LENGTHS.hint);

export const optionSchema = z.object({
  value: identifier,
  label,
  description: z.string().trim().max(MAX_LENGTHS.hint).optional(),
});

export type SurveyOption = z.infer<typeof optionSchema>;

/**
 * Condition d'affichage d'un champ ou d'une étape.
 *
 * `answered` / `not_answered` évitent d'avoir à écrire des comparaisons
 * bancales pour le cas le plus courant (« si la question précédente a une
 * réponse »).
 */
export type Condition =
  | { readonly field: string; readonly op: 'equals' | 'not_equals'; readonly value: string }
  | { readonly field: string; readonly op: 'includes' | 'not_includes'; readonly value: string }
  | { readonly field: string; readonly op: 'answered' | 'not_answered' }
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] };

const comparisonCondition = z.union([
  z.object({
    field: identifier,
    op: z.enum(['equals', 'not_equals', 'includes', 'not_includes']),
    value: z.string().max(MAX_LENGTHS.identifier),
  }),
  z.object({
    field: identifier,
    op: z.enum(['answered', 'not_answered']),
  }),
]);

/**
 * Le schéma de condition est récursif ET borné en profondeur : sans borne, un
 * schéma hostile de quelques kilooctets ferait exploser la pile à l'évaluation.
 */
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    comparisonCondition,
    z.object({
      all: z.array(conditionSchema).min(1).max(SCHEMA_LIMITS.maxConditionBranches),
    }),
    z.object({
      any: z.array(conditionSchema).min(1).max(SCHEMA_LIMITS.maxConditionBranches),
    }),
  ]),
) as z.ZodType<Condition>;

/** Profondeur d'imbrication d'une condition, vérifiée après l'analyse. */
export function conditionDepth(condition: Condition): number {
  if ('all' in condition) {
    return 1 + Math.max(...condition.all.map(conditionDepth));
  }
  if ('any' in condition) {
    return 1 + Math.max(...condition.any.map(conditionDepth));
  }
  return 1;
}

/** Identifiants de champ référencés par une condition. */
export function conditionFields(condition: Condition): string[] {
  if ('all' in condition) return condition.all.flatMap(conditionFields);
  if ('any' in condition) return condition.any.flatMap(conditionFields);
  return [condition.field];
}

const baseField = {
  id: identifier,
  label,
  hint: hint.optional(),
  required: z.boolean().default(false),
  condition: conditionSchema.optional(),
};

/**
 * Générique volontaire : sans lui, `z.literal(type)` produit un seul membre
 * d'union portant `type: 'text' | 'email' | ...`, et la réduction de type
 * devient impossible chez les consommateurs (le rendu d'un champ ne peut plus
 * savoir qu'un `textarea` a un `maxLength`). Avec le paramètre de type, chaque
 * appel crée un membre distinct.
 */
const textLike = <T extends 'text' | 'email' | 'tel' | 'textarea'>(type: T) =>
  z.object({
    ...baseField,
    type: z.literal(type),
    placeholder: z.string().trim().max(MAX_LENGTHS.label).optional(),
    maxLength: z.number().int().positive().max(MAX_LENGTHS[type]).optional(),
  });

/** Choix unique : `select` (liste native) ou `radio` (cartes cliquables). */
const singleChoiceField = <T extends 'select' | 'radio'>(type: T) =>
  z.object({
    ...baseField,
    type: z.literal(type),
    options: z.array(optionSchema).min(1).max(SCHEMA_LIMITS.maxOptionsPerField),
    /** Ajoute un choix « autre » avec saisie libre. */
    allowOther: z.boolean().default(false),
  });

/**
 * Choix multiple. Déclaré à part et non via un paramètre du constructeur
 * précédent : un `...(condition ? {} : {})` dans un objet zod fait perdre
 * l'inférence des champs optionnels, et `minSelected` devient intypable.
 */
const checkboxField = z.object({
  ...baseField,
  type: z.literal('checkbox'),
  options: z.array(optionSchema).min(1).max(SCHEMA_LIMITS.maxOptionsPerField),
  allowOther: z.boolean().default(false),
  minSelected: z.number().int().nonnegative().optional(),
  maxSelected: z.number().int().positive().optional(),
});

export const fieldSchema = z.discriminatedUnion('type', [
  textLike('text'),
  textLike('email'),
  textLike('tel'),
  textLike('textarea'),
  singleChoiceField('select'),
  singleChoiceField('radio'),
  checkboxField,
  z.object({
    ...baseField,
    type: z.literal('checkbox_grid'),
    rows: z.array(optionSchema).min(1).max(SCHEMA_LIMITS.maxGridRows),
    columns: z.array(optionSchema).min(1).max(SCHEMA_LIMITS.maxGridColumns),
    /** Un seul choix par ligne (grille de type radio). */
    singleChoicePerRow: z.boolean().default(false),
  }),
  z.object({
    ...baseField,
    type: z.literal('scale'),
    min: z.number().int().min(SCALE_BOUNDS.min).max(SCALE_BOUNDS.max),
    max: z.number().int().min(SCALE_BOUNDS.min).max(SCALE_BOUNDS.max),
    minLabel: z.string().trim().max(MAX_LENGTHS.label).optional(),
    maxLabel: z.string().trim().max(MAX_LENGTHS.label).optional(),
  }),
  z.object({
    ...baseField,
    type: z.literal('date'),
    /** Bornes au format ISO `AAAA-MM-JJ`. */
    min: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    max: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    ...baseField,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    /** Unité affichée à côté du champ (« personnes », « m² »…). */
    unit: z.string().trim().max(40).optional(),
  }),
]);

export type SurveyField = z.infer<typeof fieldSchema>;

export const stepSchema = z.object({
  id: identifier,
  title: z.string().trim().max(MAX_LENGTHS.stepTitle).optional(),
  intro: z.string().trim().max(MAX_LENGTHS.stepIntro).optional(),
  /** Masque l'écran d'introduction de l'étape (exigence du cahier des charges). */
  hideIntro: z.boolean().default(false),
  fields: z.array(fieldSchema).min(1).max(SCHEMA_LIMITS.maxFieldsPerStep),
  condition: conditionSchema.optional(),
});

export type SurveyStep = z.infer<typeof stepSchema>;

export const surveySchemaSchema = z.object({
  /** Version de format, pour pouvoir faire évoluer la structure sans casser. */
  version: z.literal(1).default(1),
  steps: z.array(stepSchema).min(1).max(SCHEMA_LIMITS.maxSteps),
});

export type SurveySchema = z.infer<typeof surveySchemaSchema>;

/** Schéma vide accepté : un sondage en cours de construction n'a pas d'étape. */
export const draftSurveySchemaSchema = z.object({
  version: z.literal(1).default(1),
  steps: z.array(stepSchema).max(SCHEMA_LIMITS.maxSteps),
});

export interface SchemaIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type SchemaValidation =
  | { readonly ok: true; readonly schema: SurveySchema }
  | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

/** Tous les champs du schéma, dans l'ordre du parcours. */
export function allFields(schema: SurveySchema): SurveyField[] {
  return schema.steps.flatMap((step) => step.fields);
}

/**
 * Vérifie ce que zod ne peut pas exprimer seul : unicité des identifiants,
 * cohérence des bornes, et surtout qu'une condition ne référence que des
 * champs situés AVANT elle. Une condition qui regarde en avant serait
 * inévaluable au moment de l'affichage, et pourrait masquer un champ requis
 * de façon imprévisible.
 */
function checkCoherence(schema: SurveySchema): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const stepIds = new Set<string>();
  const seenFieldIds = new Set<string>();
  let fieldCount = 0;

  schema.steps.forEach((step, stepIndex) => {
    const stepPath = `steps[${stepIndex}]`;

    if (stepIds.has(step.id)) {
      issues.push({
        path: `${stepPath}.id`,
        code: 'duplicate_step_id',
        message: `L'identifiant d'étape « ${step.id} » est utilisé deux fois.`,
      });
    }
    stepIds.add(step.id);

    if (step.condition) {
      issues.push(...checkCondition(step.condition, `${stepPath}.condition`, seenFieldIds));
    }

    step.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${stepPath}.fields[${fieldIndex}]`;
      fieldCount += 1;

      if (seenFieldIds.has(field.id)) {
        issues.push({
          path: `${fieldPath}.id`,
          code: 'duplicate_field_id',
          message: `L'identifiant de champ « ${field.id} » est utilisé deux fois.`,
        });
      }

      if (field.condition) {
        issues.push(...checkCondition(field.condition, `${fieldPath}.condition`, seenFieldIds));
      }

      issues.push(...checkFieldShape(field, fieldPath));

      // Enregistré APRÈS l'examen de sa condition : un champ ne peut donc pas
      // dépendre de lui-même.
      seenFieldIds.add(field.id);
    });
  });

  if (fieldCount > SCHEMA_LIMITS.maxFieldsTotal) {
    issues.push({
      path: 'steps',
      code: 'too_many_fields',
      message: `Un sondage ne peut pas dépasser ${SCHEMA_LIMITS.maxFieldsTotal} champs (reçu ${fieldCount}).`,
    });
  }

  return issues;
}

function checkCondition(
  condition: Condition,
  path: string,
  availableFields: ReadonlySet<string>,
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  if (conditionDepth(condition) > SCHEMA_LIMITS.maxConditionDepth) {
    issues.push({
      path,
      code: 'condition_too_deep',
      message: `Une condition ne peut pas être imbriquée au-delà de ${SCHEMA_LIMITS.maxConditionDepth} niveaux.`,
    });
  }

  for (const referenced of conditionFields(condition)) {
    if (!availableFields.has(referenced)) {
      issues.push({
        path,
        code: 'unknown_condition_field',
        message: `La condition référence « ${referenced} », qui n'est pas un champ défini avant elle.`,
      });
    }
  }

  return issues;
}

function checkFieldShape(field: SurveyField, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  if (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') {
    const values = new Set<string>();
    field.options.forEach((option, index) => {
      if (values.has(option.value)) {
        issues.push({
          path: `${path}.options[${index}].value`,
          code: 'duplicate_option_value',
          message: `La valeur d'option « ${option.value} » est utilisée deux fois.`,
        });
      }
      values.add(option.value);
    });

    // `other` est la valeur réservée du choix libre : elle ne peut pas être
    // aussi une option normale, sinon la réponse serait ambiguë.
    if (field.allowOther && values.has(OTHER_VALUE)) {
      issues.push({
        path: `${path}.options`,
        code: 'reserved_option_value',
        message: `« ${OTHER_VALUE} » est réservé au choix libre et ne peut pas être une option.`,
      });
    }

    if (field.type === 'checkbox') {
      const { minSelected, maxSelected } = field;
      if (minSelected !== undefined && maxSelected !== undefined && minSelected > maxSelected) {
        issues.push({
          path: `${path}.minSelected`,
          code: 'inconsistent_selection_bounds',
          message: 'Le minimum de choix ne peut pas dépasser le maximum.',
        });
      }
      const optionCount = field.options.length + (field.allowOther ? 1 : 0);
      if (minSelected !== undefined && minSelected > optionCount) {
        issues.push({
          path: `${path}.minSelected`,
          code: 'unreachable_selection_bound',
          message: `Le minimum de choix (${minSelected}) dépasse le nombre d'options disponibles (${optionCount}).`,
        });
      }
    }
  }

  if (field.type === 'checkbox_grid') {
    for (const [key, entries] of [
      ['rows', field.rows],
      ['columns', field.columns],
    ] as const) {
      const values = new Set<string>();
      entries.forEach((entry, index) => {
        if (values.has(entry.value)) {
          issues.push({
            path: `${path}.${key}[${index}].value`,
            code: 'duplicate_option_value',
            message: `La valeur « ${entry.value} » est utilisée deux fois.`,
          });
        }
        values.add(entry.value);
      });
    }
  }

  if (field.type === 'scale' && field.min >= field.max) {
    issues.push({
      path: `${path}.min`,
      code: 'inconsistent_scale',
      message: 'La borne basse d’une échelle doit être inférieure à la borne haute.',
    });
  }

  if (field.type === 'number') {
    const { min, max } = field;
    if (min !== undefined && max !== undefined && min > max) {
      issues.push({
        path: `${path}.min`,
        code: 'inconsistent_number_bounds',
        message: 'La borne minimale ne peut pas dépasser la borne maximale.',
      });
    }
  }

  if (field.type === 'date') {
    const { min, max } = field;
    if (min !== undefined && max !== undefined && min > max) {
      issues.push({
        path: `${path}.min`,
        code: 'inconsistent_date_bounds',
        message: 'La date minimale ne peut pas être postérieure à la date maximale.',
      });
    }
  }

  return issues;
}

/** Valeur réservée désignant le choix libre « autre ». */
export const OTHER_VALUE = 'other';

/** Clé où est rangée la saisie libre associée à un choix « autre ». */
export function otherKey(fieldId: string): string {
  return `${fieldId}__other`;
}

/**
 * Valide un schéma de sondage complet (au moins une étape).
 * À utiliser avant publication.
 */
export function validateSurveySchema(input: unknown): SchemaValidation {
  const parsed = surveySchemaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    };
  }

  const issues = checkCoherence(parsed.data);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, schema: parsed.data };
}

/**
 * Valide un schéma en cours de construction : les étapes peuvent manquer, mais
 * tout ce qui est présent doit déjà être cohérent.
 */
export function validateDraftSchema(input: unknown): SchemaValidation {
  const parsed = draftSurveySchemaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    };
  }

  const schema = parsed.data;
  const issues = schema.steps.length === 0 ? [] : checkCoherence(schema);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, schema };
}
