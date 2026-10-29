import type { PendingOp } from './reducer';

/**
 * Persistance de la FILE, et d'elle seule.
 *
 * Ce qui est stocké : les pointages pas encore confirmés. Un verrouillage
 * d'écran, un onglet fermé par erreur ou un rechargement ne doivent pas
 * effacer un geste déjà fait — c'est exactement la panne que la file existe
 * pour couvrir.
 *
 * Ce qui n'est PAS stocké : la liste des invités. La note d'architecture
 * prévoyait aussi un instantané, pour qu'un poste ouvert hors ligne affiche
 * quelque chose. Il n'est pas repris ici, et c'est un choix, pas un oubli :
 * cet instantané est une liste nominative — noms, parfois courriels — déposée
 * sur un téléphone souvent personnel, pour couvrir le seul cas où l'écran
 * s'ouvre SANS réseau. Or ce cas a déjà une réponse, meilleure et sans donnée
 * sur l'appareil : la liste imprimée de la veille. La file, elle, ne contient
 * que des identifiants et des booléens.
 *
 * La file expire de toute façon : une opération vieille de plusieurs heures ne
 * décrit plus la soirée en cours, et la renvoyer ferait rebasculer un invité
 * sans que personne ne l'ait demandé.
 */

const KEY_PREFIX = 'spk.checkin.queue.';

/** Au-delà, la file est abandonnée plutôt que rejouée. */
export const QUEUE_TTL_MS = 12 * 60 * 60 * 1000;

/** Une file plus longue signale une panne, pas un usage. */
export const QUEUE_MAX = 500;

interface StoredQueue {
  readonly savedAt: number;
  readonly ops: readonly PendingOp[];
}

function keyFor(surveyId: string): string {
  return `${KEY_PREFIX}${surveyId}`;
}

/**
 * Tout accès est enveloppé : en navigation privée, avec les données de site
 * bloquées, ou sur un quota plein, l'accesseur LÈVE. Une exception ici ferait
 * tomber l'écran de pointage pour une commodité — le poste doit continuer de
 * fonctionner sans mémoire, simplement sans survivre à un rechargement.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Ce qui sort du stockage est une entrée NON FIABLE comme une autre : un autre
 * onglet, une extension ou une version précédente de l'application ont pu y
 * écrire. On reconstruit donc chaque opération champ par champ au lieu de
 * faire confiance à la forme — la même règle que la validation d'une
 * soumission publique.
 */
function toPendingOp(value: unknown): PendingOp | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw['opId'] !== 'string' || typeof raw['responseId'] !== 'string') return null;
  if (typeof raw['arrived'] !== 'boolean') return null;

  const peopleIn = raw['peopleIn'];
  const attempts = raw['attempts'];
  const error = raw['error'];

  return {
    opId: raw['opId'],
    responseId: raw['responseId'],
    arrived: raw['arrived'],
    peopleIn: typeof peopleIn === 'number' ? peopleIn : null,
    attempts: typeof attempts === 'number' ? attempts : 0,
    // Une opération reprise après un rechargement n'est plus « en vol » : elle
    // attend son tour. La laisser en `sending` figerait la file, puisque le
    // vidage refuse de démarrer tant qu'un envoi est en cours. Un refus déjà
    // enregistré, lui, reste à lire.
    status: raw['status'] === 'failed' ? 'failed' : 'queued',
    error: typeof error === 'string' ? error : null,
  };
}

export function loadQueue(surveyId: string, now: number = Date.now()): PendingOp[] {
  const store = safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(keyFor(surveyId));
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { savedAt, ops } = parsed as Partial<StoredQueue>;
    if (typeof savedAt !== 'number' || !Array.isArray(ops)) return [];

    if (now - savedAt > QUEUE_TTL_MS) {
      store.removeItem(keyFor(surveyId));
      return [];
    }

    return ops
      .map((entry: unknown) => toPendingOp(entry))
      .filter((op): op is PendingOp => op !== null);
  } catch {
    return [];
  }
}

export function saveQueue(
  surveyId: string,
  ops: readonly PendingOp[],
  now: number = Date.now(),
): void {
  const store = safeStorage();
  if (!store) return;
  try {
    if (ops.length === 0) {
      store.removeItem(keyFor(surveyId));
      return;
    }
    const payload: StoredQueue = { savedAt: now, ops: ops.slice(0, QUEUE_MAX) };
    store.setItem(keyFor(surveyId), JSON.stringify(payload));
  } catch {
    // Quota plein ou écriture refusée : on continue sans persistance.
  }
}

/** Appelée à la déconnexion : rien de ce poste ne reste sur l'appareil. */
export function clearQueues(): void {
  const store = safeStorage();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(KEY_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    // Rien à faire : l'absence de nettoyage n'expose aucune donnée d'invité.
  }
}
