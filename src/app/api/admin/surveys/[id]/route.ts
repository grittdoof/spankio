import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonError, jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import {
  deleteSurvey,
  getSurvey,
  updateSurvey,
  updateSurveySchema,
} from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

/** Corps de réponse commun : le sondage tel qu'il est en base. */
function surveyBody(survey: unknown) {
  return { survey };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const survey = await getSurvey(guarded.context, parsedParams.value.id);
  if (!survey.ok) return mapDbError(survey.error, 'surveys.read_failed');

  return jsonOk(surveyBody(survey.value));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  // Un schéma complet peut être volumineux : le plafond est plus large ici que
  // sur les autres routes d'administration, mais il existe.
  const body = await readJsonBody(request, 256 * 1024);
  if (!body.ok) return body.response;

  const parsed = parseWith(updateSurveySchema, body.value);
  if (!parsed.ok) return parsed.response;

  const updated = await updateSurvey(guarded.context, parsedParams.value.id, parsed.value);

  if (!updated.ok) {
    // Les problèmes de schéma ou de publication sont détaillés : l'éditeur doit
    // pouvoir dire CE QUI manque, pas seulement que ça a échoué.
    if (updated.issues) {
      const fields: Record<string, string> = {};
      for (const issue of updated.issues) {
        fields[issue.path || '_'] ??= issue.message;
      }
      return jsonError('invalid_input', updated.error.message, { fields });
    }
    return mapDbError(updated.error, 'surveys.update_failed');
  }

  return jsonOk(surveyBody(updated.value));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const deleted = await deleteSurvey(guarded.context, parsedParams.value.id);
  if (!deleted.ok) return mapDbError(deleted.error, 'surveys.delete_failed');

  return jsonOk({ id: deleted.value.id });
}
