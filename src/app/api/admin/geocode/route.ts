import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { jsonError, jsonOk } from '@/lib/api/respond';
import { publicEnv, serverSetting } from '@/lib/config/env';
import {
  NOMINATIM_MIN_INTERVAL_MS,
  nominatimUrl,
  nominatimUserAgent,
  parseGeocodeResults,
} from '@/lib/event/geocode';
import { logger } from '@/lib/logger';
import { reserveGlobalSlot } from '@/lib/security/global-throttle';

/**
 * Recherche d'adresse, relayée vers Nominatim (OpenStreetMap).
 *
 * Le navigateur ne contacte jamais Nominatim lui-même : la politique d'usage
 * d'OSM impose un `User-Agent` identifiant l'application et un plafond d'une
 * requête par seconde pour l'application ENTIÈRE — deux contraintes qu'un
 * navigateur ne peut pas honorer. Passer par ici évite en outre de révéler à un
 * tiers l'adresse IP de chaque personne qui tape une adresse.
 *
 * Trois barrières, dans cet ordre :
 *  1. session obligatoire — la recherche d'adresse n'est pas une surface
 *     publique, elle sert à régler un événement ;
 *  2. rate-limit par appelant (seau `geocode`) ;
 *  3. verrou global d'une seconde, partagé par toutes les instances.
 */

const querySchema = z
  .string()
  .trim()
  .min(3, 'Saisissez au moins trois caractères.')
  .max(200);

export async function GET(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true, rateLimit: 'geocode' });
  if (!guarded.ok) return guarded.response;

  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get('q') ?? '');
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues[0]?.message ?? 'Recherche invalide.',
    );
  }

  const reserved = await reserveGlobalSlot('geocode:nominatim', NOMINATIM_MIN_INTERVAL_MS);
  if (!reserved) {
    // 429 et non 503 : la requête est recevable, c'est le rythme qui ne l'est
    // pas. Le client attend et réessaie.
    return jsonError(
      'too_many_requests',
      'Recherche d’adresse momentanément saturée. Réessayez dans une seconde.',
    );
  }

  // `serverSetting` et non `serverEnv()` : chercher une adresse n'a aucune
  // raison d'exiger la présence de la clé de service.
  const userAgent = nominatimUserAgent(
    publicEnv().NEXT_PUBLIC_SITE_URL,
    serverSetting('NOMINATIM_USER_AGENT'),
  );

  try {
    const response = await fetch(nominatimUrl({ query: parsed.data }), {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      // Un tiers gratuit peut être lent ; on ne bloque pas une route
      // d'administration plus de quelques secondes pour autant.
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.warn('geocode.upstream_error', 'Nominatim a refusé la requête.', {
        status: response.status,
      });
      return jsonError(
        'server_error',
        'Le service de recherche d’adresse est momentanément indisponible.',
      );
    }

    // La réponse d'un tiers est une entrée non fiable : elle est reconstruite
    // champ par champ, jamais relayée telle quelle.
    return jsonOk({ results: parseGeocodeResults(await response.json()) });
  } catch (error) {
    // `error` et non `warn` : la cause est portée par l'objet d'erreur, que
    // seul `logger.error` transporte — un incident sans cause est inexploitable.
    logger.error('geocode.unreachable', 'Nominatim injoignable.', {}, error);
    return jsonError(
      'server_error',
      'Le service de recherche d’adresse est momentanément indisponible.',
    );
  }
}
