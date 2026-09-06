import { z } from 'zod';
import { MAX_LENGTHS } from './limits';
import { OTHER_VALUE, type SurveyField, type SurveySchema } from './schema';

/**
 * Comptage des présents à un événement.
 *
 * La plateforme est générique : elle ne peut pas deviner quel champ signifie
 * « je viens » ni lequel donne le nombre d'accompagnants. Ces deux champs sont
 * donc DÉSIGNÉS par l'organisation, et rangés dans `surveys.settings` — aucune
 * migration, conformément au principe fondateur.
 *
 * Sans désignation, la page des réponses continue de compter des réponses, ce
 * qui est exact. Ce module n'ajoute un comptage de PERSONNES que là où
 * l'organisation a dit comment le faire.
 *
 * Rien n'est deviné. Une réponse dont le nombre d'accompagnants est ambigu —
 * plusieurs cases cochées dans une question qui devait n'en accepter qu'une —
 * est signalée comme telle et sortie du total, jamais arbitrée en silence.
 */

export const attendanceSettingsSchema = z.object({
  /** Question dont la réponse dit si la personne vient. */
  presenceField: z.string().trim().max(MAX_LENGTHS.identifier).optional(),
  /** Valeur de cette question qui signifie « oui, je viens ». */
  presenceValue: z.string().trim().max(MAX_LENGTHS.identifier).optional(),
  /** Question donnant le nombre de personnes. */
  partyField: z.string().trim().max(MAX_LENGTHS.identifier).optional(),
  /**
   * `extra` : le nombre s'ajoute au répondant (« combien vous accompagnent »).
   * `total` : le nombre inclut déjà le répondant (« combien serez-vous »).
   */
  partyMode: z.enum(['extra', 'total']).optional(),
});

export type AttendanceSettings = z.infer<typeof attendanceSettingsSchema>;

/** Le comptage est-il configuré au point d'être exploitable ? */
export function isAttendanceConfigured(settings: AttendanceSettings | undefined): boolean {
  return Boolean(settings?.presenceField && settings.presenceValue);
}

// ---------------------------------------------------------------------------
// Champs candidats
// ---------------------------------------------------------------------------

/**
 * Questions qui peuvent dire « je viens » : celles à réponse unique et à
 * options closes. Une réponse libre ne peut pas être comparée de façon fiable
 * — c'est la même règle que pour les conditions d'affichage.
 */
export function presenceCandidates(schema: SurveySchema): SurveyField[] {
  return allFields(schema).filter(
    (field) => field.type === 'select' || field.type === 'radio',
  );
}

/**
 * Questions qui peuvent donner un nombre : un champ numérique, ou un choix
 * dont les libellés sont des nombres. Les libellés, pas les valeurs : celles-ci
 * sont des identifiants figés à la création (`option_1`…), alors que le libellé
 * porte le sens (« 2 »).
 */
export function partyCandidates(schema: SurveySchema): SurveyField[] {
  return allFields(schema).filter((field) => {
    if (field.type === 'number') return true;
    if (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') {
      return field.options.some((option) => parseCount(option.label) !== null);
    }
    return false;
  });
}

/** Valeurs proposables comme « oui, je viens ». */
export function presenceValues(
  schema: SurveySchema,
  fieldId: string | undefined,
): readonly { value: string; label: string }[] {
  if (!fieldId) return [];
  const field = allFields(schema).find((candidate) => candidate.id === fieldId);
  if (!field) return [];
  if (field.type !== 'select' && field.type !== 'radio') return [];
  return field.options.map((option) => ({ value: option.value, label: option.label }));
}

function allFields(schema: SurveySchema): SurveyField[] {
  return schema.steps.flatMap((step) => step.fields);
}

/** Entier positif contenu dans un libellé, ou `null`. */
function parseCount(label: string): number | null {
  const match = /^\s*(\d{1,3})\b/.exec(label);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 && value <= 999 ? value : null;
}

// ---------------------------------------------------------------------------
// Comptage
// ---------------------------------------------------------------------------

export type AttendanceStatus = 'attending' | 'declined' | 'unknown';

export interface AttendanceRow {
  readonly status: AttendanceStatus;
  /** Personnes comptées pour cette réponse. `0` si absente ou ambiguë. */
  readonly people: number;
  /**
   * Le nombre d'accompagnants n'a pas pu être déterminé : plusieurs cases
   * cochées là où une seule était attendue, ou libellé non numérique.
   */
  readonly ambiguous: boolean;
}

export interface AttendanceInput {
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Statut et effectif d'une réponse.
 *
 * `unknown` n'est pas un défaut : une réponse peut avoir sauté la question de
 * présence, parce qu'elle était facultative ou masquée par une condition. La
 * confondre avec un refus fausserait le décompte des déclinants.
 */
export function attendanceOf(
  settings: AttendanceSettings,
  response: AttendanceInput,
  partyField: SurveyField | undefined,
): AttendanceRow {
  if (!settings.presenceField || !settings.presenceValue) {
    return { status: 'unknown', people: 0, ambiguous: false };
  }

  const answer = response.data[settings.presenceField];
  if (answer === undefined || answer === null || answer === '') {
    return { status: 'unknown', people: 0, ambiguous: false };
  }
  if (answer !== settings.presenceValue) {
    return { status: 'declined', people: 0, ambiguous: false };
  }

  // Présent. Reste à savoir combien.
  if (!partyField) return { status: 'attending', people: 1, ambiguous: false };

  const counted = countFrom(partyField, response.data[partyField.id]);
  if (counted === null) {
    // La personne vient : elle compte au moins pour elle-même. Le complément
    // est signalé plutôt qu'inventé.
    return { status: 'attending', people: 1, ambiguous: true };
  }

  const mode = settings.partyMode ?? 'extra';
  const people = mode === 'total' ? Math.max(1, counted) : 1 + counted;
  return { status: 'attending', people, ambiguous: false };
}

/**
 * Nombre lu dans une réponse, ou `null` si indéterminable.
 *
 * Pour un choix, c'est le LIBELLÉ de l'option qui est lu : les valeurs sont
 * des identifiants figés à la création. Plusieurs cases cochées renvoient
 * `null` — additionner « 1 » et « 3 » ou retenir le maximum serait un arbitrage
 * que l'organisation n'a pas demandé.
 */
function countFrom(field: SurveyField, value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value >= 0 && value <= 999 ? Math.trunc(value) : null;
  }

  if (field.type !== 'select' && field.type !== 'radio' && field.type !== 'checkbox') {
    return null;
  }

  const chosen = Array.isArray(value)
    ? (value as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  if (chosen.length !== 1) return null;
  const only = chosen[0]!;
  // Une saisie libre « autre » n'a pas de libellé d'option à lire.
  if (only === OTHER_VALUE) return null;

  const option = field.options.find((candidate) => candidate.value === only);
  return option ? parseCount(option.label) : null;
}

export interface AttendanceTotals {
  /** Réponses annonçant une présence. */
  readonly attending: number;
  readonly declined: number;
  readonly unknown: number;
  /** Personnes attendues, accompagnants compris. */
  readonly people: number;
  /** Réponses présentes dont l'effectif n'a pas pu être déterminé. */
  readonly ambiguous: number;
}

export function countAttendance(
  schema: SurveySchema,
  settings: AttendanceSettings,
  responses: readonly AttendanceInput[],
): AttendanceTotals {
  const partyField = settings.partyField
    ? allFields(schema).find((field) => field.id === settings.partyField)
    : undefined;

  const totals = { attending: 0, declined: 0, unknown: 0, people: 0, ambiguous: 0 };

  for (const response of responses) {
    const row = attendanceOf(settings, response, partyField);
    if (row.status === 'attending') totals.attending += 1;
    if (row.status === 'declined') totals.declined += 1;
    if (row.status === 'unknown') totals.unknown += 1;
    totals.people += row.people;
    if (row.ambiguous) totals.ambiguous += 1;
  }

  return totals;
}

/** Statut et effectif de chaque réponse, dans l'ordre reçu. */
export function attendanceRows(
  schema: SurveySchema,
  settings: AttendanceSettings,
  responses: readonly AttendanceInput[],
): readonly AttendanceRow[] {
  const partyField = settings.partyField
    ? allFields(schema).find((field) => field.id === settings.partyField)
    : undefined;
  return responses.map((response) => attendanceOf(settings, response, partyField));
}

export const ATTENDANCE_STATUS_LABELS: Readonly<Record<AttendanceStatus, string>> = {
  attending: 'Présent',
  declined: 'Décline',
  unknown: 'Sans réponse',
};
