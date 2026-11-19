import { z } from '@/lib/config/zod';
import { guard } from '@/lib/api/guard';
import { jsonError, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { arrivalFacts, arrivalReport, arrivalRows } from '@/lib/checkin/report';
import { arrivalSummary } from '@/lib/checkin/summary';
import { docxFileName, toDocx } from '@/lib/export/docx';
import { eventWhen } from '@/lib/event/display';
import { readCheckins } from '@/lib/services/checkin';
import { guestList } from '@/lib/survey/guests';
import { isAttendanceConfigured } from '@/lib/survey/attendance';
import { validateSurveySettings } from '@/lib/survey/settings';
import { eq } from '@/lib/data/port';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

/** Date d'édition écrite en toutes lettres, dans le fuseau de l'événement. */
function editedAt(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(now);
}

/**
 * La synthèse des arrivées en document Word.
 *
 * Le PDF, lui, ne passe pas par une route : il sort de la page imprimable
 * (`/admin/sondages/[id]/synthese`), qui montre exactement les cartes de
 * l'écran. Les deux partagent le même modèle (`arrivalSummary`) — un document
 * qui recomposerait les chiffres de son côté finirait par en annoncer d'autres
 * que l'écran dont il est censé être la copie.
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
  const format = url.searchParams.get('format') ?? 'docx';
  if (format !== 'docx') {
    return jsonError(
      'invalid_input',
      'Format d’export inconnu : docx. Le PDF s’obtient en imprimant la synthèse.',
    );
  }

  const survey = await getSurvey(guarded.context, parsedParams.value.id);
  if (!survey.ok) return mapDbError(survey.error, 'summary.survey_failed');

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return mapDbError(schema.error, 'summary.schema_failed');

  const responses = await listResponses(guarded.context, parsedParams.value.id, EXPORT_LIMIT);
  if (!responses.ok) return mapDbError(responses.error, 'summary.responses_failed');

  const checkins = await readCheckins(guarded.context, parsedParams.value.id);

  const organisation = await guarded.context.port.selectOne<{ name: string }>({
    table: 'organisations',
    columns: 'name',
    where: [eq('id', survey.value.organisation_id)],
  });

  const settings = validateSurveySettings(survey.value.settings);
  const attendance = settings.ok ? (settings.settings.attendance ?? {}) : {};
  const counting = survey.value.kind === 'event' && isAttendanceConfigured(attendance);
  const timeZone = survey.value.event_timezone;

  const list = guestList(schema.value, attendance, responses.value);
  const report = arrivalReport(
    arrivalRows(list.rows, checkins.ok ? checkins.value : []),
    timeZone,
  );
  const summary = arrivalSummary(report, arrivalFacts(report, timeZone), { counting });

  const now = new Date();
  const document = toDocx(
    summary,
    {
      title: survey.value.title,
      organisation: organisation.data?.name ?? null,
      when: eventWhen({
        startsAt: survey.value.event_starts_at,
        endsAt: survey.value.event_ends_at,
        allDay: survey.value.event_all_day,
        timeZone,
      }),
      editedAt: editedAt(now, timeZone),
    },
    { at: now },
  );

  return new Response(document, {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${docxFileName(survey.value.slug, now)}"`,
      'cache-control': 'no-store',
    },
  });
}
