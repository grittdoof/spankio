import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { surveyStatistics } from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Statistiques d'un sondage.
 *
 * Les agrégats ne contiennent AUCUN contenu de réponse libre : un champ texte
 * n'y produit qu'un compteur. Un tableau de bord n'est pas un écran de lecture
 * de données personnelles.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const result = await surveyStatistics(guarded.context, parsedParams.value.id);
  if (!result.ok) return mapDbError(result.error, 'statistics.failed');

  return jsonOk({
    survey: {
      id: result.value.survey.id,
      title: result.value.survey.title,
      status: result.value.survey.status,
    },
    statistics: result.value.statistics,
  });
}
