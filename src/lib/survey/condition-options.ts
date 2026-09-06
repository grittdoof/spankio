import type { Condition, SurveyField } from './schema';

/**
 * Ce qu'une condition peut dire, selon la question qu'elle observe.
 *
 * L'éditeur ne proposait qu'un seul opérateur — « a une réponse » — alors que
 * le moteur en évalue six. Une organisation ne pouvait donc pas écrire
 * « n'afficher que si la réponse est *Oui* », qui est le besoin courant.
 *
 * Deux règles gouvernent ce module :
 *
 *  1. **Une valeur ne se saisit jamais à la main, elle se choisit.** Comparer
 *     à une chaîne tapée au clavier produit une condition qui ne se déclenche
 *     jamais dès qu'un caractère diffère, sans que rien ne le signale. Les
 *     valeurs proposées viennent donc TOUJOURS de la liste fermée de la
 *     question observée.
 *  2. **Aucun opérateur de comparaison sur une réponse libre.** Un texte, un
 *     courriel ou une date sont saisis par le répondant : les comparer à une
 *     valeur exacte est un piège, pas une fonctionnalité. Ces questions
 *     n'offrent que la présence ou l'absence de réponse.
 */

export type ConditionOperator =
  | 'answered'
  | 'not_answered'
  | 'equals'
  | 'not_equals'
  | 'includes'
  | 'not_includes';

export interface OperatorChoice {
  readonly op: ConditionOperator;
  /** Libellé qui se lit à la suite du nom de la question. */
  readonly label: string;
  /** Vrai si l'opérateur exige qu'une valeur soit choisie. */
  readonly needsValue: boolean;
}

const PRESENCE: readonly OperatorChoice[] = [
  { op: 'answered', label: 'a reçu une réponse', needsValue: false },
  { op: 'not_answered', label: 'n’a pas reçu de réponse', needsValue: false },
];

/** Choix unique : une seule valeur, donc l'égalité a un sens. */
const SINGLE: readonly OperatorChoice[] = [
  { op: 'equals', label: 'a pour réponse', needsValue: true },
  { op: 'not_equals', label: 'a une réponse autre que', needsValue: true },
  ...PRESENCE,
];

/** Choix multiple : on interroge l'appartenance, pas l'égalité. */
const MULTIPLE: readonly OperatorChoice[] = [
  { op: 'includes', label: 'contient', needsValue: true },
  { op: 'not_includes', label: 'ne contient pas', needsValue: true },
  ...PRESENCE,
];

/**
 * Opérateurs praticables sur cette question.
 *
 * `equals` compare une valeur unique, `includes` une appartenance : les
 * proposer indifféremment produirait des conditions qui ne se déclenchent
 * jamais — `equals` sur une case à cocher multiple échoue dès qu'une seconde
 * case est cochée, parce que la réponse cesse d'être une valeur unique.
 */
export function conditionOperators(field: SurveyField): readonly OperatorChoice[] {
  switch (field.type) {
    case 'select':
    case 'radio':
    case 'scale':
      return SINGLE;
    case 'checkbox':
    case 'checkbox_grid':
      return MULTIPLE;
    // Réponses libres : présence ou absence, rien d'autre.
    case 'text':
    case 'textarea':
    case 'email':
    case 'tel':
    case 'number':
    case 'date':
      return PRESENCE;
  }
}

export interface ValueChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * Valeurs proposables, issues de la question observée.
 *
 * Pour une grille, ce sont les COLONNES : l'évaluation compare l'union des
 * colonnes cochées, toutes lignes confondues. Proposer les lignes laisserait
 * croire à une condition « ligne X cochée », que le moteur ne sait pas dire.
 */
export function conditionValues(field: SurveyField): readonly ValueChoice[] {
  if (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') {
    return field.options.map((option) => ({ value: option.value, label: option.label }));
  }
  if (field.type === 'checkbox_grid') {
    return field.columns.map((column) => ({ value: column.value, label: column.label }));
  }
  if (field.type === 'scale') {
    return Array.from({ length: field.max - field.min + 1 }, (_, index) => {
      const value = String(field.min + index);
      return { value, label: value };
    });
  }
  return [];
}

/** L'opérateur exige-t-il une valeur ? */
export function operatorNeedsValue(op: ConditionOperator): boolean {
  return op === 'equals' || op === 'not_equals' || op === 'includes' || op === 'not_includes';
}

/**
 * Compose une condition, ou renvoie `null` si elle serait inopérante.
 *
 * `null` plutôt qu'une condition bancale : une comparaison sans valeur, ou
 * portant sur une valeur qui n'existe pas dans la question observée, ne se
 * déclencherait jamais — et l'organisation croirait avoir posé une règle.
 */
export function buildCondition(
  observed: SurveyField,
  op: ConditionOperator,
  value: string | null,
): Condition | null {
  const allowed = conditionOperators(observed).some((choice) => choice.op === op);
  if (!allowed) return null;

  if (!operatorNeedsValue(op)) {
    return { field: observed.id, op: op as 'answered' | 'not_answered' };
  }

  if (!value) return null;
  if (!conditionValues(observed).some((choice) => choice.value === value)) return null;

  return {
    field: observed.id,
    op: op as 'equals' | 'not_equals' | 'includes' | 'not_includes',
    value,
  };
}

/** Partie observable d'une condition simple, pour réafficher l'éditeur. */
export interface ConditionParts {
  readonly field: string;
  readonly op: ConditionOperator;
  readonly value: string | null;
}

/**
 * Décompose une condition simple. Renvoie `null` pour une condition composée
 * (`all` / `any`) : l'éditeur ne sait pas les construire, et prétendre les
 * afficher les écraserait au premier changement.
 */
export function conditionParts(condition: Condition | undefined): ConditionParts | null {
  if (!condition) return null;
  if ('all' in condition || 'any' in condition) return null;
  return {
    field: condition.field,
    op: condition.op,
    value: 'value' in condition ? condition.value : null,
  };
}

/**
 * Phrase décrivant une condition, pour la relire sans la décoder.
 *
 * `null` quand la question observée a disparu du schéma : mieux vaut ne rien
 * afficher qu'une phrase mentionnant un identifiant technique.
 */
export function describeCondition(
  condition: Condition | undefined,
  candidates: readonly SurveyField[],
): string | null {
  const parts = conditionParts(condition);
  if (!parts) return null;

  const observed = candidates.find((candidate) => candidate.id === parts.field);
  if (!observed) return null;

  const operator = conditionOperators(observed).find((choice) => choice.op === parts.op);
  if (!operator) return null;

  const label = `« ${observed.label} » ${operator.label}`;
  if (!operator.needsValue) return label;

  const value = conditionValues(observed).find((choice) => choice.value === parts.value);
  return value ? `${label} « ${value.label} »` : null;
}
