import {
  attendanceOf,
  fieldById,
  type AttendanceSettings,
  type AttendanceStatus,
} from './attendance';
import { OTHER_VALUE, otherKey, type SurveyField, type SurveySchema } from './schema';

/**
 * Liste d'accueil : une rangée par réponse, lisible à l'entrée d'un événement.
 *
 * Trois partis pris, tous conséquences de règles déjà posées ailleurs :
 *
 *  1. **Le nom d'un invité est DÉSIGNÉ, jamais devine.** La plateforme est
 *     générique : « Nom et prénom » n'existe pas plus que « Société ». Sans
 *     désignation (`attendance.identityField`), la rangée est titrée par son
 *     horodatage — exactement ce que fait déjà le tableau des réponses.
 *  2. **Aucun champ libre n'est agrégé pour autant.** Cette liste montre des
 *     réponses une par une, ce qui est sa raison d'être ; elle ne produit
 *     aucune statistique sur leur contenu.
 *  3. **La recherche porte sur ce qui est affiché ET sur le reste des
 *     réponses.** Chercher « Lyon » alors que l'agence n'est pas la colonne
 *     affichée doit trouver la ligne : sinon la recherche paraîtrait cassée.
 */

export interface GuestResponse {
  readonly id: string;
  readonly submitted_at: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface GuestRow {
  readonly id: string;
  readonly submittedAt: string;
  /** Nom affiché, ou `null` si aucune question ne le porte. */
  readonly name: string | null;
  /** Une ou deux lettres pour la pastille. Vide quand le nom manque. */
  readonly initials: string;
  /** Seconde ligne : la question désignée, puis l'effectif s'il est connu. */
  readonly detail: string | null;
  readonly status: AttendanceStatus;
  readonly people: number;
  readonly ambiguous: boolean;
}

/** Filtres proposés au-dessus de la liste. */
export type GuestFilter = 'all' | AttendanceStatus;

export const GUEST_FILTERS: readonly GuestFilter[] = [
  'all',
  'attending',
  'declined',
  'unknown',
];

export const GUEST_FILTER_LABELS: Readonly<Record<GuestFilter, string>> = {
  all: 'Toutes',
  attending: 'Présents',
  declined: 'Déclinent',
  unknown: 'Sans réponse',
};

/** Clé d'URL d'un filtre, et lecture tolérante de cette clé. */
export const GUEST_FILTER_KEYS: Readonly<Record<GuestFilter, string>> = {
  all: 'toutes',
  attending: 'presents',
  declined: 'declinent',
  unknown: 'sans-reponse',
};

export function parseGuestFilter(raw: string | undefined): GuestFilter {
  const found = GUEST_FILTERS.find((filter) => GUEST_FILTER_KEYS[filter] === raw);
  return found ?? 'all';
}

/**
 * Texte lisible d'une réponse à une question, pour l'afficher dans une rangée.
 *
 * Les choix sont rendus par leur LIBELLÉ, jamais par leur valeur : celle-ci est
 * un identifiant figé à la création (`option_1`) qui ne veut rien dire pour une
 * personne. Une saisie libre « autre » est reprise telle quelle.
 */
export function answerText(
  field: SurveyField,
  data: Readonly<Record<string, unknown>>,
): string | null {
  const value = data[field.id];
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'string') {
    if (field.type === 'select' || field.type === 'radio') {
      if (value === OTHER_VALUE) {
        const free = data[otherKey(field.id)];
        return typeof free === 'string' && free !== '' ? free : null;
      }
      const option = field.options.find((candidate) => candidate.value === value);
      return option ? option.label : null;
    }
    return value;
  }

  if (typeof value === 'number') return String(value);

  // Choix multiple : les libellés, séparés par une virgule. Utile surtout à la
  // recherche — la seconde ligne d'une rangée ne propose jamais ce type.
  if (Array.isArray(value)) {
    const labels = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => {
        if (entry === OTHER_VALUE) {
          const free = data[otherKey(field.id)];
          return typeof free === 'string' ? free : '';
        }
        if (field.type === 'checkbox' || field.type === 'select' || field.type === 'radio') {
          return field.options.find((candidate) => candidate.value === entry)?.label ?? '';
        }
        return entry;
      })
      .filter((label) => label !== '');
    return labels.length > 0 ? labels.join(', ') : null;
  }

  return null;
}

/**
 * Initiales du nom : au plus deux lettres, prises au début des deux premiers
 * mots. `Array.from` et non `slice` — une lettre accentuée composée compte pour
 * un caractère à l'écran mais deux en unités de code.
 */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => Array.from(word)[0] ?? '')
    .filter((letter) => /\p{L}/u.test(letter));
  return letters.slice(0, 2).join('').toLocaleUpperCase('fr-FR');
}

/** Toutes les valeurs textuelles d'une réponse, pour la recherche. */
function searchableText(
  schema: SurveySchema,
  response: GuestResponse,
): string {
  const parts: string[] = [];
  for (const step of schema.steps) {
    for (const field of step.fields) {
      const text = answerText(field, response.data);
      if (text) parts.push(text);
      const free = response.data[otherKey(field.id)];
      if (typeof free === 'string' && free !== '') parts.push(free);
    }
  }
  return parts.join(' ').toLocaleLowerCase('fr-FR');
}

/** Insensible à la casse ET aux accents : « Elodie » doit trouver « Élodie ». */
export function normaliseSearch(term: string): string {
  return term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('fr-FR')
    .trim();
}

export interface GuestListOptions {
  readonly filter?: GuestFilter;
  readonly search?: string;
}

export interface GuestList {
  /** Rangées retenues, dans l'ordre reçu. */
  readonly rows: readonly GuestRow[];
  /** Effectif de chaque filtre, calculé avant filtrage. */
  readonly counts: Readonly<Record<GuestFilter, number>>;
  /** Rangées écartées par la recherche ou le filtre. */
  readonly hidden: number;
}

/**
 * Compose la liste, ses compteurs et son filtrage en UN passage.
 *
 * Les compteurs sont calculés sur l'ensemble et non sur le résultat filtré :
 * une puce « Présents · 3 » qui changerait de valeur selon la puce active ne
 * dirait plus rien.
 */
export function guestList(
  schema: SurveySchema,
  settings: AttendanceSettings,
  responses: readonly GuestResponse[],
  options: GuestListOptions = {},
): GuestList {
  const partyField = fieldById(schema, settings.partyField);
  const identityField = fieldById(schema, settings.identityField);
  const detailField = fieldById(schema, settings.detailField);

  const filter = options.filter ?? 'all';
  const needle = normaliseSearch(options.search ?? '');

  const counts: Record<GuestFilter, number> = {
    all: 0,
    attending: 0,
    declined: 0,
    unknown: 0,
  };
  const rows: GuestRow[] = [];

  for (const response of responses) {
    const attendance = attendanceOf(settings, response, partyField);
    counts.all += 1;
    counts[attendance.status] += 1;

    if (filter !== 'all' && attendance.status !== filter) continue;
    if (needle !== '' && !normaliseSearch(searchableText(schema, response)).includes(needle)) {
      continue;
    }

    const name = identityField ? answerText(identityField, response.data) : null;
    rows.push({
      id: response.id,
      submittedAt: response.submitted_at,
      name,
      initials: name ? initialsOf(name) : '',
      detail: detailField ? answerText(detailField, response.data) : null,
      status: attendance.status,
      people: attendance.people,
      ambiguous: attendance.ambiguous,
    });
  }

  return { rows, counts, hidden: counts.all - rows.length };
}
