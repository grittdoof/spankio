import { z } from '@/lib/config/zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { readCheckins, recordCheckin } from '@/lib/services/checkin';

/**
 * Poste d'accueil : lecture du delta et pointage d'une arrivée.
 *
 * **Pourquoi une route plutôt qu'un appel direct du navigateur à Supabase.**
 * La note d'architecture proposait l'appel direct, pour retirer une pièce du
 * chemin critique — le précédent du téléversement de bannière. Deux arguments
 * l'ont emporté dans l'autre sens, et il vaut mieux l'écrire que de laisser
 * croire à un oubli.
 *
 * D'abord, la même note exige de corriger le seau de rate-limit pour qu'il
 * compte par UTILISATEUR et non par IP : un appel direct à Supabase ne
 * traverse aucun de nos seaux, et cette correction n'aurait plus d'objet.
 * Ensuite, une route s'exécute dans le harnais d'intégration CONTRE les vraies
 * policies : c'est l'outil de vérification le plus solide du projet, et le
 * chemin qui porte les pointages d'une soirée mérite d'en bénéficier.
 *
 * Le coût est réel et assumé : une fonction Vercel de plus dans le chemin. Il
 * est borné par le fait que Vercel rend déjà la page elle-même, donc en est
 * déjà une dépendance.
 */

const paramsSchema = z.object({ id: z.string().uuid() });

const querySchema = z.object({
  /** Curseur : le plus grand `updated_at` déjà connu du client. */
  depuis: z.string().datetime({ offset: true }).optional(),
});

const bodySchema = z.object({
  responseId: z.string().uuid(),
  arrived: z.boolean(),
  /** Généré par le client : c'est lui qui porte l'idempotence. */
  opId: z.string().uuid(),
  /**
   * Version attendue. `null` passe outre le contrôle de concurrence —
   * délibérément offert, parce que l'écran de rattrapage d'un organisateur
   * n'a aucune concurrence à craindre.
   */
  expectedVersion: z.number().int().min(0).max(1_000_000).nullable(),
  /** Effectif réellement entré. `null` : non précisé, jamais zéro. */
  peopleIn: z.number().int().min(0).max(999).nullable(),
});

/** Corps d'un pointage : quelques centaines d'octets, jamais plus. */
const CHECKIN_MAX_BODY_BYTES = 4_096;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, {
    requireSession: true,
    rateLimit: 'checkin',
    rateLimitBy: 'user',
  });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const url = new URL(request.url);
  const parsedQuery = parseWith(querySchema, {
    depuis: url.searchParams.get('depuis') ?? undefined,
  });
  if (!parsedQuery.ok) return parsedQuery.response;

  const states = await readCheckins(
    guarded.context,
    parsedParams.value.id,
    parsedQuery.value.depuis,
  );
  if (!states.ok) return mapDbError(states.error, 'checkin.delta_failed');

  // `at` est l'instant du SERVEUR. Le client s'en sert pour dire la fraîcheur,
  // et une horloge de téléphone mal réglée ne doit pas la fausser.
  return jsonOk({ states: states.value, at: new Date().toISOString() });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, {
    requireSession: true,
    rateLimit: 'checkin',
    rateLimitBy: 'user',
  });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const body = await readJsonBody(request, CHECKIN_MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = parseWith(bodySchema, body.value);
  if (!parsed.ok) return parsed.response;

  /*
   * L'identifiant du sondage de l'URL n'est pas transmis à la fonction SQL :
   * elle le retrouve depuis la réponse et revérifie l'autorisation dessus. Le
   * passer serait une donnée de plus à ne pas croire. Il reste utile ici pour
   * que la route soit adressée par événement, donc limitée par événement.
   */
  const recorded = await recordCheckin(guarded.context, {
    responseId: parsed.value.responseId,
    arrived: parsed.value.arrived,
    opId: parsed.value.opId,
    expectedVersion: parsed.value.expectedVersion,
    peopleIn: parsed.value.peopleIn,
  });
  if (!recorded.ok) return mapDbError(recorded.error, 'checkin.set_failed');

  return jsonOk(recorded.value);
}
