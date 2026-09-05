import { logger } from '@/lib/logger';
import type { RateLimitStoreConfig } from './rate-limit';

/**
 * Verrou global de courte durée, partagé par toutes les instances.
 *
 * Différent du rate-limit : celui-ci compte par appelant, celui-là plafonne
 * l'APPLICATION ENTIÈRE. C'est ce qu'exige la politique d'usage de Nominatim —
 * une requête par seconde pour tout spankio, pas une par utilisateur.
 *
 * `SET clé 1 NX EX ttl` est atomique côté Redis : la première instance obtient
 * le créneau, les autres reçoivent un refus. Aucune fenêtre de course.
 *
 * **Comportement en panne : dégradation, pas fermeture.** Si le store est
 * injoignable, l'appel passe, mais UNIQUEMENT après le garde-fou mémoire de
 * l'instance : chaque instance reste à un appel par seconde, et le plafond
 * réel devient « une requête par seconde et par instance ». Ce n'est pas la
 * garantie recherchée, et c'est dit tel quel plutôt qu'annoncé comme un
 * fail-closed. Le choix se justifie ainsi : fermer complètement rendrait la
 * recherche d'adresse indisponible à chaque hoquet de KV, alors qu'un
 * dépassement bref et modeste sur une fonction d'administration peu
 * fréquentée ne met pas l'application en risque de bannissement.
 *
 * Conséquence assumée du garde-fou local : il est consommé même quand le store
 * refuse ensuite le créneau. L'instance attend donc parfois une seconde de
 * plus que nécessaire — l'erreur penche du côté qui appelle moins.
 */

export interface GlobalSlotDeps {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  store?: RateLimitStoreConfig | null;
  timeoutMs?: number;
}

/** Dernier créneau pris par CETTE instance, par clé. Second rideau. */
const localSlots = new Map<string, number>();

/** Vide le garde-fou mémoire (tests uniquement). */
export function resetGlobalSlots(): void {
  localSlots.clear();
}

function reserveLocally(key: string, intervalMs: number, now: number): boolean {
  const last = localSlots.get(key);
  if (last !== undefined && now - last < intervalMs) return false;
  localSlots.set(key, now);
  return true;
}

function resolveStore(deps: GlobalSlotDeps): RateLimitStoreConfig | null {
  if (deps.store !== undefined) return deps.store;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/**
 * Tente de réserver le créneau `key` pour `intervalMs`.
 * Renvoie `true` si l'appel peut partir, `false` s'il doit être refusé.
 */
export async function reserveGlobalSlot(
  key: string,
  intervalMs: number,
  deps: GlobalSlotDeps = {},
): Promise<boolean> {
  const now = (deps.now ?? (() => Date.now()))();
  const store = resolveStore(deps);

  // Le garde-fou local est consulté D'ABORD : s'il refuse, inutile d'aller
  // interroger le store, et l'instance respecte l'intervalle même seule.
  if (!reserveLocally(key, intervalMs, now)) return false;

  if (!store) {
    logger.warn(
      'throttle.store_absent',
      'Aucun store distribué : le plafond global n’est tenu que par instance.',
      { key },
    );
    return true;
  }

  const seconds = Math.max(1, Math.ceil(intervalMs / 1000));

  try {
    const response = await (deps.fetch ?? globalThis.fetch)(
      `${store.url.replace(/\/$/, '')}/set/${encodeURIComponent(key)}/1/NX/EX/${seconds}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${store.token}` },
        signal: AbortSignal.timeout(deps.timeoutMs ?? 1000),
        cache: 'no-store',
      },
    );

    if (!response.ok) throw new Error(`Store de verrou : HTTP ${response.status}`);

    const payload = (await response.json()) as { result?: unknown };
    // `SET ... NX` renvoie « OK » si la clé a été posée, `null` si elle
    // existait déjà. Toute autre réponse est traitée comme un refus : on ne
    // suppose pas avoir le créneau quand on ne comprend pas la réponse.
    return payload.result === 'OK';
  } catch (error) {
    logger.error(
      'throttle.store_unreachable',
      'Verrou global injoignable : seul le garde-fou mémoire s’applique.',
      { key },
      error,
    );
    // Le créneau local a été pris plus haut : l'instance respecte l'intervalle.
    return true;
  }
}
