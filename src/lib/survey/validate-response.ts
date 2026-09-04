import { sanitizeText } from '@/lib/security/sanitize';
import { isAnswered, visibleFields } from './conditions';
import {
  MAX_LENGTHS,
  MAX_PAYLOAD_BYTES,
  MAX_RESPONSE_FIELDS,
  RESPONSE_LIMITS,
} from './limits';
import { OTHER_VALUE, otherKey, type SurveyField, type SurveySchema } from './schema';

/**
 * VALIDATION SERVEUR D'UNE SOUMISSION.
 *
 * C'est le corollaire non négociable du schéma flexible : le client n'est
 * jamais cru. Cette fonction ne « nettoie » pas une entrée douteuse pour la
 * faire passer — elle décide, champ par champ, si la valeur est admissible, et
 * ne renvoie que des valeurs reconstruites à partir du schéma.
 *
 * Trois principes :
 *
 *  1. **Liste blanche.** Une clé inconnue du schéma n'est pas ignorée, elle est
 *     refusée. Un client ne doit pas pouvoir faire grossir `data` avec ce qu'il
 *     veut.
 *  2. **Les champs masqués sont retirés, pas refusés.** Un répondant qui change
 *     d'avis laisse derrière lui des valeurs devenues inapplicables : les
 *     rejeter transformerait une navigation normale en erreur. Elles ne sont
 *     simplement jamais enregistrées.
 *  3. **Rien n'est recopié tel quel.** Chaque valeur retournée est reconstruite
 *     (option retrouvée dans le schéma, nombre reparsé, texte assaini).
 */

export type ResponseErrorCode =
  | 'payload_too_large'
  | 'payload_not_object'
  | 'too_many_fields'
  | 'unknown_field'
  | 'required'
  | 'not_a_string'
  | 'too_long'
  | 'invalid_email'
  | 'invalid_tel'
  | 'not_a_number'
  | 'out_of_range'
  | 'not_an_integer'
  | 'invalid_date'
  | 'date_out_of_range'
  | 'unknown_option'
  | 'not_a_list'
  | 'too_few_selected'
  | 'too_many_selected'
  | 'duplicate_selection'
  | 'not_a_grid'
  | 'unknown_grid_row'
  | 'single_choice_per_row';

export interface ResponseError {
  /** Identifiant du champ concerné, ou `_` pour une erreur globale. */
  readonly field: string;
  readonly code: ResponseErrorCode;
  /** Complément d'information (longueur maximale, borne…). */
  readonly params?: Readonly<Record<string, string | number>>;
}

export type ResponseValue =
  | string
  | number
  | readonly string[]
  | Readonly<Record<string, readonly string[]>>;

export interface ValidatedResponse {
  /** Valeurs retenues, prêtes à être enregistrées dans `survey_responses.data`. */
  readonly data: Readonly<Record<string, ResponseValue>>;
  /** Champs présents dans l'entrée mais retirés car non applicables. */
  readonly dropped: readonly string[];
}

export type ResponseValidation =
  | { readonly ok: true; readonly value: ValidatedResponse }
  | { readonly ok: false; readonly errors: readonly ResponseError[] };

/**
 * Adresse électronique : volontairement permissive sur la partie locale et
 * stricte sur la présence d'un domaine à points. Valider une adresse plus
 * finement que cela est un piège — seul un envoi réel prouve l'existence.
 */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Téléphone : chiffres, espaces et séparateurs courants, indicatif optionnel. */
const TEL_RE = /^\+?[\d\s().-]{6,}$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Une date ISO existe-t-elle réellement (rejette le 31 février) ? */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function textLimitFor(field: SurveyField): number {
  switch (field.type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'textarea':
      return Math.min(field.maxLength ?? MAX_LENGTHS[field.type], MAX_LENGTHS[field.type]);
    default:
      return MAX_LENGTHS.text;
  }
}

interface FieldOutcome {
  readonly errors: readonly ResponseError[];
  /** Valeur retenue, ou `undefined` si le champ reste vide. */
  readonly value?: ResponseValue;
  /** Saisie libre associée à un choix « autre ». */
  readonly other?: string;
}

function fail(field: string, code: ResponseErrorCode, params?: ResponseError['params']): FieldOutcome {
  return { errors: [{ field, code, ...(params ? { params } : {}) }] };
}

function validateTextField(field: SurveyField, raw: unknown): FieldOutcome {
  if (typeof raw !== 'string') return fail(field.id, 'not_a_string');

  const multiline = field.type === 'textarea';
  const limit = textLimitFor(field);
  // On assainit AVANT de mesurer : sinon des caractères invisibles
  // permettraient de dépasser la limite réelle.
  const value = sanitizeText(raw, { multiline });

  if (value === '') return { errors: [] };
  if ([...value].length > limit) {
    return fail(field.id, 'too_long', { max: limit });
  }

  if (field.type === 'email' && !EMAIL_RE.test(value)) {
    return fail(field.id, 'invalid_email');
  }
  if (field.type === 'tel' && !TEL_RE.test(value)) {
    return fail(field.id, 'invalid_tel');
  }

  return { errors: [], value };
}

function validateNumberField(
  field: Extract<SurveyField, { type: 'number' }>,
  raw: unknown,
): FieldOutcome {
  // Une chaîne est acceptée : un formulaire HTML sans JavaScript envoie du
  // texte. Elle doit en revanche représenter exactement un nombre.
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : Number.NaN;

  if (typeof raw === 'string' && raw.trim() === '') return { errors: [] };
  if (!Number.isFinite(value)) return fail(field.id, 'not_a_number');

  if (field.min !== undefined && value < field.min) {
    return fail(field.id, 'out_of_range', { min: field.min });
  }
  if (field.max !== undefined && value > field.max) {
    return fail(field.id, 'out_of_range', { max: field.max });
  }

  return { errors: [], value };
}

function validateScaleField(
  field: Extract<SurveyField, { type: 'scale' }>,
  raw: unknown,
): FieldOutcome {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim())
        : Number.NaN;

  if (typeof raw === 'string' && raw.trim() === '') return { errors: [] };
  if (!Number.isFinite(value)) return fail(field.id, 'not_a_number');
  if (!Number.isInteger(value)) return fail(field.id, 'not_an_integer');
  if (value < field.min || value > field.max) {
    return fail(field.id, 'out_of_range', { min: field.min, max: field.max });
  }

  return { errors: [], value };
}

function validateDateField(
  field: Extract<SurveyField, { type: 'date' }>,
  raw: unknown,
): FieldOutcome {
  if (typeof raw !== 'string') return fail(field.id, 'not_a_string');
  const value = raw.trim();
  if (value === '') return { errors: [] };
  if (!isRealDate(value)) return fail(field.id, 'invalid_date');

  if (field.min !== undefined && value < field.min) {
    return fail(field.id, 'date_out_of_range', { min: field.min });
  }
  if (field.max !== undefined && value > field.max) {
    return fail(field.id, 'date_out_of_range', { max: field.max });
  }

  return { errors: [], value };
}

function validateSingleChoice(
  field: Extract<SurveyField, { type: 'select' | 'radio' }>,
  raw: unknown,
  otherRaw: unknown,
): FieldOutcome {
  if (typeof raw !== 'string') return fail(field.id, 'not_a_string');
  const value = raw.trim();
  if (value === '') return { errors: [] };

  if (field.allowOther && value === OTHER_VALUE) {
    const other = typeof otherRaw === 'string'
      ? sanitizeText(otherRaw, { maxLength: MAX_LENGTHS.other })
      : '';
    // Choisir « autre » sans rien écrire équivaut à ne pas répondre : c'est le
    // contrôle du champ requis qui tranchera, pas une erreur de type.
    if (other === '') return { errors: [] };
    return { errors: [], value: OTHER_VALUE, other };
  }

  if (!field.options.some((option) => option.value === value)) {
    return fail(field.id, 'unknown_option');
  }

  return { errors: [], value };
}

function validateMultiChoice(
  field: Extract<SurveyField, { type: 'checkbox' }>,
  raw: unknown,
  otherRaw: unknown,
): FieldOutcome {
  // Une case unique cochée arrive comme une chaîne dans un formulaire HTML.
  const list = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(list)) return fail(field.id, 'not_a_list');
  if (list.length > RESPONSE_LIMITS.maxSelectedPerField) {
    return fail(field.id, 'too_many_selected', { max: RESPONSE_LIMITS.maxSelectedPerField });
  }

  const errors: ResponseError[] = [];
  const selected: string[] = [];
  let other: string | undefined;

  for (const entry of list) {
    if (typeof entry !== 'string') {
      errors.push({ field: field.id, code: 'not_a_string' });
      continue;
    }
    const value = entry.trim();
    if (value === '') continue;

    if (selected.includes(value)) {
      errors.push({ field: field.id, code: 'duplicate_selection' });
      continue;
    }

    if (field.allowOther && value === OTHER_VALUE) {
      const text = typeof otherRaw === 'string'
        ? sanitizeText(otherRaw, { maxLength: MAX_LENGTHS.other })
        : '';
      if (text === '') continue;
      other = text;
      selected.push(OTHER_VALUE);
      continue;
    }

    if (!field.options.some((option) => option.value === value)) {
      errors.push({ field: field.id, code: 'unknown_option' });
      continue;
    }
    selected.push(value);
  }

  if (errors.length > 0) return { errors };
  if (selected.length === 0) return { errors: [] };

  if (field.minSelected !== undefined && selected.length < field.minSelected) {
    return fail(field.id, 'too_few_selected', { min: field.minSelected });
  }
  if (field.maxSelected !== undefined && selected.length > field.maxSelected) {
    return fail(field.id, 'too_many_selected', { max: field.maxSelected });
  }

  // Ordre du schéma, pas ordre d'envoi : l'export reste stable d'une réponse
  // à l'autre.
  const order = [...field.options.map((option) => option.value), OTHER_VALUE];
  const value = selected.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return { errors: [], value, ...(other !== undefined ? { other } : {}) };
}

function validateGrid(
  field: Extract<SurveyField, { type: 'checkbox_grid' }>,
  raw: unknown,
): FieldOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail(field.id, 'not_a_grid');
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > RESPONSE_LIMITS.maxGridRowsAnswered) {
    return fail(field.id, 'too_many_selected', { max: RESPONSE_LIMITS.maxGridRowsAnswered });
  }

  const errors: ResponseError[] = [];
  const grid: Record<string, string[]> = {};

  for (const [rowValue, columnsRaw] of entries) {
    if (!field.rows.some((row) => row.value === rowValue)) {
      errors.push({ field: field.id, code: 'unknown_grid_row', params: { row: rowValue } });
      continue;
    }

    const columns = typeof columnsRaw === 'string' ? [columnsRaw] : columnsRaw;
    if (!Array.isArray(columns)) {
      errors.push({ field: field.id, code: 'not_a_list', params: { row: rowValue } });
      continue;
    }

    const selected: string[] = [];
    for (const entry of columns) {
      if (typeof entry !== 'string') {
        errors.push({ field: field.id, code: 'not_a_string', params: { row: rowValue } });
        continue;
      }
      const value = entry.trim();
      if (value === '') continue;
      if (!field.columns.some((column) => column.value === value)) {
        errors.push({ field: field.id, code: 'unknown_option', params: { row: rowValue } });
        continue;
      }
      if (!selected.includes(value)) selected.push(value);
    }

    if (field.singleChoicePerRow && selected.length > 1) {
      errors.push({ field: field.id, code: 'single_choice_per_row', params: { row: rowValue } });
      continue;
    }

    if (selected.length > 0) {
      const order = field.columns.map((column) => column.value);
      grid[rowValue] = selected.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
  }

  if (errors.length > 0) return { errors };
  if (Object.keys(grid).length === 0) return { errors: [] };

  // Lignes réordonnées selon le schéma, pour un export stable.
  const ordered: Record<string, string[]> = {};
  for (const row of field.rows) {
    const value = grid[row.value];
    if (value !== undefined) ordered[row.value] = value;
  }

  return { errors: [], value: ordered };
}

function validateField(field: SurveyField, data: Readonly<Record<string, unknown>>): FieldOutcome {
  const raw = data[field.id];
  const otherRaw = data[otherKey(field.id)];

  if (raw === undefined || raw === null) return { errors: [] };

  switch (field.type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'textarea':
      return validateTextField(field, raw);
    case 'number':
      return validateNumberField(field, raw);
    case 'scale':
      return validateScaleField(field, raw);
    case 'date':
      return validateDateField(field, raw);
    case 'select':
    case 'radio':
      return validateSingleChoice(field, raw, otherRaw);
    case 'checkbox':
      return validateMultiChoice(field, raw, otherRaw);
    case 'checkbox_grid':
      return validateGrid(field, raw);
  }
}

/** Taille du payload en octets, telle qu'elle sera mesurée côté base. */
export function payloadSize(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data ?? null)).length;
}

/**
 * Valide une soumission contre le schéma d'un sondage.
 *
 * `data` est la valeur brute reçue de la requête : aucune hypothèse n'est
 * faite sur sa forme.
 */
export function validateResponse(schema: SurveySchema, data: unknown): ResponseValidation {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: [{ field: '_', code: 'payload_not_object' }] };
  }

  const size = payloadSize(data);
  if (size > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      errors: [{ field: '_', code: 'payload_too_large', params: { max: MAX_PAYLOAD_BYTES, size } }],
    };
  }

  const input = data as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length > MAX_RESPONSE_FIELDS) {
    return {
      ok: false,
      errors: [{ field: '_', code: 'too_many_fields', params: { max: MAX_RESPONSE_FIELDS } }],
    };
  }

  // Les conditions s'évaluent sur les réponses BRUTES : c'est ce que le client
  // avait sous les yeux quand il a rempli le formulaire.
  const applicable = visibleFields(schema, input);
  const applicableIds = new Set(applicable.map(({ field }) => field.id));

  const errors: ResponseError[] = [];
  const accepted: Record<string, ResponseValue> = {};
  const dropped: string[] = [];

  // Liste blanche : toute clé qui n'est ni un champ du schéma ni sa saisie
  // libre associée est refusée.
  const knownKeys = new Set<string>();
  for (const step of schema.steps) {
    for (const field of step.fields) {
      knownKeys.add(field.id);
      knownKeys.add(otherKey(field.id));
    }
  }

  for (const key of keys) {
    if (!knownKeys.has(key)) {
      errors.push({ field: key, code: 'unknown_field' });
    }
  }

  // Champs connus mais non applicables : retirés sans erreur.
  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (applicableIds.has(field.id)) continue;
      if (input[field.id] !== undefined || input[otherKey(field.id)] !== undefined) {
        dropped.push(field.id);
      }
    }
  }

  for (const { field } of applicable) {
    const outcome = validateField(field, input);
    if (outcome.errors.length > 0) {
      errors.push(...outcome.errors);
      continue;
    }

    if (outcome.value !== undefined) {
      accepted[field.id] = outcome.value;
      if (outcome.other !== undefined) {
        accepted[otherKey(field.id)] = outcome.other;
      }
    } else if (field.required) {
      errors.push({ field: field.id, code: 'required' });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Ultime garde-fou : la validation ne doit jamais faire GROSSIR le payload.
  const finalSize = payloadSize(accepted);
  if (finalSize > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      errors: [
        { field: '_', code: 'payload_too_large', params: { max: MAX_PAYLOAD_BYTES, size: finalSize } },
      ],
    };
  }

  return { ok: true, value: { data: accepted, dropped } };
}

/**
 * Valeur à utiliser comme clé anti-doublon, telle que désignée par
 * `surveys.dedup_field`. Renvoie `null` si le champ n'est pas renseigné.
 */
export function dedupValueFrom(
  data: Readonly<Record<string, ResponseValue>>,
  dedupField: string | null,
): string | null {
  if (!dedupField) return null;
  const value = data[dedupField];
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Champs requis restant sans réponse, pour l'affichage du renderer. */
export function missingRequiredFields(
  schema: SurveySchema,
  answers: Readonly<Record<string, unknown>>,
): string[] {
  return visibleFields(schema, answers)
    .filter(({ field }) => field.required && !isAnswered(answers[field.id]))
    .map(({ field }) => field.id);
}
