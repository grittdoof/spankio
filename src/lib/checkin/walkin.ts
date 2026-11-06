import { fieldById, identityFieldsOf, type AttendanceSettings } from '@/lib/survey/attendance';
import type { SurveyField, SurveySchema } from '@/lib/survey/schema';
import { sanitizeText } from '@/lib/security/sanitize';
import { initialsOf, type GuestRow } from '@/lib/survey/guests';

/**
 * L'invité de dernière minute — ce qu'on lui demande, et ce qu'on en garde.
 *
 * **Les questions posées sont celles qui NOMMENT et PRÉCISENT une rangée**,
 * jamais une liste écrite ici. « Nom, prénom, société » n'existe pas plus dans
 * une plateforme générique qu'à l'écran de préparation : ce sont les
 * désignations de l'organisation (`identityFields`, puis `detailField`), dans
 * leur ordre, avec leur propre intitulé. Pour un formulaire qui demande nom,
 * prénom et société, l'écran demande donc exactement cela ; pour un autre,
 * il demande ce que cet autre affiche.
 *
 * Deux conséquences voulues :
 *  - une personne ajoutée à la porte s'affiche EXACTEMENT comme une inscrite,
 *    puisqu'elle remplit les mêmes questions — au poste, sur le papier et dans
 *    l'export ;
 *  - aucune autre réponse n'est inventée. La question de présence reste vide,
 *    et c'est la vérité : cette personne n'a rien annoncé.
 *
 * Seules les questions à saisie LIBRE sont proposées. Une liste fermée stocke
 * une valeur d'option, pas un libellé : y écrire « Atelier Martin » produirait
 * une réponse qu'aucun écran ne saurait relire.
 */

const FREE_TYPES: ReadonlySet<SurveyField['type']> = new Set(['text', 'email', 'tel']);

/** Plafond par champ, le même que celui que la base applique. */
export const WALKIN_MAX_LENGTH = 200;

export interface WalkinField {
  readonly id: string;
  readonly label: string;
  readonly type: 'text' | 'email' | 'tel';
  /** `identity` titre la rangée, `detail` la précise. */
  readonly role: 'identity' | 'detail';
}

export function walkinFields(
  schema: SurveySchema,
  settings: AttendanceSettings,
): readonly WalkinField[] {
  const candidates: { field: SurveyField; role: WalkinField['role'] }[] = identityFieldsOf(
    schema,
    settings,
  ).map((field) => ({ field, role: 'identity' }));
  const detail = fieldById(schema, settings.detailField);
  if (detail) candidates.push({ field: detail, role: 'detail' });

  const seen = new Set<string>();
  const fields: WalkinField[] = [];
  for (const { field, role } of candidates) {
    if (seen.has(field.id) || !FREE_TYPES.has(field.type)) continue;
    seen.add(field.id);
    fields.push({
      id: field.id,
      label: field.label,
      type: field.type as WalkinField['type'],
      role,
    });
  }
  // Sans question qui NOMME, l'ajout n'a pas de sens : une rangée titrée par
  // sa seule société ne se retrouverait pas à la porte.
  if (!fields.some((field) => field.role === 'identity')) return [];
  return fields;
}

export type WalkinOutcome =
  | { readonly ok: true; readonly data: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly message: string };

/**
 * Reconstruit ce qui part en base, champ par champ.
 *
 * Liste blanche, comme une soumission publique : une clé qui n'est pas une
 * question proposée est ignorée, et chaque valeur est NETTOYÉE avant d'être
 * gardée. Un champ laissé vide n'est pas écrit — une réponse vide n'affirme
 * rien. Il faut au moins une question qui NOMME : une rangée sans nom ne se
 * retrouverait pas.
 */
export function walkinData(
  fields: readonly WalkinField[],
  input: Readonly<Record<string, unknown>>,
): WalkinOutcome {
  if (fields.length === 0) {
    return {
      ok: false,
      message:
        'Aucune question ne nomme les invités : désignez-la dans l’écran de préparation avant d’ajouter quelqu’un.',
    };
  }

  const data: Record<string, string> = {};
  for (const field of fields) {
    const raw = input[field.id];
    if (typeof raw !== 'string') continue;
    const clean = sanitizeText(raw, { maxLength: WALKIN_MAX_LENGTH });
    if (clean !== '') data[field.id] = clean;
  }

  // Il faut un NOM, pas seulement une société : la rangée doit se retrouver
  // en cherchant la personne qui se présente.
  const named = fields.some((field) => field.role === 'identity' && data[field.id] !== undefined);
  if (!named) {
    return {
      ok: false,
      // L'intitulé est cité tel quel : c'est souvent une question (« Quel
      // est votre nom ? »), qu'aucune tournure ne saurait fondre dans une
      // phrase — même raison que pour la finalité de la page publique.
      message: `Remplissez au moins « ${(fields.find((field) => field.role === 'identity') ?? fields[0])!.label} ».`,
    };
  }

  return { ok: true, data };
}

/**
 * Ajoute à la liste les personnes arrivées par le delta, sans doublon.
 *
 * Une même personne peut arriver deux fois — par la réponse de l'ajout ET par
 * le delta suivant, qui la relit. La première version gardée suffit : une
 * inscription est immuable.
 */
export function mergeGuests(
  base: readonly GuestRow[],
  extra: readonly GuestRow[],
): readonly GuestRow[] {
  if (extra.length === 0) return base;
  const known = new Set(base.map((row) => row.id));
  const merged = [...base];
  for (const row of extra) {
    if (known.has(row.id)) continue;
    known.add(row.id);
    merged.push(row);
  }
  return merged;
}

/**
 * La rangée d'une personne ajoutée PENDANT UN ESSAI À BLANC.
 *
 * Seul cas où la rangée est composée hors de `guestList` : l'essai n'envoie
 * rien, il n'y a donc aucun serveur pour la composer. La règle est la même —
 * les questions qui nomment, dans l'ordre, une réponse vide sautée — et ce
 * n'est qu'un exercice : la rangée disparaît au rechargement.
 */
export function rehearsalGuest(
  id: string,
  fields: readonly WalkinField[],
  data: Readonly<Record<string, string>>,
  submittedAt: string,
): GuestRow {
  const parts = fields
    .filter((field) => field.role === 'identity')
    .map((field) => data[field.id])
    .filter((part): part is string => typeof part === 'string' && part !== '');
  const name = parts.length > 0 ? parts.join(' ') : null;
  const detailField = fields.find((field) => field.role === 'detail');
  return {
    id,
    submittedAt,
    name,
    initials: name ? initialsOf(name) : '',
    detail: detailField ? (data[detailField.id] ?? null) : null,
    companion: null,
    status: 'unknown',
    people: 1,
    ambiguous: false,
    walkIn: true,
  };
}

/**
 * Les réponses AU FORMULAIRE, sans les personnes ajoutées à l'entrée.
 *
 * Une personne ajoutée à la porte compte dans la salle, dans le rapport, dans
 * la liste et dans l'export. Elle ne compte PAS parmi les réponses : elle n'a
 * rien répondu. La laisser dans les agrégats ferait apparaître un pic de
 * « réponses » le soir même dans le rythme d'inscription, et gonflerait le
 * nombre de « sans réponse » de l'effectif annoncé — deux chiffres faux
 * qu'aucune alerte ne signalerait.
 */
export function formResponses<T extends { readonly origin?: string }>(
  responses: readonly T[],
): T[] {
  return responses.filter((response) => response.origin !== 'desk');
}
