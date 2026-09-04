import type { Condition, SurveyField, SurveySchema, SurveyStep } from './schema';

/**
 * Évaluation des conditions d'affichage.
 *
 * Le même code sert au rendu public (quel écran afficher) et à la validation
 * serveur (quel champ est requis). C'est volontaire et non négociable : deux
 * implémentations divergeraient, et le serveur finirait par exiger un champ que
 * le client n'a jamais montré — ou, plus grave, par accepter un champ que le
 * client avait masqué.
 */

/** Réponses en cours, telles que reçues ou saisies. */
export type AnswerMap = Readonly<Record<string, unknown>>;

/** Une réponse est-elle considérée comme fournie ? */
export function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

/** Représentation comparable d'une réponse, pour `equals` / `includes`. */
/**
 * `Array.isArray` réduit `unknown` à `any[]`, ce qui recontaminerait tout ce
 * qui suit. Ce passage explicite par `unknown[]` garde le typage honnête.
 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [value];
}

function onlyStrings(values: readonly unknown[]): string[] {
  return values.filter((entry): entry is string => typeof entry === 'string');
}

function comparableValues(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return onlyStrings(asArray(value));
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value === 'object') {
    // Grille : on compare l'union des colonnes cochées, toutes lignes confondues.
    return onlyStrings(
      Object.values(value as Record<string, unknown>).flatMap((entry) => asArray(entry)),
    );
  }
  return [];
}

export function evaluateCondition(condition: Condition, answers: AnswerMap): boolean {
  if ('all' in condition) {
    return condition.all.every((child) => evaluateCondition(child, answers));
  }
  if ('any' in condition) {
    return condition.any.some((child) => evaluateCondition(child, answers));
  }

  const value = answers[condition.field];

  switch (condition.op) {
    case 'answered':
      return isAnswered(value);
    case 'not_answered':
      return !isAnswered(value);
    case 'equals': {
      const values = comparableValues(value);
      return values.length === 1 && values[0] === condition.value;
    }
    case 'not_equals': {
      const values = comparableValues(value);
      return !(values.length === 1 && values[0] === condition.value);
    }
    case 'includes':
      return comparableValues(value).includes(condition.value);
    case 'not_includes':
      return !comparableValues(value).includes(condition.value);
  }
}

/** Une étape est-elle applicable, compte tenu des réponses connues ? */
export function isStepVisible(step: SurveyStep, answers: AnswerMap): boolean {
  return step.condition === undefined || evaluateCondition(step.condition, answers);
}

/**
 * Un champ est-il applicable ? Un champ d'une étape masquée l'est aussi,
 * même si sa propre condition est satisfaite.
 */
export function isFieldVisible(
  step: SurveyStep,
  field: SurveyField,
  answers: AnswerMap,
): boolean {
  if (!isStepVisible(step, answers)) return false;
  return field.condition === undefined || evaluateCondition(field.condition, answers);
}

export interface VisibleField {
  readonly step: SurveyStep;
  readonly field: SurveyField;
}

/**
 * Champs applicables, dans l'ordre du parcours.
 *
 * Les conditions ne référencent que des champs déclarés AVANT elles (garanti
 * par la validation du schéma), donc un simple parcours en avant suffit : la
 * visibilité d'un champ ne peut pas dépendre d'une réponse ultérieure.
 */
export function visibleFields(schema: SurveySchema, answers: AnswerMap): VisibleField[] {
  const result: VisibleField[] = [];
  for (const step of schema.steps) {
    if (!isStepVisible(step, answers)) continue;
    for (const field of step.fields) {
      if (field.condition === undefined || evaluateCondition(field.condition, answers)) {
        result.push({ step, field });
      }
    }
  }
  return result;
}

/** Étapes applicables, pour la barre de progression et le compteur « n / N ». */
export function visibleSteps(schema: SurveySchema, answers: AnswerMap): SurveyStep[] {
  return schema.steps.filter((step) => isStepVisible(step, answers));
}
