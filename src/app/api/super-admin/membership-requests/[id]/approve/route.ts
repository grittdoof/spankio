import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { approvalSchema, approveMembershipRequest } from '@/lib/services/membership';

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Validation d'une demande par le super administrateur : il choisit le rôle ET
 * les modules autorisés pour ce compte.
 *
 * Aucune vérification de rôle ici : `approve_membership_request` refuse
 * elle-même tout appelant qui n'est pas super administrateur. Dupliquer le
 * contrôle dans la route donnerait deux endroits à maintenir, et l'un finirait
 * par mentir.
 *
 * Conséquence sur les réponses, volontaire : une demande que l'appelant ne peut
 * pas voir donne 404 (le RLS la masque, et répondre « interdit » confirmerait
 * qu'elle existe) ; une demande qu'il peut voir mais qu'il n'a pas le droit de
 * trancher donne 403.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseWith(approvalSchema, body.value);
  if (!parsed.ok) return parsed.response;

  const result = await approveMembershipRequest(
    guarded.context,
    parsedParams.value.id,
    parsed.value,
  );
  if (!result.ok) return mapDbError(result.error, 'membership.approve_failed');

  return jsonOk({
    organisationId: result.value.organisationId,
    notificationSent: result.value.emailSent,
  });
}
