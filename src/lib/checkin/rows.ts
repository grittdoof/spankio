import type { GuestRow } from '@/lib/survey/guests';
import type { AttendanceStatus } from '@/lib/survey/attendance';
import type { DeskState, PendingOp } from './reducer';

/**
 * Composition de la liste affichée au poste d'accueil.
 *
 * Séparée du réducteur à dessein : celui-ci dit comment l'état CHANGE, celle-ci
 * dit ce qu'on en MONTRE. Mélanger les deux donnerait une fonction qu'on ne
 * saurait plus tester sur un seul axe.
 */

export interface DeskRow {
  readonly id: string;
  readonly name: string | null;
  readonly initials: string;
  readonly detail: string | null;
  /** Ce que l'invité a ANNONCÉ : présent, décliné, sans réponse. */
  readonly expected: AttendanceStatus;
  /** Effectif annoncé à l'inscription. */
  readonly announced: number;
  readonly ambiguous: boolean;
  /** Arrivé, tel qu'on l'affiche — file locale comprise. */
  readonly arrived: boolean;
  /** Un geste part encore : la rangée est verte, mais pas encore un fait. */
  readonly pending: boolean;
  /** Refus à lire. La rangée est revenue à l'état serveur. */
  readonly refused: { readonly opId: string; readonly message: string } | null;
  /** Effectif RÉELLEMENT entré, corrigé par l'accueil. `null` : non corrigé. */
  readonly peopleIn: number | null;
  /** Effectif retenu dans le compteur de salle. */
  readonly counted: number;
}

export interface DeskTotals {
  /** Personnes dans la salle. */
  readonly inRoom: number;
  /** Rangées pointées comme arrivées. */
  readonly arrived: number;
  /** Rangées qui ont annoncé venir. */
  readonly expected: number;
  /** Personnes attendues, d'après les effectifs annoncés. */
  readonly expectedPeople: number;
  /** Gestes non encore confirmés. */
  readonly pending: number;
  /** Refus non lus. */
  readonly refused: number;
  /** Rangées dont l'effectif entré a été corrigé à la main. */
  readonly corrected: number;
}

export interface DeskList {
  readonly rows: readonly DeskRow[];
  readonly totals: DeskTotals;
}

/** Dernier geste non refusé portant sur cette rangée. */
function pendingFor(queue: readonly PendingOp[], responseId: string): PendingOp | null {
  let found: PendingOp | null = null;
  for (const op of queue) {
    if (op.responseId !== responseId) continue;
    if (op.status === 'failed') continue;
    found = op;
  }
  return found;
}

function refusedFor(queue: readonly PendingOp[], responseId: string): PendingOp | null {
  return (
    queue.find((op) => op.responseId === responseId && op.status === 'failed') ?? null
  );
}

/**
 * Effectif compté pour une rangée arrivée.
 *
 * Sans correction de l'accueil, on retient l'effectif ANNONCÉ. Ce n'est pas un
 * chiffre inventé — c'est celui que l'invité a donné, non démenti — et la
 * différence est dite à l'écran. Retenir zéro ferait disparaître de la salle des
 * gens qui y sont ; exiger une saisie par invité ferait taper cent cinquante
 * nombres pour en corriger trois.
 */
function countedFor(peopleIn: number | null, announced: number): number {
  if (peopleIn !== null) return peopleIn;
  return Math.max(1, announced);
}

export function deskList(
  guests: readonly GuestRow[],
  state: DeskState,
): DeskList {
  const rows: DeskRow[] = [];
  let inRoom = 0;
  let arrivedCount = 0;
  let expectedCount = 0;
  let expectedPeople = 0;
  let pendingCount = 0;
  let refusedCount = 0;
  let correctedCount = 0;

  for (const guest of guests) {
    const server = state.states[guest.id];
    const pending = pendingFor(state.queue, guest.id);
    const refused = refusedFor(state.queue, guest.id);

    // Le geste en vol l'emporte ; à défaut, l'état serveur fait foi.
    const arrived = pending ? pending.arrived : server?.arrivedAt !== null && server !== undefined;
    const peopleIn = pending ? pending.peopleIn : (server?.peopleIn ?? null);
    const counted = arrived ? countedFor(peopleIn, guest.people) : 0;

    if (guest.status === 'attending') {
      expectedCount += 1;
      expectedPeople += Math.max(1, guest.people);
    }
    if (arrived) {
      arrivedCount += 1;
      inRoom += counted;
      if (peopleIn !== null) correctedCount += 1;
    }
    if (pending) pendingCount += 1;
    if (refused) refusedCount += 1;

    rows.push({
      id: guest.id,
      name: guest.name,
      initials: guest.initials,
      detail: guest.detail,
      expected: guest.status,
      announced: guest.people,
      ambiguous: guest.ambiguous,
      arrived,
      pending: pending !== null,
      refused: refused ? { opId: refused.opId, message: refused.error ?? 'Refusé' } : null,
      peopleIn,
      counted,
    });
  }

  return {
    rows,
    totals: {
      inRoom,
      arrived: arrivedCount,
      expected: expectedCount,
      expectedPeople,
      pending: pendingCount,
      refused: refusedCount,
      corrected: correctedCount,
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
  if (row.expected === 'declined') return 'A décliné';
  if (row.expected === 'unknown') return 'Sans réponse';
  return 'Attendu';
}
