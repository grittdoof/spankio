import {
  setRequestContextFactoryForTests,
  type RequestContext,
} from '@/lib/data/context';
import { resetMemoryLimiter } from '@/lib/security/rate-limit';
import { ANON, asUser, type Actor, type TestDb } from './db';
import { createPglitePort } from './pglite-port';

/**
 * Harnais d'exécution des routes API.
 *
 * Les handlers de route sont appelés TELS QUELS ; seul le contexte de requête
 * est injecté, et il pointe vers PGlite. Conséquence : ce sont les vraies
 * policies RLS qui décident, donc un test d'isolation par route prouve
 * réellement quelque chose sur le code de production.
 */

export interface RouteHarness {
  /** Agit comme l'utilisateur donné (session valide). */
  actAs(userId: string, email?: string): void;
  /** Agit comme un visiteur non authentifié. */
  actAsAnonymous(): void;
  /**
   * Agit avec une session valide mais un accès aux données non authentifié :
   * sert à vérifier qu'une route ne s'appuie pas seulement sur `userId`.
   */
  actAsSessionWithoutRights(userId: string): void;
  dispose(): void;
}

export function createRouteHarness(db: TestDb): RouteHarness {
  let actor: Actor = ANON;
  let userId: string | null = null;
  let email: string | null = null;

  const factory = (): Promise<RequestContext> =>
    Promise.resolve({
      port: createPglitePort(db, actor),
      userId,
      email,
    });

  setRequestContextFactoryForTests(factory);

  return {
    actAs(id: string, address = 'compte@test.local') {
      actor = asUser(id);
      userId = id;
      email = address;
    },
    actAsAnonymous() {
      actor = ANON;
      userId = null;
      email = null;
    },
    actAsSessionWithoutRights(id: string) {
      actor = ANON;
      userId = id;
      email = 'compte@test.local';
    },
    dispose() {
      setRequestContextFactoryForTests(null);
      resetMemoryLimiter();
    },
  };
}

let ipCounter = 0;

/**
 * Construit une requête JSON. Par défaut chaque appel reçoit une IP distincte,
 * pour qu'un test ne consomme pas le quota d'un autre. Passer `ip` permet
 * justement de tester la limitation de débit.
 */
export function jsonRequest(
  method: string,
  path: string,
  body?: unknown,
  options: { ip?: string; headers?: Record<string, string> } = {},
): Request {
  ipCounter += 1;
  const headers = new Headers({
    'content-type': 'application/json',
    'x-forwarded-for': options.ip ?? `203.0.113.${ipCounter % 250}`,
    ...options.headers,
  });

  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export interface JsonResponse<T> {
  status: number;
  body: T;
}

export async function readJson<T>(response: Response): Promise<JsonResponse<T>> {
  return { status: response.status, body: (await response.json()) as T };
}

/** Corps d'erreur normalisé des routes. */
export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}
