import type { AttendanceStatus } from '@/lib/survey/attendance';
import type { CheckinKind, DeskState, PendingOp } from './reducer';
import { seatKey, type SeatRow } from './seats';

/**
 * Composition de la liste affichée au poste d'accueil.
 *
 * Séparée du réducteur à dessein : celui-ci dit comment l'état CHANGE,
 * celle-ci dit ce qu'on en MONTRE. Mélanger les deux donnerait une fonction
 * qu'on ne saurait plus tester sur un seul axe.
 *
 * Depuis le passage à une ligne par personne, elle ne compte plus
 * d'effectifs : le nombre de gens dans la salle EST le nombre de sièges
 * pointés. Toute la mécanique d'« effectif entré non précisé » a disparu avec
 * la colonne qui la portait — un chiffre qu'on n'a plus à deviner est un
 * chiffre qu'on ne peut plus se tromper en devinant.
 */

export interface DeskRow {
  /** `réponse#siège` : l'identité d'une PERSONNE, pas d'une inscription. */
  readonly key: string;
  readonly responseId: string;
  readonly seat: number;
  readonly name: string | null;
  readonly initials: string;
  readonly detail: string | null;
  /** Accompagnant : l'écran le marque discrètement sous le nom. */
  readonly isCompanion: boolean;
  /** Ajouté à l'entrée, sans inscription préalable. */
  readonly walkIn: boolean;
  /** Ce que l'inscription a ANNONCÉ : présent, décliné, sans réponse. */
  readonly expected: AttendanceStatus;
  /** Effectif annoncé douteux. Porté par le seul siège 0. */
  readonly ambiguous: boolean;
  /** Arrivé, tel qu'on l'affiche — file locale comprise. */
  readonly arrived: boolean;
  /** Cadeau remis, tel qu'on l'affiche — file locale comprise. */
  readonly gift: boolean;
  /** Une arrivée part encore : la rangée est verte, mais pas encore un fait. */
  readonly pending: boolean;
  /** Un cadeau part encore. */
  readonly giftPending: boolean;
  /** Refus à lire. La rangée est revenue à l'état serveur. */
  readonly refused: { readonly opId: string; readonly message: string } | null;
}

export interface DeskTotals {
  /** Personnes dans la salle : une par siège pointé. */
  readonly inRoom: number;
  /** Cadeaux remis : un par siège. */
  readonly gifts: number;
  /** Personnes attendues, d'après les inscriptions qui annoncent venir. */
  readonly expectedPeople: number;
  /** Personnes listées, tous statuts confondus. */
  readonly people: number;
  /** Gestes non encore confirmés. */
  readonly pending: number;
  /** Refus non lus. */
  readonly refused: number;
}

export interface DeskList {
  readonly rows: readonly DeskRow[];
  readonly totals: DeskTotals;
}

/** Dernier geste non refusé, de CE type, portant sur cette personne. */
function pendingFor(
  queue: readonly PendingOp[],
  responseId: string,
  seat: number,
  kind: CheckinKind,
): PendingOp | null {
  let found: PendingOp | null = null;
  for (const op of queue) {
    if (op.responseId !== responseId || op.seat !== seat || op.kind !== kind) continue;
    if (op.status === 'failed') continue;
    found = op;
  }
  return found;
}

function refusedFor(
  queue: readonly PendingOp[],
  responseId: string,
  seat: number,
): PendingOp | null {
  return (
    queue.find(
      (op) => op.responseId === responseId && op.seat === seat && op.status === 'failed',
    ) ?? null
  );
}

export function deskList(seats: readonly SeatRow[], state: DeskState): DeskList {
  const rows: DeskRow[] = [];
  let inRoom = 0;
  let gifts = 0;
  let expectedPeople = 0;
  let pendingCount = 0;
  let refusedCount = 0;

  for (const seat of seats) {
    const server = state.states[seatKey(seat.responseId, seat.seat)];
    const pending = pendingFor(state.queue, seat.responseId, seat.seat, 'arrival');
    const giftPending = pendingFor(state.queue, seat.responseId, seat.seat, 'gift');
    const refused = refusedFor(state.queue, seat.responseId, seat.seat);

    // Le geste en vol l'emporte ; à défaut, l'état serveur fait foi. Chaque
    // geste ne regarde QUE sa propre file : un cadeau en vol ne dit rien de
    // l'arrivée.
    const arrived = pending
      ? pending.value
      : server !== undefined && server.arrivedAt !== null;
    const gift = giftPending
      ? giftPending.value
      : server !== undefined && server.giftAt != null;

    if (seat.status === 'attending') expectedPeople += 1;
    if (arrived) inRoom += 1;
    if (gift) gifts += 1;
    if (pending) pendingCount += 1;
    if (giftPending) pendingCount += 1;
    if (refused) refusedCount += 1;

    rows.push({
      key: seat.key,
      responseId: seat.responseId,
      seat: seat.seat,
      name: seat.name,
      initials: seat.initials,
      detail: seat.detail,
      isCompanion: seat.isCompanion,
      walkIn: seat.walkIn,
      expected: seat.status,
      ambiguous: seat.ambiguous,
      arrived,
      gift,
      pending: pending !== null,
      giftPending: giftPending !== null,
      refused: refused ? { opId: refused.opId, message: refused.error ?? 'Refusé' } : null,
    });
  }

  return {
    rows,
    totals: {
      inRoom,
      gifts,
      expectedPeople,
      people: rows.length,
      pending: pendingCount,
      refused: refusedCount,
    },
  };
}

/**
 * Statut ÉCRIT d'une rangée.
 *
 * Le besoin est formulé en couleurs — vert présent, rouge absent — et tel quel
 * c'est un défaut d'accessibilité : la couleur renforce, elle ne porte jamais
 * l'information. C'est la règle déjà posée pour les graphiques. Chaque rangée
 * porte donc ce mot, lisible par un lecteur d'écran comme par quelqu'un qui
 * distingue mal le rouge du vert.
 */
export function deskStatusLabel(row: DeskRow): string {
  if (row.arrived) return row.pending ? 'Arrivé — envoi en cours' : 'Arrivé';
  if (row.walkIn) return 'Ajouté à l’entrée';
  if (row.expected === 'declined') return 'A décliné';
  if (row.expected === 'unknown') return 'Sans réponse';
  return 'Attendu';
}

/**
 * Statut ÉCRIT d'une rangée en mode « Départs ».
 *
 * Même règle que l'arrivée : le mot porte l'information, la couleur la
 * redit. Il reste COURT — il tient dans une pastille à côté du nom, et un
 * libellé long écrasait le nom sur un téléphone, mesuré à 375 px. Qu'une
 * personne n'ait pas été pointée à l'entrée se dit dans la ligne de
 * précision, pas ici.
 */
export function giftStatusLabel(row: DeskRow): string {
  if (row.gift) return row.giftPending ? 'Cadeau remis — envoi en cours' : 'Cadeau remis';
  return 'Sans cadeau';
}
