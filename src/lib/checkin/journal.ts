import type { CheckinLogRow } from '@/lib/services/checkin';
import { seatKey, type SeatRow } from './seats';

/**
 * L'historique de la porte, en ordre chronologique.
 *
 * Il existe pour UNE raison, et elle est défensive : quand quelque chose a
 * mal tourné — un invité qui jure être entré, un compteur qui ne tombe pas
 * juste, deux postes qui se contredisent — il faut pouvoir dire ce qui s'est
 * réellement passé, et dans quel ordre. Le journal était écrit depuis le lot
 * 2 ; rien ne le montrait.
 *
 * Deux décisions.
 *
 * **Le journal est la SOURCE, la liste n'est qu'un décodeur.** On ne
 * reconstruit pas l'historique à partir de l'état courant : l'état dit où on
 * en est, le journal dit comment on y est arrivé, et c'est le second qu'on
 * vient chercher quand le premier surprend. Une transition dont la personne
 * n'est plus identifiable reste donc affichée, sans nom — la faire
 * disparaître reviendrait à effacer précisément ce qu'on cherche.
 *
 * **Une correction de réponse laisse une trace « orpheline », et c'est
 * voulu.** Corriger une inscription lui donne un nouvel identifiant ; le
 * journal garde l'ancien, parce que c'est bien sous l'ancienne réponse que
 * les transitions ont eu lieu. L'écran le dit plutôt que de le masquer.
 */

export interface JournalEntry {
  /** `op_id` : unique par geste, y compris après un réessai réseau. */
  readonly id: string;
  readonly at: string;
  /** Vrai : la personne est entrée. Faux : on l'a retirée des arrivées. */
  readonly arrived: boolean;
  /** Nom de la personne pointée, ou `null` si elle n'est plus identifiable. */
  readonly who: string | null;
  readonly isCompanion: boolean;
  /** Nom de la personne qui a pointé. */
  readonly by: string | null;
  /** D'où vient le geste. Déduit des droits, jamais transmis par le client. */
  readonly source: 'desk' | 'admin';
}

export const JOURNAL_SOURCE_LABELS: Readonly<Record<'desk' | 'admin', string>> = {
  desk: 'Poste d’accueil',
  admin: 'Espace d’administration',
};

/**
 * Compose le journal lisible.
 *
 * L'ordre reçu du service est déjà du plus récent au plus ancien — c'est
 * celui qu'on veut : quand on ouvre cet écran, c'est que quelque chose vient
 * de se passer. On ne le retrie donc pas, on le DÉCODE.
 */
export function journalEntries(
  log: readonly CheckinLogRow[],
  seats: readonly SeatRow[],
  actors: ReadonlyMap<string, string>,
): readonly JournalEntry[] {
  const bySeat = new Map(seats.map((seat) => [seat.key, seat]));

  return log.map((row) => {
    const seat = bySeat.get(seatKey(row.responseId, row.seat));
    return {
      id: row.opId,
      at: row.at,
      arrived: row.arrived,
      who: seat?.name ?? null,
      isCompanion: seat?.isCompanion ?? false,
      by: row.byProfile === null ? null : (actors.get(row.byProfile) ?? null),
      source: row.source,
    };
  });
}

/** Ce qui s'est passé, en toutes lettres. */
export function journalActionLabel(entry: JournalEntry): string {
  return entry.arrived ? 'Arrivée pointée' : 'Arrivée retirée';
}

/**
 * Combien de gestes, et par combien de personnes.
 *
 * Deux faits recalculables, rien de plus : « 212 gestes, 3 personnes » dit en
 * une ligne si la soirée a été tenue à plusieurs, ce qu'on cherche d'abord
 * quand deux postes se contredisent.
 */
export function journalSummary(entries: readonly JournalEntry[]): {
  readonly total: number;
  readonly arrivals: number;
  readonly removals: number;
  readonly actors: number;
} {
  const actors = new Set<string>();
  let arrivals = 0;
  for (const entry of entries) {
    if (entry.arrived) arrivals += 1;
    if (entry.by) actors.add(entry.by);
  }
  return {
    total: entries.length,
    arrivals,
    removals: entries.length - arrivals,
    actors: actors.size,
  };
}
