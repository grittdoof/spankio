import { z } from 'zod';

/**
 * Accès typé aux variables d'environnement.
 *
 * Deux principes :
 *  1. Les secrets serveur ne sont lus que via `serverEnv()`, qui refuse de
 *     s'exécuter dans un bundle client (garde-fou anti-fuite de secret).
 *  2. Les intégrations optionnelles (Resend, rate-limit distribué, Sentry) ne
 *     bloquent jamais le démarrage : leur absence est signalée, pas fatale.
 */

const url = z.string().url();
const nonEmpty = z.string().min(1);

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  NEXT_PUBLIC_SITE_URL: url,
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  RESEND_API_KEY: nonEmpty.optional(),
  EMAIL_FROM: nonEmpty.optional(),
  KV_REST_API_URL: url.optional(),
  KV_REST_API_TOKEN: nonEmpty.optional(),
  SENTRY_DSN: nonEmpty.optional(),
  CRON_SECRET: nonEmpty.optional(),
  NOMINATIM_USER_AGENT: nonEmpty.optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export type EnvSource = Record<string, string | undefined>;

export class EnvError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(
      `Variables d'environnement manquantes ou invalides : ${missing.join(', ')}. ` +
        'Voir .env.example.',
    );
    this.name = 'EnvError';
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const key = issue.path.join('.');
    return `${key} (${issue.message})`;
  });
}

/** Parse les variables publiques. Fonction pure : testable sans process.env. */
export function parsePublicEnv(source: EnvSource): PublicEnv {
  const result = publicSchema.safeParse(source);
  if (!result.success) throw new EnvError(formatIssues(result.error));
  return result.data;
}

/** Parse les variables serveur. Fonction pure : testable sans process.env. */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) throw new EnvError(formatIssues(result.error));
  return result.data;
}

/**
 * Les variables `NEXT_PUBLIC_*` sont inlinées à la compilation par Next : elles
 * doivent être référencées littéralement, pas via un accès dynamique.
 */
export function publicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
}

let serverCache: ServerEnv | null = null;

/** Variables serveur (secrets compris). Interdit côté client. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      "serverEnv() a été appelé côté client : un secret serveur ne doit jamais " +
        'traverser la frontière réseau.',
    );
  }
  serverCache ??= parseServerEnv(process.env);
  return serverCache;
}

/** Réinitialise le cache (tests uniquement). */
export function resetServerEnvCache(): void {
  serverCache = null;
}

/** Emails transactionnels disponibles ? (dégradation silencieuse sinon) */
export function isEmailConfigured(source: EnvSource = process.env): boolean {
  return Boolean(source['RESEND_API_KEY'] && source['EMAIL_FROM']);
}

/** Store de rate-limit distribué disponible ? */
export function isRateLimitConfigured(source: EnvSource = process.env): boolean {
  return Boolean(source['KV_REST_API_URL'] && source['KV_REST_API_TOKEN']);
}
