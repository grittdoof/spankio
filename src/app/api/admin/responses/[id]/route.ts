import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody, SUBMISSION_MAX_BODY_BYTES } from '@/lib/api/read-json';
import { jsonError, jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { correctResponse, softDeleteResponse } from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z.object({
  surveyId: z.string().uuid(),
  /** Réponses corrigées. La validation fine se fait contre le schéma. */
  data: z.unknown(),
});

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

/**
 * Correction d'une réponse.
 *
 * L'immuabilité n'est pas relâchée : la réponse d'origine passe en suppression
 * logique et une copie corrigée la remplace, avec le même consentement, la même
 * date de soumission et un lien vers l'originale. Le droit de rectification est
 * ainsi exerçable sans que la preuve cesse de prouver ce qu'elle prouve.
 *
 * Les erreurs de champ sont renvoyées telles quelles : elles portent sur ce que
 * l'éditeur a saisi, il doit pouvoir corriger.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  // `readJsonBody` plafonne la taille AVANT toute analyse, et renvoie une
  // valeur `unknown` : `request.json()` seul rendrait un `any`.
  const body = await readJsonBody(request, SUBMISSION_MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = parseWith(bodySchema, body.value);
  if (!parsed.ok) return parsed.response;

  const corrected = await correctResponse(guarded.context, {
    responseId: parsedParams.value.id,
    surveyId: parsed.value.surveyId,
    data: parsed.value.data,
  });

  if (!corrected.ok) {
    if (corrected.fields) {
      const fields: Record<string, string> = {};
      for (const error of corrected.fields) {
        fields[error.field] ??= error.code;
      }
      return jsonError('invalid_input', undefined, { fields });
    }
    return mapDbError(corrected.error, 'responses.correct_failed');
  }

  return jsonOk({ id: corrected.value.id });
}
