import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabasePort } from './supabase-port';
import type { DataPort } from './port';

/**
 * Contexte d'exécution d'une requête : l'accès aux données ET l'identité de
 * l'appelant, résolus au même endroit.
 *
 * `userId` vient de `auth.getUser()`, donc d'un jeton validé côté serveur —
 * jamais d'un en-tête ou d'un cookie lu tel quel.
 */
export interface RequestContext {
  readonly port: DataPort;
  /** `null` pour un visiteur anonyme. */
  readonly userId: string | null;
  readonly email: string | null;
}

export type RequestContextFactory = (request: Request) => Promise<RequestContext>;

let testFactory: RequestContextFactory | null = null;

/**
 * Point d'injection RÉSERVÉ AUX TESTS : il permet d'exécuter les vraies routes
 * contre PGlite, donc contre les vraies policies RLS.
 *
 * Il refuse de s'activer en production : un tel détournement contournerait
 * l'authentification.
 */
export function setRequestContextFactoryForTests(factory: RequestContextFactory | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      "setRequestContextFactoryForTests est interdit en production : ce point d'injection " +
        "contournerait l'authentification.",
    );
  }
  testFactory = factory;
}

export async function resolveRequestContext(request: Request): Promise<RequestContext> {
  if (testFactory) return testFactory(request);

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  return {
    port: createSupabasePort(client),
    userId: user?.id ?? null,
    email: user?.email ?? null,
  };
}
