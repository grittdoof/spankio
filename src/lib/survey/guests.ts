import {
  attendanceOf,
  companionFieldsOf,
  fieldById,
  identityFieldsOf,
  partyQuestion,
  type AttendanceSettings,
  type AttendanceStatus,
} from './attendance';
import { answerText } from './answer-text';
import { otherKey, type SurveySchema } from './schema';

/**
 * Liste d'accueil : une rangée par réponse, lisible à l'entrée d'un événement.
 *
 * Trois partis pris, tous conséquences de règles déjà posées ailleurs :
 *
 *  1. **Le nom d'un invité est DÉSIGNÉ, jamais devine.** La plateforme est
 *     générique : « Nom et prénom » n'existe pas plus que « Société ». Sans
 *     désignation (`attendance.identityFields`), la rangée est titrée par son
 *     horodatage — exactement ce que fait déjà le tableau des réponses. La
 *     désignation en porte PLUSIEURS, dans l'ordre : un formulaire qui demande
 *     le nom et le prénom séparément doit pouvoir titrer « Marie Dupont », et
 *     non choisir lequel des deux sacrifier.
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
  /** `desk` : ajoutée à l'entrée. Absente : inscription du formulaire. */
  readonly origin?: string;
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
  /**
   * Nom de l'accompagnant, quand le formulaire le demande.
   *
   * Composé ici et pas ailleurs : c'est le seul endroit qui parcourt déjà les
   * réponses avec le schéma sous la main, et deux compositions auraient fini
   * par nommer l'accompagnant d'une façon à l'écran et d'une autre sur le
   * papier.
   */
  readonly companion: string | null;
  readonly status: AttendanceStatus;
  readonly people: number;
  readonly ambiguous: boolean;
  /**
   * Ajouté à l'entrée par le poste d'accueil, sans inscription préalable.
   * L'écran le DIT : sans cela, on prendrait cette rangée pour une inscription
   * dont la présence n'a pas été renseignée.
   */
  readonly walkIn: boolean;
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

/** Ré-exporté : la liste d'accueil en est le premier consommateur. */
export { answerText };

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
  const party = partyQuestion(schema, settings);
  const identityFields = identityFieldsOf(schema, settings);
  const companionFields = companionFieldsOf(schema, settings);
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
    const attendance = attendanceOf(settings, response, party);
    counts.all += 1;
    counts[attendance.status] += 1;

    if (filter !== 'all' && attendance.status !== filter) continue;
    if (needle !== '' && !normaliseSearch(searchableText(schema, response)).includes(needle)) {
      continue;
    }

    // Les réponses vides sont SAUTÉES, pas rendues par un blanc : un invité
    // qui n'a pas donné son prénom doit s'appeler « Dupont », jamais « Dupont ».
    const parts = identityFields
      .map((field) => answerText(field, response.data))
      .filter((part): part is string => part !== null && part !== '');
    const name = parts.length > 0 ? parts.join(' ') : null;

    const companionParts = companionFields
      .map((field) => answerText(field, response.data))
      .filter((part): part is string => part !== null && part !== '');
    const companion = companionParts.length > 0 ? companionParts.join(' ') : null;
    rows.push({
      id: response.id,
      submittedAt: response.submitted_at,
      name,
      initials: name ? initialsOf(name) : '',
      detail: detailField ? answerText(detailField, response.data) : null,
      companion,
      status: attendance.status,
      people: attendance.people,
      ambiguous: attendance.ambiguous,
      walkIn: response.origin === 'desk',
    });
  }

  return { rows, counts, hidden: counts.all - rows.length };
}
