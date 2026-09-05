import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { getSurvey, listResponses } from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Réponses d'un sondage.
 *
 * Le RLS impose déjà l'organisation ET le module : un compte privé du module
 * événement ne voit pas les réponses d'un sondage événement, même de sa propre
 * organisation. La liste exclut les suppressions logiques.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limite') ?? 100) || 100, 500);

  // Le sondage est lu d'abord : sans lui, une réponse vide ne dirait pas si le
  // sondage n'existe pas ou s'il n'a simplement aucune réponse.
  const survey = await getSurvey(guarded.context, parsedParams.value.id);
  if (!survey.ok) return mapDbError(survey.error, 'responses.survey_failed');

  const responses = await listResponses(guarded.context, parsedParams.value.id, limit);
  if (!responses.ok) return mapDbError(responses.error, 'responses.list_failed');

  return jsonOk({
    survey: { id: survey.value.id, title: survey.value.title, schema: survey.value.schema },
    responses: responses.value,
  });
}
