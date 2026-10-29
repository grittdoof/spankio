/**
 * Ce qu'une hôtesse VOIT — état serveur plus file locale, composés ici et
 * nulle part ailleurs.
 *
 * Cette décision ne peut pas vivre dans un composant. C'est elle qui arbitre
 * entre « le serveur dit absent » et « je viens de taper présent », et c'est
 * exactement le genre de logique qui se vérifie mal à l'œil, debout, à l'entrée
 * d'une salle. Elle est donc pure, et testée sans navigateur.
 *
 * Trois règles, et la troisième est celle qu'on oublie :
 *
 *  1. **Un geste non encore confirmé l'emporte sur l'état serveur.** La rangée
 *     verdit au doigt, pas au retour du réseau — sinon chaque pointage aurait
 *     l'air d'avoir échoué pendant une seconde.
 *  2. **Un geste REFUSÉ rend la main à l'état serveur**, avec son message.
 *     Laisser la rangée verte après un refus afficherait un présent qui n'en
 *     est pas un, et c'est précisément le chiffre qu'on viendra chercher.
 *  3. **Un refus ne disparaît pas tout seul.** Il reste jusqu'à ce qu'on le
 *     lise et qu'on le chasse : une erreur qui s'efface au bout de trois
 *     secondes est une erreur que personne n'a vue.
 */

/** État d'arrivée tel que la base le porte. Absence = pas arrivé, version 0. */
export interface CheckinState {
  readonly responseId: string;
  readonly arrivedAt: string | null;
  readonly peopleIn: number | null;
  readonly version: number;
  /** Horodatage de la dernière écriture, qui sert de curseur au delta. */
  readonly updatedAt: string;
}

/**
 * `queued` attend son tour, `sending` est parti, `failed` a été refusé et
 * attend d'être lu. Il n'y a pas d'état « réussi » : une opération appliquée
 * quitte la file, sans quoi celle-ci grossirait toute la soirée.
 */
export type PendingStatus = 'queued' | 'sending' | 'failed';

export interface PendingOp {
  /** Généré par le client : c'est lui qui porte l'idempotence. */
  readonly opId: string;
  readonly responseId: string;
  readonly arrived: boolean;
  readonly peopleIn: number | null;
  readonly attempts: number;
  readonly status: PendingStatus;
  /** Message du refus, destiné à être lu sur la rangée. */
  readonly error: string | null;
}

export interface DeskState {
  readonly states: Readonly<Record<string, CheckinState>>;
  readonly queue: readonly PendingOp[];
  /** Dernier delta reçu, en millisecondes. `null` : jamais synchronisé. */
  readonly syncedAt: number | null;
  /** Plus grand `updated_at` connu : le curseur du prochain delta. */
  readonly cursor: string | null;
}

export const EMPTY_DESK: DeskState = {
  states: {},
  queue: [],
  syncedAt: null,
  cursor: null,
};

export type DeskAction =
  /** Premier chargement : l'état serveur remplace tout ce qu'on croyait. */
  | { readonly type: 'hydrate'; readonly states: readonly CheckinState[]; readonly at: number }
  /** Rafraîchissement par delta : fusion, jamais remplacement. */
  | { readonly type: 'delta'; readonly states: readonly CheckinState[]; readonly at: number }
  | {
      readonly type: 'tap';
      readonly opId: string;
      readonly responseId: string;
      readonly arrived: boolean;
      readonly peopleIn: number | null;
    }
  | { readonly type: 'sending'; readonly opId: string }
  | { readonly type: 'applied'; readonly opId: string; readonly state: CheckinState }
  | { readonly type: 'refused'; readonly opId: string; readonly message: string }
  | { readonly type: 'retry'; readonly opId: string }
  | { readonly type: 'dismiss'; readonly opId: string };

function mergeStates(
  current: Readonly<Record<string, CheckinState>>,
  incoming: readonly CheckinState[],
): Readonly<Record<string, CheckinState>> {
  const next: Record<string, CheckinState> = { ...current };
  for (const state of incoming) {
    const known = next[state.responseId];
    // Une version PLUS BASSE n'écrase pas : le delta et la réponse d'une
    // écriture peuvent se croiser, et la plus récente des deux gagne.
    if (known && known.version > state.version) continue;
    next[state.responseId] = state;
  }
  return next;
}

function latestCursor(
  current: string | null,
  incoming: readonly CheckinState[],
): string | null {
  let cursor = current;
  for (const state of incoming) {
    if (cursor === null || state.updatedAt > cursor) cursor = state.updatedAt;
  }
  return cursor;
}

export function deskReducer(state: DeskState, action: DeskAction): DeskState {
  switch (action.type) {
    case 'hydrate': {
      const states: Record<string, CheckinState> = {};
      for (const one of action.states) states[one.responseId] = one;
      return {
        ...state,
        states,
        syncedAt: action.at,
        cursor: latestCursor(null, action.states),
      };
    }

    case 'delta':
      return {
        ...state,
        states: mergeStates(state.states, action.states),
        syncedAt: action.at,
        cursor: latestCursor(state.cursor, action.states),
      };

    case 'tap':
      return {
        ...state,
        queue: [
          // Un refus NON LU sur la même rangée est remplacé : on vient de
          // reprendre la main dessus, le message précédent n'a plus d'objet.
          ...state.queue.filter(
            (op) => !(op.responseId === action.responseId && op.status === 'failed'),
          ),
          {
            opId: action.opId,
            responseId: action.responseId,
            arrived: action.arrived,
            peopleIn: action.peopleIn,
            attempts: 0,
            status: 'queued',
            error: null,
          },
        ],
      };

    case 'sending':
      return {
        ...state,
        queue: state.queue.map((op) =>
          op.opId === action.opId
            ? { ...op, status: 'sending', attempts: op.attempts + 1, error: null }
            : op,
        ),
      };

    case 'applied':
      return {
        ...state,
        // L'opération quitte la file : elle est devenue un fait.
        queue: state.queue.filter((op) => op.opId !== action.opId),
        states: mergeStates(state.states, [action.state]),
        cursor: latestCursor(state.cursor, [action.state]),
      };

    case 'refused':
      return {
        ...state,
        queue: state.queue.map((op) =>
          op.opId === action.opId ? { ...op, status: 'failed', error: action.message } : op,
        ),
      };

    case 'retry':
      return {
        ...state,
        queue: state.queue.map((op) =>
          op.opId === action.opId ? { ...op, status: 'queued', error: null } : op,
        ),
      };

    case 'dismiss':
      return { ...state, queue: state.queue.filter((op) => op.opId !== action.opId) };

    default: {
      // Exhaustivité vérifiée par le compilateur : un cas ajouté sans
      // traitement ne compile pas.
      const impossible: never = action;
      return impossible;
    }
  }
}

/**
 * Prochaine opération à envoyer, ou `null`.
 *
 * Une seule à la fois, dans l'ordre : deux pointages concurrents sur la MÊME
 * rangée se marcheraient dessus, le second annonçant une version que le premier
 * vient de périmer. Sérialiser coûte quelques millisecondes et supprime la
 * classe entière de ces défauts.
 */
export function nextOp(state: DeskState): PendingOp | null {
  if (state.queue.some((op) => op.status === 'sending')) return null;
  return state.queue.find((op) => op.status === 'queued') ?? null;
}

/**
 * Version à annoncer au serveur pour cette réponse.
 *
 * Lue à l'ENVOI, jamais à la saisie : entre les deux, l'opération précédente a
 * pu incrémenter la version, et une valeur figée au doigt ferait échouer en
 * `PT409` un simple double appui.
 */
export function expectedVersionOf(state: DeskState, responseId: string): number {
  return state.states[responseId]?.version ?? 0;
}

/** Délai avant reprise, plafonné. Le réseau d'une salle revient par à-coups. */
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;

export function retryDelay(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
}
