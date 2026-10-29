/**
 * La FRAÎCHEUR de la liste, écrite en toutes lettres.
 *
 * C'est le garde-fou central du module, et il tient en une phrase : une liste
 * périmée qui a l'air vivante est un danger, une liste périmée qui le dit est
 * une information. À une porte, une liste gelée fait entrer deux fois la même
 * personne et refuse quelqu'un qui vient d'être pointé par le collègue d'à
 * côté — sans que personne ne comprenne pourquoi.
 *
 * C'est le même raisonnement qu'« aucune jauge sans dénominateur » : on
 * n'affiche pas un chiffre sans dire ce qui le fonde.
 */

/** Rythme du delta. Cinq secondes : assez pour deux postes, peu pour le réseau. */
export const POLL_INTERVAL_MS = 5_000;

/** Au-delà, la liste n'est plus « à jour » et le dit autrement. */
export const STALE_AFTER_MS = 20_000;

export type FreshnessTone = 'fresh' | 'stale' | 'offline' | 'never';

export interface Freshness {
  readonly tone: FreshnessTone;
  /** Phrase affichée, complète et autonome. */
  readonly text: string;
  /** Secondes écoulées depuis la dernière synchronisation. */
  readonly seconds: number;
}

function secondsSince(syncedAt: number, now: number): number {
  return Math.max(0, Math.round((now - syncedAt) / 1000));
}

/**
 * `online` vient du navigateur ; `syncedAt` du dernier delta REÇU.
 *
 * Les deux sont nécessaires : `navigator.onLine` ment volontiers — un portail
 * captif de salle de réception répond « en ligne » tout en bloquant tout — et
 * seul un delta effectivement revenu prouve que la liste est à jour.
 */
export function freshness(
  syncedAt: number | null,
  now: number,
  online: boolean,
): Freshness {
  if (syncedAt === null) {
    return {
      tone: 'never',
      text: online ? 'Synchronisation en cours…' : 'Hors ligne, liste jamais synchronisée',
      seconds: 0,
    };
  }

  const seconds = secondsSince(syncedAt, now);

  if (!online) {
    return {
      tone: 'offline',
      text: `Hors ligne depuis ${seconds} s — les pointages partiront au retour du réseau`,
      seconds,
    };
  }

  if (now - syncedAt > STALE_AFTER_MS) {
    return {
      tone: 'stale',
      text: `Liste figée depuis ${seconds} s — le serveur ne répond plus`,
      seconds,
    };
  }

  return {
    tone: 'fresh',
    text: seconds <= 1 ? 'À jour à l’instant' : `À jour il y a ${seconds} s`,
    seconds,
  };
}
