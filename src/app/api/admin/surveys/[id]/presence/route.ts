import { z } from '@/lib/config/zod';
import { guard } from '@/lib/api/guard';
import { jsonError, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { csvFileName, toCsv } from '@/lib/export/csv';
import { presenceList, presenceRows, PRESENCE_SUFFIX } from '@/lib/export/presence';
import { toXlsx, xlsxFileName } from '@/lib/export/xlsx';
import { readCheckins } from '@/lib/services/checkin';
import { guestList } from '@/lib/survey/guests';
import { isAttendanceConfigured } from '@/lib/survey/attendance';
import { validateSurveySettings } from '@/lib/survey/settings';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * La feuille de présence : qui est venu, qui ne l'est pas.
 *
 * Deux formats, un seul contenu — `presenceRows` compose les lignes, le CSV
 * les échappe et le classeur les écrit telles quelles. Deux compositions
 * auraient fini par diverger, et le tableur aurait dit autre chose que le
 * fichier texte ouvert à côté.
 *
 * Pourquoi une route à part de `/export`, qui emporte déjà deux colonnes
 * d'arrivée : ce n'est pas la même lecture. L'export des réponses donne une
 * ligne par INSCRIPTION avec toutes ses colonnes, et il sert de pièce ; la
 * feuille de présence donne une ligne par PERSONNE avec un seul mot en face,
 * et elle sert à pointer ce qui s'est passé. Les mêler aurait obligé l'un des
 * deux à changer de forme.
 *
 * Le PDF ne passe pas par ici : il est produit par la feuille imprimable
 * (`/admin/sondages/[id]/presence`), qui porte le logo de l'organisation et
 * le récapitulatif de la soirée. Fabriquer un PDF côté serveur aurait demandé
 * une dépendance de plus pour un résultat moins bon que ce que le navigateur
 * sait déjà faire d'une page mise en forme pour l'impression.
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
  const format = url.searchParams.get('format') ?? 'xlsx';
  if (format !== 'csv' && format !== 'xlsx') {
    return jsonError('invalid_input', 'Format d’export inconnu : csv ou xlsx.');
  }

  const survey = await getSurvey(guarded.context, parsedParams.value.id);
  if (!survey.ok) return mapDbError(survey.error, 'presence.survey_failed');

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return mapDbError(schema.error, 'presence.schema_failed');

  const responses = await listResponses(guarded.context, parsedParams.value.id, EXPORT_LIMIT);
  if (!responses.ok) return mapDbError(responses.error, 'presence.responses_failed');

  // Les arrivées sont lues sous RLS comme le reste : sans le module, la liste
  // revient vide et la feuille dit « non venu » partout — ce qui est exact.
  const checkins = await readCheckins(guarded.context, parsedParams.value.id);

  const settings = validateSurveySettings(survey.value.settings);
  const attendance = settings.ok ? (settings.settings.attendance ?? {}) : {};
  const counting = survey.value.kind === 'event' && isAttendanceConfigured(attendance);

  const list = guestList(schema.value, attendance, responses.value);
  const presence = presenceList(list.rows, checkins.ok ? checkins.value : []);
  const rows = presenceRows(presence, {
    counting,
    timeZone: survey.value.event_timezone,
  });

  const now = new Date();

  if (format === 'csv') {
    return new Response(toCsv(rows), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvFileName(
          `${survey.value.slug}${PRESENCE_SUFFIX}`,
          now,
        )}"`,
        'cache-control': 'no-store',
      },
    });
  }

  const book = toXlsx(rows, { sheetName: 'Présence', at: now });

  return new Response(book, {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${xlsxFileName(
        survey.value.slug,
        now,
        PRESENCE_SUFFIX,
      )}"`,
      'cache-control': 'no-store',
    },
  });
}
