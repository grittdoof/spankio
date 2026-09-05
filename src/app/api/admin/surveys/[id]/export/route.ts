import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { jsonError, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { csvFileName, responsesToCsv } from '@/lib/export/csv';
import { jsonFileName, responsesToJsonExport, serialiseJsonExport } from '@/lib/export/json';
import { eq } from '@/lib/data/port';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Export des réponses, en CSV ou en JSON.
 *
 * Le CSV est destiné à une personne dans un tableur : libellés, séparateur
 * point-virgule, marque d'ordre des octets, et neutralisation des formules.
 * Le JSON est destiné à un programme : valeurs techniques et schéma embarqué,
 * donc auto-descriptif.
 *
 * Les deux excluent les réponses supprimées et sont plafonnés : au-delà, il
 * faut une pagination, pas un fichier de plus en plus gros.
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
  const format = url.searchParams.get('format') ?? 'csv';
  if (format !== 'csv' && format !== 'json') {
    return jsonError('invalid_input', 'Format d’export inconnu : csv ou json.');
  }

  const survey = await getSurvey(guarded.context, parsedParams.value.id);
  if (!survey.ok) return mapDbError(survey.error, 'export.survey_failed');

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return mapDbError(schema.error, 'export.schema_failed');

  const responses = await listResponses(guarded.context, parsedParams.value.id, EXPORT_LIMIT);
  if (!responses.ok) return mapDbError(responses.error, 'export.responses_failed');

  const organisation = await guarded.context.port.selectOne<{ name: string }>({
    table: 'organisations',
    columns: 'name',
    where: [eq('id', survey.value.organisation_id)],
  });

  const now = new Date();
  const rows = responses.value.map((response) => ({
    submitted_at: response.submitted_at,
    consent_given: response.consent_given,
    consent_text: response.consent_text,
    data: response.data,
  }));

  if (format === 'json') {
    const body = serialiseJsonExport(
      responsesToJsonExport(schema.value, rows, {
        organisationName: organisation.data?.name ?? '',
        surveyTitle: survey.value.title,
        surveySlug: survey.value.slug,
        exportedAt: now.toISOString(),
      }),
    );

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${jsonFileName(survey.value.slug, now)}"`,
        'cache-control': 'no-store',
      },
    });
  }

  return new Response(responsesToCsv(schema.value, rows), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFileName(survey.value.slug, now)}"`,
      'cache-control': 'no-store',
    },
  });
}
