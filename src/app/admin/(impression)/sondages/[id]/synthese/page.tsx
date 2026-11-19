import { notFound, redirect } from 'next/navigation';
import { ArrivalSummaryDocument } from '@/components/admin/ArrivalSummaryDocument';
import { z } from '@/lib/config/zod';
import { loadAdminSession } from '@/lib/admin/session';
import { arrivalFacts, arrivalReport, arrivalRows } from '@/lib/checkin/report';
import { arrivalSummary } from '@/lib/checkin/summary';
import { resolveRequestContext } from '@/lib/data/context';
import { sparkline, TICK_ANGLE } from '@/lib/design/sparkline';
import { eventWhen } from '@/lib/event/display';
import { deskBrand, readCheckins } from '@/lib/services/checkin';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';
import { isAttendanceConfigured } from '@/lib/survey/attendance';
import { guestList } from '@/lib/survey/guests';
import { validateSurveySettings } from '@/lib/survey/settings';

/**
 * La synthèse de la soirée, mise en page pour le papier — donc pour le PDF.
 *
 * Les trois mêmes cartes qu'à l'écran, avec la même courbe et les mêmes
 * chiffres : c'est tout l'intérêt de passer par l'impression du navigateur
 * plutôt que par une bibliothèque de PDF, qui aurait redessiné la page et
 * fini par en montrer une autre. Le modèle (`arrivalSummary`) est partagé avec
 * le document Word, pour que les deux ne puissent pas diverger.
 *
 * Elle vit dans le groupe `(impression)`, donc sans la barre latérale : une
 * navigation masquée par une règle `@media print` resterait dans le document
 * et réapparaîtrait si la feuille de style n'arrivait pas.
 */

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

const PRINTED = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export default async function ArrivalSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session?.attached) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) notFound();

  const responses = await listResponses(context, parsedId.data, EXPORT_LIMIT);
  if (!responses.ok) notFound();

  const checkins = await readCheckins(context, parsedId.data);
  const settings = validateSurveySettings(survey.value.settings);
  const attendance = settings.ok ? (settings.settings.attendance ?? {}) : {};
  const counting = survey.value.kind === 'event' && isAttendanceConfigured(attendance);
  const timeZone = survey.value.event_timezone;

  // Le rapport se compose sur la liste ENTIÈRE, jamais sur une page affichée :
  // un agrégat calculé sur trente rangées visibles serait faux, et rien ne le
  // signalerait.
  const list = guestList(schema.value, attendance, responses.value);
  const report = arrivalReport(
    arrivalRows(list.rows, checkins.ok ? checkins.value : []),
    timeZone,
  );
  const summary = arrivalSummary(report, arrivalFacts(report, timeZone), { counting });
  const chart = sparkline(report.slices, { tickAngle: TICK_ANGLE });

  const brand = await deskBrand(context, survey.value.organisation_id);
  const when = eventWhen({
    startsAt: survey.value.event_starts_at,
    endsAt: survey.value.event_ends_at,
    allDay: survey.value.event_all_day,
    timeZone,
  });

  return (
    <ArrivalSummaryDocument
      backHref={`/admin/sondages/${survey.value.id}/reponses?vue=arrivees`}
      chart={chart}
      editedAt={PRINTED.format(new Date())}
      empty={report.arrived === 0}
      logoUrl={brand?.logoUrl ?? null}
      organisation={brand?.name ?? null}
      summary={summary}
      title={survey.value.title}
      when={when}
    />
  );
}
