import { z } from '@/lib/config/zod';
import { guard } from '@/lib/api/guard';
import { jsonError, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { csvFileName, responseRows, toCsv, type ArrivalExport } from '@/lib/export/csv';
import { readCheckins } from '@/lib/services/checkin';
import { jsonFileName, responsesToJsonExport, serialiseJsonExport } from '@/lib/export/json';
import { eq } from '@/lib/data/port';
import {
  ATTENDANCE_STATUS_LABELS,
  attendanceRows,
  isAttendanceConfigured,
} from '@/lib/survey/attendance';
import { validateSurveySettings } from '@/lib/survey/settings';
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
    id: response.id,
    submitted_at: response.submitted_at,
    consent_given: response.consent_given,
    consent_text: response.consent_text,
    data: response.data,
  }));

  /*
   * Les arrivées ne sont lues que si l'appelant peut les lire. Sans le module
   * « Accueil », le RLS rend une liste vide et l'export garde EXACTEMENT la
   * forme qu'il avait avant ce module — pas deux colonnes vides que personne
   * n'attendait dans un fichier qu'un traitement en aval relit peut-être.
   *
   * Dès qu'une arrivée existe, en revanche, elles sont là même pour les
   * réponses non pointées : des colonnes qui apparaîtraient réponse par
   * réponse casseraient ce traitement bien plus sûrement.
   */
  const checkins = await readCheckins(guarded.context, parsedParams.value.id);
  const arrivals =
    checkins.ok && checkins.value.length > 0
      ? new Map<string, ArrivalExport>(
          checkins.value.map((state) => [
            state.responseId,
            { arrivedAt: state.arrivedAt, peopleIn: state.peopleIn },
          ]),
        )
      : undefined;

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

  // Comptage des présents : les deux colonnes ouvrent le fichier quand
  // l'organisation a désigné la question de présence. Un listing d'accueil
  // sans effectif obligerait à recompter à la main.
  const settings = validateSurveySettings(survey.value.settings);
  const attendance = settings.ok ? (settings.settings.attendance ?? {}) : {};
  const counting = survey.value.kind === 'event' && isAttendanceConfigured(attendance);

  const csvRows = arrivals
    ? responseRows(schema.value, rows, { arrivals })
    : responseRows(schema.value, rows);
  if (counting) {
    const lines = attendanceRows(schema.value, attendance, rows);
    const header = csvRows[0] ?? [];
    const body = csvRows.slice(1);
    const withAttendance: string[][] = [['Présence', 'Personnes', ...header]];
    body.forEach((row, index) => {
      const line = lines[index];
      withAttendance.push([
        line ? ATTENDANCE_STATUS_LABELS[line.status] : '',
        // Un effectif indéterminé est DIT, pas remplacé par un chiffre sûr de
        // lui : la personne qui prépare l'accueil doit savoir quoi vérifier.
        line ? (line.ambiguous ? `${line.people} (à vérifier)` : String(line.people)) : '',
        ...row,
      ]);
    });
    return new Response(toCsv(withAttendance), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvFileName(survey.value.slug, now)}"`,
        'cache-control': 'no-store',
      },
    });
  }

  return new Response(toCsv(csvRows), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFileName(survey.value.slug, now)}"`,
      'cache-control': 'no-store',
    },
  });
}
