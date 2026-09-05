import { OTHER_VALUE, otherKey, type SurveyField, type SurveySchema } from './schema';

/**
 * Agrégats par champ, pour le tableau de bord.
 *
 * Deux règles guident ce module :
 *
 *  1. **Aucun contenu de réponse libre n'est agrégé.** Un champ texte ne
 *     produit qu'un compteur. Afficher un nuage de mots ou un échantillon de
 *     verbatims transformerait un tableau de bord en écran de lecture de
 *     données personnelles, accessible à tout membre de l'organisation.
 *
 *  2. **Les réponses supprimées ne sont jamais comptées.** Ce module reçoit
 *     déjà des réponses filtrées — la vue SQL et les requêtes excluent
 *     `deleted_at` — mais la fonction n'a de toute façon aucun moyen de
 *     recompter une ligne qu'on ne lui a pas donnée.
 */

export interface StatisticsInput {
  readonly data: Readonly<Record<string, unknown>>;
}

interface BaseStatistics {
  readonly fieldId: string;
  readonly label: string;
  /** Réponses effectivement fournies pour ce champ. */
  readonly answered: number;
  /** Réponses où ce champ était applicable mais laissé vide. */
  readonly skipped: number;
}

export interface ChoiceCount {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  /** Part parmi les réponses fournies, en pourcentage entier. */
  readonly share: number;
}

export interface ChoiceStatistics extends BaseStatistics {
  readonly type: 'choice';
  readonly multiple: boolean;
  readonly options: readonly ChoiceCount[];
  /** Nombre de saisies libres via l'option « autre ». */
  readonly otherCount: number;
}

export interface ScaleStatistics extends BaseStatistics {
  readonly type: 'scale';
  readonly min: number;
  readonly max: number;
  readonly average: number | null;
  readonly median: number | null;
  readonly distribution: readonly { readonly value: number; readonly count: number }[];
}

export interface NumberStatistics extends BaseStatistics {
  readonly type: 'number';
  readonly average: number | null;
  readonly median: number | null;
  readonly lowest: number | null;
  readonly highest: number | null;
  readonly sum: number;
}

export interface DateStatistics extends BaseStatistics {
  readonly type: 'date';
  readonly earliest: string | null;
  readonly latest: string | null;
  readonly byMonth: readonly { readonly month: string; readonly count: number }[];
}

export interface GridStatistics extends BaseStatistics {
  readonly type: 'grid';
  readonly rows: readonly {
    readonly value: string;
    readonly label: string;
    readonly columns: readonly ChoiceCount[];
  }[];
}

/** Champ libre : un compteur, jamais de contenu. */
export interface TextStatistics extends BaseStatistics {
  readonly type: 'text';
}

export type FieldStatistics =
  | ChoiceStatistics
  | ScaleStatistics
  | NumberStatistics
  | DateStatistics
  | GridStatistics
  | TextStatistics;

export interface SurveyStatistics {
  readonly responseCount: number;
  readonly fields: readonly FieldStatistics[];
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  // Deux décimales : au-delà, on afficherait une précision que les données
  // n'ont pas.
  return Math.round((total / values.length) * 100) / 100;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const entries: unknown[] = value;
    return entries.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof value === 'string' && value !== '' ? [value] : [];
}

function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function computeField(
  field: SurveyField,
  responses: readonly StatisticsInput[],
): FieldStatistics {
  const values = responses.map((response) => response.data[field.id]);
  const provided = values.filter(isProvided);
  const base = {
    fieldId: field.id,
    label: field.label,
    answered: provided.length,
    skipped: values.length - provided.length,
  };

  switch (field.type) {
    case 'select':
    case 'radio':
    case 'checkbox': {
      const multiple = field.type === 'checkbox';
      const counts = new Map<string, number>();
      let otherCount = 0;

      for (const value of provided) {
        for (const entry of asStringList(value)) {
          if (entry === OTHER_VALUE) otherCount += 1;
          counts.set(entry, (counts.get(entry) ?? 0) + 1);
        }
      }

      const options: ChoiceCount[] = field.options.map((option) => ({
        value: option.value,
        label: option.label,
        count: counts.get(option.value) ?? 0,
        share: share(counts.get(option.value) ?? 0, provided.length),
      }));

      if (field.allowOther) {
        options.push({
          value: OTHER_VALUE,
          label: 'Autre',
          count: otherCount,
          share: share(otherCount, provided.length),
        });
      }

      return { ...base, type: 'choice', multiple, options, otherCount };
    }

    case 'scale': {
      const numbers = provided.filter((value): value is number => typeof value === 'number');
      const counts = new Map<number, number>();
      for (const value of numbers) counts.set(value, (counts.get(value) ?? 0) + 1);

      const distribution = Array.from(
        { length: field.max - field.min + 1 },
        (_, index) => field.min + index,
      ).map((value) => ({ value, count: counts.get(value) ?? 0 }));

      return {
        ...base,
        type: 'scale',
        min: field.min,
        max: field.max,
        average: average(numbers),
        median: median(numbers),
        distribution,
      };
    }

    case 'number': {
      const numbers = provided.filter((value): value is number => typeof value === 'number');
      return {
        ...base,
        type: 'number',
        average: average(numbers),
        median: median(numbers),
        lowest: numbers.length === 0 ? null : Math.min(...numbers),
        highest: numbers.length === 0 ? null : Math.max(...numbers),
        sum: numbers.reduce((total, value) => total + value, 0),
      };
    }

    case 'date': {
      const dates = provided.filter((value): value is string => typeof value === 'string').sort();
      const byMonth = new Map<string, number>();
      for (const date of dates) {
        const month = date.slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
      }

      return {
        ...base,
        type: 'date',
        earliest: dates[0] ?? null,
        latest: dates.at(-1) ?? null,
        byMonth: [...byMonth.entries()]
          .map(([month, count]) => ({ month, count }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      };
    }

    case 'checkbox_grid': {
      const counts = new Map<string, Map<string, number>>();
      for (const value of provided) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
        for (const [row, columns] of Object.entries(value as Record<string, unknown>)) {
          const rowCounts = counts.get(row) ?? new Map<string, number>();
          for (const column of asStringList(columns)) {
            rowCounts.set(column, (rowCounts.get(column) ?? 0) + 1);
          }
          counts.set(row, rowCounts);
        }
      }

      return {
        ...base,
        type: 'grid',
        rows: field.rows.map((row) => {
          const rowCounts = counts.get(row.value) ?? new Map<string, number>();
          return {
            value: row.value,
            label: row.label,
            columns: field.columns.map((column) => ({
              value: column.value,
              label: column.label,
              count: rowCounts.get(column.value) ?? 0,
              share: share(rowCounts.get(column.value) ?? 0, provided.length),
            })),
          };
        }),
      };
    }

    default:
      // Texte, adresse, téléphone, zone de texte : un compteur, rien d'autre.
      return { ...base, type: 'text' };
  }
}

/**
 * Agrège les réponses d'un sondage.
 *
 * `responses` ne doit contenir que des réponses vivantes : c'est à l'appelant
 * d'exclure les suppressions logiques, ce que font la vue `survey_stats` et
 * les requêtes du tableau de bord.
 */
export function computeStatistics(
  schema: SurveySchema,
  responses: readonly StatisticsInput[],
): SurveyStatistics {
  return {
    responseCount: responses.length,
    fields: schema.steps.flatMap((step) =>
      step.fields.map((field) => computeField(field, responses)),
    ),
  };
}

/**
 * Saisies libres associées à une option « autre ».
 *
 * Séparé des statistiques et non appelé par le tableau de bord : ces valeurs
 * sont du contenu de réponse, pas un agrégat. Elles n'apparaissent qu'à la
 * consultation explicite des réponses ou dans un export.
 */
export function otherAnswers(
  field: SurveyField,
  responses: readonly StatisticsInput[],
): string[] {
  const key = otherKey(field.id);
  return responses
    .map((response) => response.data[key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
}
