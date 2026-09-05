import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { softDeleteResponse } from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Suppression d'une réponse.
 *
 * C'est une suppression LOGIQUE : la ligne sort immédiatement des listes et
 * des agrégats, et la purge définitive intervient après le délai de grâce.
 * Un effacement immédiat et irréversible d'un clic serait une mauvaise idée
 * sur une donnée que l'on peut avoir supprimée par erreur — l'effacement
 * définitif existe, mais il passe par la procédure tracée d'effacement.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const deleted = await softDeleteResponse(guarded.context, parsedParams.value.id);
  if (!deleted.ok) return mapDbError(deleted.error, 'responses.delete_failed');

  return jsonOk({ id: deleted.value.id });
}
