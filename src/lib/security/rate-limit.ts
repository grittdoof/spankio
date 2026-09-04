import { logger } from '@/lib/logger';

/**
 * Limitation de débit DISTRIBUÉE (Vercel KV / Upstash Redis via REST).
 *
 * Pourquoi pas un compteur en mémoire : sur Vercel, chaque instance a sa propre
 * mémoire et repart de zéro à chaque démarrage à froid — une limite en RAM ne
 * limite donc rien. Le compteur vit dans le store partagé.
 *
 * Comportement en panne du store : FAIL-OPEN (risque R2 de CLAUDE.md). Refuser
 * les requêtes transformerait une panne KV en indisponibilité totale des
 * soumissions publiques. Un garde-fou mémoire par instance sert de second
 * rideau, et l'incident est journalisé en `error`.
 *
 * RGPD : la clé est une empreinte SHA-256 de l'IP, avec une durée de vie égale
 * à la fenêtre. L'adresse elle-même n'est jamais stockée, et JAMAIS écrite en
 * base applicative.
 */

export interface RateLimitRule {
  /** Nombre de requêtes autorisées dans la fenêtre. */
  readonly limit: number;
  /** Largeur de la fenêtre, en secondes. */
  readonly windowSeconds: number;
}

/** Limites par usage. Volontairement basses sur les surfaces publiques. */
export const RATE_LIMITS = {
  publicSubmit: { limit: 5, windowSeconds: 60 },
  auth: { limit: 10, windowSeconds: 300 },
  membershipRequest: { limit: 3, windowSeconds: 3600 },
  erasureRequest: { limit: 3, windowSeconds: 3600 },
  geocode: { limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Date (epoch ms) à laquelle la fenêtre se referme. */
  resetAt: number;
  /** Vrai si le store distribué était injoignable (second rideau utilisé). */
  degraded: boolean;
}

export interface RateLimitStoreConfig {
  url: string;
  token: string;
}

export interface RateLimitDeps {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  store?: RateLimitStoreConfig | null;
  /** Délai au-delà duquel on considère le store injoignable. */
  timeoutMs?: number;
}

/** Empreinte de l'identifiant d'appelant : l'IP ne sort jamais en clair. */
export async function hashIdentifier(identifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(identifier);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Extrait l'IP de l'appelant depuis les en-têtes du proxy.
 * Le premier saut de `x-forwarded-for` est celui posé par Vercel.
 */
export function clientIdentifier(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() ?? 'inconnu';
}

// ---------------------------------------------------------------------------
// Second rideau : compteur mémoire, par instance. Il ne remplace pas le store
// distribué — il évite qu'une panne KV ouvre complètement la porte.
// ---------------------------------------------------------------------------
interface MemoryEntry {
  count: number;
  resetAt: number;
}

const memory = new Map<string, MemoryEntry>();

/** Purge paresseuse : évite que la Map grossisse indéfiniment. */
function sweepMemory(now: number): void {
  if (memory.size < 5000) return;
  for (const [key, entry] of memory) {
    if (entry.resetAt <= now) memory.delete(key);
  }
}

function consumeMemory(key: string, rule: RateLimitRule, now: number): RateLimitResult {
  sweepMemory(now);
  const existing = memory.get(key);
  if (!existing || existing.resetAt <= now) {
    const entry = { count: 1, resetAt: now + rule.windowSeconds * 1000 };
    memory.set(key, entry);
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit - 1,
      resetAt: entry.resetAt,
      degraded: true,
    };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    resetAt: existing.resetAt,
    degraded: true,
  };
}

/** Vide le compteur mémoire (tests uniquement). */
export function resetMemoryLimiter(): void {
  memory.clear();
}

function resolveStore(deps: RateLimitDeps): RateLimitStoreConfig | null {
  if (deps.store !== undefined) return deps.store;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

interface PipelineEntry {
  result?: unknown;
  error?: string;
}

/**
 * Fenêtre fixe en deux commandes atomiques côté Redis : `INCR` puis, si c'est
 * la première requête de la fenêtre, `EXPIRE`. Le TTL borne la conservation de
 * l'empreinte d'IP.
 */
async function consumeStore(
  store: RateLimitStoreConfig,
  key: string,
  rule: RateLimitRule,
  deps: Required<Pick<RateLimitDeps, 'fetch' | 'now' | 'timeoutMs'>>,
): Promise<RateLimitResult> {
  const response = await deps.fetch(`${store.url.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${store.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(rule.windowSeconds), 'NX'],
      ['PTTL', key],
    ]),
    signal: AbortSignal.timeout(deps.timeoutMs),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Store de rate-limit : HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PipelineEntry[];
  const incr = payload[0];
  if (!incr || incr.error !== undefined || typeof incr.result !== 'number') {
    throw new Error(`Réponse inattendue du store de rate-limit : ${JSON.stringify(payload)}`);
  }

  const count = incr.result;
  const pttl = payload[2]?.result;
  const remainingMs =
    typeof pttl === 'number' && pttl > 0 ? pttl : rule.windowSeconds * 1000;

  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt: deps.now() + remainingMs,
    degraded: false,
  };
}

/**
 * Consomme un jeton pour `identifier` dans le seau `bucket`.
 * Ne lève jamais : une panne du store est un incident journalisé, pas une
 * erreur remontée à l'utilisateur.
 */
export async function checkRateLimit(
  bucket: RateLimitBucket,
  identifier: string,
  deps: RateLimitDeps = {},
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[bucket];
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? 1000;
  const key = `rl:${bucket}:${await hashIdentifier(identifier)}`;
  const store = resolveStore(deps);

  if (!store) {
    logger.warn(
      'ratelimit.store_absent',
      'Aucun store distribué configuré : garde-fou mémoire par instance uniquement.',
      { bucket },
    );
    return consumeMemory(key, rule, now());
  }

  try {
    return await consumeStore(store, key, rule, { fetch: fetchImpl, now, timeoutMs });
  } catch (error) {
    // FAIL-OPEN assumé (R2) : on laisse passer, on alerte, et on retombe sur
    // le compteur mémoire pour ne pas être totalement à découvert.
    logger.error(
      'ratelimit.store_unreachable',
      'Store de rate-limit injoignable : bascule sur le garde-fou mémoire.',
      { bucket },
      error,
    );
    return consumeMemory(key, rule, now());
  }
}

/** En-têtes standard à renvoyer avec une réponse limitée. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
  if (!result.allowed) {
    headers['Retry-After'] = headers['RateLimit-Reset'] ?? '60';
  }
  return headers;
}
