import { resolveRequestContext, type RequestContext } from '@/lib/data/context';
import {
  checkRateLimit,
  clientIdentifier,
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
  /** Exige une session valide. */
  requireSession?: boolean;
}

export async function guard(
  request: Request,
  options: GuardOptions = {},
): Promise<GuardOutcome> {
  if (options.rateLimit) {
    const result = await checkRateLimit(options.rateLimit, clientIdentifier(request.headers));
    if (!result.allowed) {
      return { ok: false, response: tooManyRequests(result) };
    }
  }

  const context = await resolveRequestContext(request);

  if (options.requireSession && !context.userId) {
    return { ok: false, response: jsonError('unauthenticated') };
  }

  return { ok: true, context };
}
