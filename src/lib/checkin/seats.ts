import { initialsOf, type GuestRow } from '@/lib/survey/guests';
import type { AttendanceStatus } from '@/lib/survey/attendance';

/**
 * Une ligne par PERSONNE, pas par inscription.
 *
 * Demande du client, et elle corrige une approximation que le module portait
 * depuis le lot 3 : une réponse annonçant « Jean Martin, accompagné » était
 * UNE rangée valant deux personnes, et l'accompagnante n'existait nulle part.
 * Or Jacqueline Martin franchit la porte, mange, et compte pour la sécurité.
 * Elle se pointe donc elle-même.
 *
 * Trois décisions, et la première commande les deux autres.
 *
 * **Le siège fait partie de l'identité d'une arrivée.** Ce n'est pas un
 * détail d'affichage : deux personnes d'une même inscription peuvent arriver
 * à vingt minutes d'écart, et l'une peut venir sans l'autre. L'état est donc
 * porté par le couple `(réponse, siège)` jusque dans la base — un compteur
 * « 2 sur 3 arrivés » n'aurait pas su dire LESQUELS.
 *
 * **L'accompagnant porte SON nom quand le formulaire le demande.** À une
 * porte on cherche le nom de la personne qui se présente, jamais celui de son
 * hôte. « accompagnant(e) de Jean Martin » est une précision sous le nom, pas
 * le nom lui-même. Sans désignation, la ligne existe quand même et s'appelle
 * « Invité » — pointable, ce qui est l'essentiel.
 *
 * **Le siège 0 est toujours la personne qui s'est inscrite.** Numéroter
 * autrement ferait dépendre l'identité d'une arrivée de l'ordre d'affichage,
 * qui change avec le tri et la recherche.
 */

export interface SeatRow {
  /** Clé stable d'une personne : c'est elle que le poste manipule. */
  readonly key: string;
  readonly responseId: string;
  readonly seat: number;
  readonly name: string | null;
  readonly initials: string;
  readonly detail: string | null;
  readonly status: AttendanceStatus;
  /** Vrai pour un accompagnant : l'écran et le papier le marquent. */
  readonly isCompanion: boolean;
  /** Effectif annoncé douteux. Porté par le seul siège 0, jamais répété. */
  readonly ambiguous: boolean;
  readonly submittedAt: string;
}

/** `réponse#siège`. Le dièse n'apparaît dans aucun UUID : aucune ambiguïté. */
export function seatKey(responseId: string, seat: number): string {
  return `${responseId}#${seat}`;
}

/** Relecture tolérante d'une clé : une clé forgée ne doit pas lever. */
export function parseSeatKey(key: string): { responseId: string; seat: number } | null {
  const at = key.lastIndexOf('#');
  if (at <= 0) return null;
  const tail = key.slice(at + 1);
  // `Number('')` vaut ZÉRO : sans ce refus, une clé tronquée à `abc#` se
  // lirait comme le siège 0 et pointerait quelqu'un d'autre. Le siège est
  // donc exigé en chiffres, explicitement.
  if (!/^\d{1,3}$/.test(tail)) return null;
  const seat = Number(tail);
  if (seat > 998) return null;
  return { responseId: key.slice(0, at), seat };
}

/**
 * Combien de personnes une inscription met à la porte.
 *
 * Au moins une : celle qui s'est inscrite. Un effectif annoncé à zéro — ce que
 * produit un refus — ne doit pas faire disparaître la ligne, puisqu'un invité
 * qui a décliné peut très bien se présenter, et que le rapport compte
 * justement ceux-là.
 */
export function seatCount(row: GuestRow): number {
  return Math.max(1, row.people);
}

/** Nom affiché d'un accompagnant, et la précision qui va dessous. */
function companionLabels(
  row: GuestRow,
  index: number,
  total: number,
): { name: string | null; detail: string | null } {
  // Le premier accompagnant porte le nom désigné ; les suivants n'en ont pas,
  // puisqu'un formulaire ne demande qu'un jeu de questions pour l'accompagnant.
  const named = index === 1 ? row.companion : null;
  const host = row.name;

  // Plusieurs accompagnants sans nom : les numéroter, sinon trois rangées
  // identiques se pointeraient au hasard.
  const fallback = total > 2 ? `Invité ${index}` : 'Invité';

  return {
    name: named ?? fallback,
    detail: host ? `accompagnant(e) de ${host}` : 'accompagnant(e)',
  };
}

/**
 * Déplie les inscriptions en personnes, dans l'ordre reçu.
 *
 * L'ordre des sièges suit l'inscription : la personne inscrite, puis ses
 * accompagnants. Deux rangées voisines dans la liste, donc — c'est ce qu'on
 * veut à une porte, où les deux se présentent ensemble neuf fois sur dix.
 */
export function expandSeats(rows: readonly GuestRow[]): readonly SeatRow[] {
  const seats: SeatRow[] = [];

  for (const row of rows) {
    const total = seatCount(row);

    seats.push({
      key: seatKey(row.id, 0),
      responseId: row.id,
      seat: 0,
      name: row.name,
      initials: row.initials,
      detail: row.detail,
      status: row.status,
      isCompanion: false,
      ambiguous: row.ambiguous,
      submittedAt: row.submittedAt,
    });

    for (let index = 1; index < total; index += 1) {
      const { name, detail } = companionLabels(row, index, total);
      seats.push({
        key: seatKey(row.id, index),
        responseId: row.id,
        seat: index,
        name,
        initials: name ? initialsOf(name) : '',
        detail,
        status: row.status,
        isCompanion: true,
        // La réserve n'est portée qu'une fois, par le siège 0 : la répéter sur
        // chaque accompagnant ferait trois alertes pour un seul doute.
        ambiguous: false,
        submittedAt: row.submittedAt,
      });
    }
  }

  return seats;
}

/**
 * Classement de la liste d'accueil.
 *
 * Par ordre alphabétique PAR DÉFAUT, et c'est le seul défaut raisonnable : à
 * une porte on cherche un nom, et l'ordre d'inscription n'a de sens que pour
 * celui qui a construit le formulaire. La liste arrivait jusqu'ici dans
 * l'ordre reçu, ce qui obligeait à parcourir deux cents rangées à l'œil.
 *
 * Le classement porte sur les INSCRIPTIONS, pas sur les sièges : le dépliage
 * vient après, pour que l'hôte et son accompagnant restent côte à côte. Trier
 * les personnes séparément les séparerait alors qu'ils se présentent ensemble.
 */
export type DeskOrder = 'name' | 'detail' | 'submitted';

export const DESK_ORDERS: readonly { readonly value: DeskOrder; readonly label: string }[] = [
  { value: 'name', label: 'Nom (A → Z)' },
  { value: 'detail', label: 'Précision (A → Z)' },
  { value: 'submitted', label: 'Ordre d’inscription' },
];

export function parseDeskOrder(raw: string | undefined): DeskOrder {
  return DESK_ORDERS.some((order) => order.value === raw) ? (raw as DeskOrder) : 'name';
}

/** Les absents de la clé ferment la marche : une rangée sans nom ne s'intercale pas. */
function compareText(left: string | null, right: string | null): number {
  if (left === null || left === '') return right === null || right === '' ? 0 : 1;
  if (right === null || right === '') return -1;
  return left.localeCompare(right, 'fr-FR', { numeric: true, sensitivity: 'base' });
}

export function sortGuests(
  rows: readonly GuestRow[],
  order: DeskOrder,
): readonly GuestRow[] {
  if (order === 'submitted') {
    return [...rows].sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
  }

  const key = order === 'name' ? 'name' : 'detail';
  // Départage par le nom puis par l'horodatage : deux homonymes qui
  // changeraient de place d'un rafraîchissement à l'autre feraient douter de
  // la liste au pire moment.
  return [...rows].sort((left, right) => {
    const primary = compareText(left[key], right[key]);
    if (primary !== 0) return primary;
    const secondary = compareText(left.name, right.name);
    if (secondary !== 0) return secondary;
    return left.submittedAt.localeCompare(right.submittedAt);
  });
}
