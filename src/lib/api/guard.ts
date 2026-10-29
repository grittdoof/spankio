import { resolveRequestContext, type RequestContext } from '@/lib/data/context';
import {
  checkRateLimit,
  clientIdentifier,
  userIdentifier,
  type RateLimitBucket,
} from '@/lib/security/rate-limit';
import { jsonError, tooManyRequests } from './respond';

/**
 * Préambule commun aux routes : limitation de débit, puis résolution du
 * contexte (accès aux données + identité vérifiée).
 *
 * Ce préambule ne décide JAMAIS des droits métier — c'est le rôle du RLS et des
 * fonctions SQL. Il ne fait que refuser tôt ce qui est manifestement inutile :
 * un anonyme sur une route qui exige une session, ou un débit excessif.
 */

export type GuardOutcome =
  | { ok: true; context: RequestContext }
  | { ok: false; response: Response };

export interface GuardOptions {
  /** Seau de limitation. Omis : aucune limitation (routes de lecture internes). */
  rateLimit?: RateLimitBucket;
  /**
   * Sur quoi le seau est indexé.
   *
   * `ip` est le défaut, et le seul possible sans session. `user` existe pour
   * les surfaces où plusieurs comptes partagent une sortie réseau : six
   * hôtesses derrière le NAT d'une salle de réception n'ont qu'une IP, et un
   * seau par IP les ferait s'étrangler mutuellement en plein service.
   *
   * Conséquence sur l'ORDRE des deux étapes : indexer sur l'utilisateur oblige
   * à résoudre la session AVANT de limiter. C'est sans perte — les routes
   * d'administration résolvent déjà le contexte sans aucune limitation — et la
   * session est exigée de toute façon, donc un anonyme est refusé aussitôt.
   */
  rateLimitBy?: 'ip' | 'user';
  /** Exige une session valide. */
  requireSession?: boolean;
}

export async function guard(
  request: Request,
  options: GuardOptions = {},
): Promise<GuardOutcome> {
  const byUser = options.rateLimitBy === 'user';

  if (options.rateLimit && !byUser) {
    const result = await checkRateLimit(options.rateLimit, clientIdentifier(request.headers));
    if (!result.allowed) {
      return { ok: false, response: tooManyRequests(result) };
    }
  }

  const context = await resolveRequestContext(request);

  if (options.requireSession && !context.userId) {
    return { ok: false, response: jsonError('unauthenticated') };
  }

  if (options.rateLimit && byUser) {
    // Sans session identifiée, on retombe sur l'IP : mieux vaut un seau trop
    // large qu'aucun seau du tout.
    const identifier = context.userId
      ? userIdentifier(context.userId)
      : clientIdentifier(request.headers);
    const result = await checkRateLimit(options.rateLimit, identifier);
    if (!result.allowed) {
      return { ok: false, response: tooManyRequests(result) };
    }
  }

  return { ok: true, context };
}
