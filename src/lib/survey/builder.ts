import { SCHEMA_LIMITS } from './limits';
import {
  conditionFields,
  type Condition,
  type FieldType,
  type SurveyField,
  type SurveySchema,
  type SurveyStep,
} from './schema';

/**
 * Opérations de l'éditeur visuel.
 *
 * Elles sont pures et testables sans interface, parce que ce sont elles qui
 * garantissent qu'un schéma reste VALIDE pendant l'édition. L'éditeur ne doit
 * jamais pouvoir produire un état que la validation refusera au moment
 * d'enregistrer — c'est une des façons les plus sûres de perdre le travail de
 * quelqu'un.
 */

/** Libellé de chaque type, pour le sélecteur d'ajout. */
export const FIELD_TYPE_LABELS: Readonly<Record<FieldType, string>> = {
  text: 'Texte court',
  textarea: 'Texte long',
  email: 'Adresse électronique',
  tel: 'Téléphone',
  number: 'Nombre',
  date: 'Date',
  select: 'Liste déroulante',
  radio: 'Choix unique',
  checkbox: 'Choix multiple',
  checkbox_grid: 'Grille de cases',
  scale: 'Échelle',
};

/** Tous les identifiants déjà utilisés dans le schéma. */
export function usedIdentifiers(schema: SurveySchema): Set<string> {
  const used = new Set<string>();
  for (const step of schema.steps) {
    used.add(step.id);
    for (const field of step.fields) used.add(field.id);
  }
  return used;
}

/**
 * Dérive un identifiant libre à partir d'une base.
 *
 * Les identifiants deviennent des clés de `data` et des en-têtes de colonne :
 * ils doivent rester stables et lisibles, d'où une base parlante plutôt qu'un
 * UUID.
 */
export function uniqueIdentifier(base: string, used: ReadonlySet<string>): string {
  const root =
    base
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, 'q$1')
      .slice(0, 48) || 'champ';

  if (!used.has(root)) return root;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${root}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Impossible de dériver un identifiant libre depuis « ${base} »`);
}

/**
 * Champ neuf du type demandé, déjà valide.
 *
 * Les types à options naissent avec deux options : un champ à choix sans
 * option est refusé par la validation, et laisser l'éditeur créer un état
 * invalide se paierait au moment d'enregistrer.
 */
export function defaultField(type: FieldType, used: ReadonlySet<string>): SurveyField {
  const id = uniqueIdentifier(FIELD_TYPE_LABELS[type], used);
  const base = { id, label: 'Nouvelle question', required: false } as const;

  switch (type) {
    case 'select':
    case 'radio':
      return {
        ...base,
        type,
        allowOther: false,
        options: [
          { value: 'option_1', label: 'Première option' },
          { value: 'option_2', label: 'Deuxième option' },
        ],
      };
    case 'checkbox':
      return {
        ...base,
        type,
        allowOther: false,
        options: [
          { value: 'option_1', label: 'Première option' },
          { value: 'option_2', label: 'Deuxième option' },
        ],
      };
    case 'checkbox_grid':
      return {
        ...base,
        type,
        singleChoicePerRow: false,
        rows: [
          { value: 'ligne_1', label: 'Première ligne' },
          { value: 'ligne_2', label: 'Deuxième ligne' },
        ],
        columns: [
          { value: 'colonne_1', label: 'Première colonne' },
          { value: 'colonne_2', label: 'Deuxième colonne' },
        ],
      };
    case 'scale':
      return { ...base, type, min: 1, max: 5 };
    case 'number':
      return { ...base, type };
    case 'date':
      return { ...base, type };
    default:
      return { ...base, type };
  }
}

export function defaultStep(used: ReadonlySet<string>): SurveyStep {
  return {
    id: uniqueIdentifier('etape', used),
    hideIntro: false,
    fields: [defaultField('text', used)],
  };
}

/** Déplace un élément, en bornant les indices. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(target, 0, moved);
  return next;
}

/** Retire d'une condition toute référence à un champ disparu. */
function pruneCondition(condition: Condition, removed: ReadonlySet<string>): Condition | null {
  if ('all' in condition) {
    const kept = condition.all
      .map((child) => pruneCondition(child, removed))
      .filter((child): child is Condition => child !== null);
    return kept.length === 0 ? null : { all: kept };
  }
  if ('any' in condition) {
    const kept = condition.any
      .map((child) => pruneCondition(child, removed))
      .filter((child): child is Condition => child !== null);
    return kept.length === 0 ? null : { any: kept };
  }
  return removed.has(condition.field) ? null : condition;
}

function withoutCondition<T extends { condition?: Condition }>(item: T): T {
  const { condition: _dropped, ...rest } = item;
  return rest as T;
}

/**
 * Supprime un champ, ET nettoie les conditions qui le référençaient.
 *
 * Sans ce nettoyage, supprimer une question laisserait derrière elle des
 * conditions pointant vers un champ inexistant : le schéma deviendrait
 * invalide, et l'éditeur refuserait d'enregistrer sans que l'utilisateur
 * comprenne pourquoi.
 */
export function removeField(schema: SurveySchema, fieldId: string): SurveySchema {
  const removed = new Set([fieldId]);

  return {
    ...schema,
    steps: schema.steps.map((step) => {
      const prunedStep =
        step.condition && pruneCondition(step.condition, removed) === null
          ? withoutCondition(step)
          : step.condition
            ? { ...step, condition: pruneCondition(step.condition, removed)! }
            : step;

      return {
        ...prunedStep,
        fields: prunedStep.fields
          .filter((field) => field.id !== fieldId)
          .map((field) => {
            if (!field.condition) return field;
            const pruned = pruneCondition(field.condition, removed);
            return pruned === null ? withoutCondition(field) : { ...field, condition: pruned };
          }),
      };
    }),
  };
}

/** Supprime une étape et tout ce qui dépendait de ses champs. */
export function removeStep(schema: SurveySchema, stepId: string): SurveySchema {
  const step = schema.steps.find((candidate) => candidate.id === stepId);
  if (!step) return schema;

  let result: SurveySchema = { ...schema, steps: schema.steps.filter((s) => s.id !== stepId) };
  for (const field of step.fields) {
    result = removeField(result, field.id);
  }
  return result;
}

/**
 * Champs pouvant servir de condition à un champ donné : uniquement ceux qui le
 * précèdent, puisqu'une condition ne peut pas regarder en avant.
 */
export function conditionCandidates(schema: SurveySchema, fieldId: string): SurveyField[] {
  const candidates: SurveyField[] = [];
  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (field.id === fieldId) return candidates;
      candidates.push(field);
    }
  }
  return candidates;
}

/** Champs utilisables comme clé anti-doublon : une valeur scalaire stable. */
export function dedupCandidates(schema: SurveySchema): SurveyField[] {
  return schema.steps
    .flatMap((step) => step.fields)
    .filter((field) => ['email', 'tel', 'text', 'number'].includes(field.type));
}

/** Le schéma peut-il encore accueillir un champ ? */
export function canAddField(schema: SurveySchema): boolean {
  const total = schema.steps.reduce((count, step) => count + step.fields.length, 0);
  return total < SCHEMA_LIMITS.maxFieldsTotal;
}

/** Champs devenus orphelins parce qu'un champ référencé a disparu. */
export function danglingConditions(schema: SurveySchema): string[] {
  const seen = new Set<string>();
  const dangling: string[] = [];

  for (const step of schema.steps) {
    if (step.condition) {
      for (const referenced of conditionFields(step.condition)) {
        if (!seen.has(referenced)) dangling.push(step.id);
      }
    }
    for (const field of step.fields) {
      if (field.condition) {
        for (const referenced of conditionFields(field.condition)) {
          if (!seen.has(referenced)) dangling.push(field.id);
        }
      }
      seen.add(field.id);
    }
  }

  return [...new Set(dangling)];
}
