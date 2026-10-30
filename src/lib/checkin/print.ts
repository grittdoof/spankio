import { fieldById, type AttendanceSettings } from '@/lib/survey/attendance';
import { answerText } from '@/lib/survey/answer-text';
import type { SurveyField, SurveySchema } from '@/lib/survey/schema';
import type { GuestResponse, GuestRow } from '@/lib/survey/guests';

/**
 * Le listing papier : son classement, et la colonne qui le rend lisible.
 *
 * **Le classement se choisit AVANT de générer.** À une porte, on cherche un
 * nom dans une liste triée ; si elle est triée autrement qu'on ne cherche,
 * elle est inutilisable, et on ne s'en aperçoit qu'une fois imprimée. Le choix
 * est donc un réglage de l'écran de préparation, pas un tri qu'on referait au
 * stylo.
 *
 * **Les critères sont les QUESTIONS du formulaire, jamais une liste en dur.**
 * « Nom », « Prénom », « Société » n'existent pas dans une plateforme
 * générique — ce sont les questions que l'organisation a posées. Même
 * raisonnement que la désignation de la présence ou du nom : la plateforme ne
 * devine pas, elle propose ce qui existe.
 *
 * **Trier sur une valeur invisible donne une liste qui a l'air mélangée.**
 * Classer par société alors que la colonne « Société » n'est pas imprimée
 * produit un ordre que personne ne peut vérifier — et qu'on prendrait pour un
 * défaut. La question de tri devient donc une colonne, sauf quand elle est
 * déjà affichée comme nom ou comme précision.
 */

/** Classement par défaut : l'ordre d'inscription, celui qui ne suppose rien. */
export const PRINT_SORT_SUBMITTED = 'inscription';

/**
 * Types de question sur lesquels un classement a un sens.
 *
 * Un paragraphe libre et une case à cocher multiple en sont exclus : le
 * premier trie sur une phrase entière, la seconde sur une liste de libellés
 * concaténés. Les deux produiraient un ordre exact et inexploitable.
 */
const SORTABLE_TYPES: readonly SurveyField['type'][] = [
  'text',
  'email',
  'tel',
  'select',
  'radio',
  'date',
  'number',
  'scale',
];

export interface PrintSortOption {
  readonly value: string;
  readonly label: string;
}

/** Les classements proposés : l'ordre d'inscription, puis chaque question. */
export function printSortOptions(schema: SurveySchema): readonly PrintSortOption[] {
  const options: PrintSortOption[] = [
    { value: PRINT_SORT_SUBMITTED, label: 'Ordre d’inscription' },
  ];
  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (!SORTABLE_TYPES.includes(field.type)) continue;
      options.push({ value: field.id, label: field.label });
    }
  }
  return options;
}

/** Lecture tolérante du paramètre d'URL : tout ce qui n'existe pas retombe. */
export function parsePrintSort(
  raw: string | undefined,
  schema: SurveySchema,
  attendance: AttendanceSettings,
): string {
  const options = printSortOptions(schema);
  if (raw !== undefined && options.some((option) => option.value === raw)) return raw;
  // Sans choix explicite, le nom désigné — c'est ce qu'on cherche à une porte.
  // Faute de désignation, l'ordre d'inscription, qui n'invente rien.
  const identity = attendance.identityField;
  if (identity && options.some((option) => option.value === identity)) return identity;
  return PRINT_SORT_SUBMITTED;
}

export interface PrintRow {
  readonly row: GuestRow;
  /** Valeur de la question de classement, quand elle fait une colonne à part. */
  readonly sortValue: string | null;
}

export interface PrintList {
  readonly rows: readonly PrintRow[];
  /** Intitulé de la colonne supplémentaire, ou `null` s'il n'en faut pas. */
  readonly sortColumn: string | null;
  /** Intitulé du classement appliqué, écrit en toutes lettres sur le papier. */
  readonly sortLabel: string;
}

/**
 * Compare deux valeurs de classement.
 *
 * Les absentes ferment la marche — une rangée sans société ne doit pas
 * s'intercaler au hasard entre deux sociétés. `localeCompare` en `fr-FR` avec
 * `numeric` pour que « Salle 2 » précède « Salle 10 », ce qu'un tri
 * strictement textuel inverse.
 */
function compareValues(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left.localeCompare(right, 'fr-FR', { numeric: true, sensitivity: 'base' });
}

/**
 * Compose la liste imprimable : rangées classées, et la colonne qui justifie
 * ce classement.
 *
 * Le tri est STABLE à deux niveaux — la valeur choisie, puis le nom, puis
 * l'horodatage. Sans ce dernier, deux homonymes sans autre différence
 * changeraient d'ordre d'une impression à l'autre, et l'on croirait la liste
 * incohérente.
 */
export function printList(
  schema: SurveySchema,
  attendance: AttendanceSettings,
  rows: readonly GuestRow[],
  responses: readonly GuestResponse[],
  sortBy: string,
): PrintList {
  const options = printSortOptions(schema);
  const sortLabel =
    options.find((option) => option.value === sortBy)?.label ?? 'Ordre d’inscription';

  const field =
    sortBy === PRINT_SORT_SUBMITTED ? null : (fieldById(schema, sortBy) ?? null);
  const byId = new Map(responses.map((response) => [response.id, response]));

  // La colonne n'est ajoutée que si elle apprend quelque chose : classer par la
  // question qui titre déjà la rangée n'appelle pas une seconde colonne.
  const alreadyShown =
    field === null ||
    field.id === attendance.identityField ||
    field.id === attendance.detailField;

  const decorated = rows.map((row) => {
    const response = byId.get(row.id);
    const value =
      field && response ? answerText(field, response.data) : null;
    return { row, sortValue: alreadyShown ? null : value, key: field ? value : row.submittedAt };
  });

  decorated.sort((left, right) => {
    const primary = compareValues(left.key, right.key);
    if (primary !== 0) return primary;
    const secondary = compareValues(left.row.name, right.row.name);
    if (secondary !== 0) return secondary;
    return left.row.submittedAt.localeCompare(right.row.submittedAt);
  });

  return {
    rows: decorated.map(({ row, sortValue }) => ({ row, sortValue })),
    sortColumn: alreadyShown ? null : (field?.label ?? null),
    sortLabel,
  };
}
