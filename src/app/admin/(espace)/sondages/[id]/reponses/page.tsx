import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import Link from 'next/link';
import { EventOverview, type PartySummary } from '@/components/admin/EventOverview';
import { GuestList } from '@/components/admin/GuestList';
import { StatisticsPanel } from '@/components/admin/StatisticsPanel';
import { StatisticsTabs } from '@/components/admin/StatisticsTabs';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAdminSession } from '@/lib/admin/session';
import {
  parseStatisticsView,
  statisticsUrl,
  STATISTICS_TAB_LABELS,
} from '@/lib/admin/statistics-view';
import { publicEnv } from '@/lib/config/env';
import { resolveRequestContext } from '@/lib/data/context';
import { countdown } from '@/lib/event/countdown';
import { fr } from '@/lib/i18n/fr';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';
import {
  countAttendance,
  fieldById,
  isAttendanceConfigured,
} from '@/lib/survey/attendance';
import { guestList } from '@/lib/survey/guests';
import { eventInsights } from '@/lib/survey/insights';
import { recentResponses, responsePace } from '@/lib/survey/pace';
import { validateSurveySettings } from '@/lib/survey/settings';
import { computeStatistics } from '@/lib/survey/statistics';
import { deleteResponseAction } from '../../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Statistiques' };

const idSchema = z.string().uuid();

const NOTICES: Readonly<Record<string, string>> = {
  supprimee: 'Réponse supprimée. Elle sort de tous les comptages et des exports.',
};

const ERRORS: Readonly<Record<string, string>> = {
  identifiant: 'Cette réponse est introuvable.',
  suppression: 'La suppression a été refusée.',
};

/** Fenêtre du delta affiché à côté de l'effectif. */
const DELTA_DAYS = 7;

/**
 * Statistiques d'un formulaire, en trois vues.
 *
 * Pourquoi trois vues plutôt qu'une page qui empile tout : ce sont trois
 * questions différentes, posées à des moments différents. « Combien serons-nous
 * ? » se lit en un coup d'œil la veille ; « qu'ont répondu les gens ? » se lit
 * une fois, quand on dépouille ; « untel a-t-il confirmé ? » se lit debout, à
 * l'accueil, sur un téléphone. Les empiler obligeait à faire défiler un écran
 * de plusieurs milliers de pixels pour atteindre la troisième.
 *
 * L'état des vues vit dans l'URL (`src/lib/admin/statistics-view.ts`) : chaque
 * vue se partage, se recharge, et — parce que les onglets sont des liens et la
 * recherche un `<form method="get">` — l'écran entier fonctionne sans
 * JavaScript.
 *
 * La liste des invités affiche de VRAIES réponses — c'est le sens même d'une
 * liste d'accueil — donc potentiellement des données personnelles. L'écran le
 * dit franchement plutôt que de le laisser découvrir.
 */
export default async function SurveyStatisticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();
  const query = await searchParams;
  const view = parseStatisticsView(query);

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  // Une seule lecture sert aux agrégats, au rythme ET à la liste : deux
  // requêtes pourraient renvoyer des ensembles différents et afficher un total
  // qui ne correspond pas aux lignes montrées.
  const responses = await listResponses(context, parsedId.data, EXPORT_LIMIT);
  if (!responses.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  const statistics = computeStatistics(schema.value, responses.value);

  // Comptage des présents : uniquement si l'organisation a désigné la question
  // qui dit « je viens ». Sans cela on compte des réponses, ce qui est exact
  // mais ne donne pas d'effectif.
  const settings = validateSurveySettings(survey.value.settings);
  const attendance = settings.ok ? (settings.settings.attendance ?? {}) : {};
  const counting = survey.value.kind === 'event' && isAttendanceConfigured(attendance);
  const totals = counting
    ? countAttendance(schema.value, attendance, responses.value)
    : null;

  // `new Date()` une seule fois, passé ensuite en paramètre : deux horloges
  // lues à quelques millisecondes d'écart peuvent tomber de part et d'autre de
  // minuit, et le compte à rebours contredirait alors le graphique.
  const now = new Date();
  const timeZone = survey.value.event_timezone;
  const clock =
    survey.value.kind === 'event'
      ? countdown(survey.value.event_starts_at, { now, timeZone })
      : null;

  const pace = responsePace(responses.value, { now, window: view.period, timeZone });
  const recent = recentResponses(responses.value, { now, days: DELTA_DAYS, timeZone });
  const delta = {
    responses: recent.length,
    people: counting ? countAttendance(schema.value, attendance, recent).people : 0,
  };

  const capacity = attendance.capacity ?? null;
  const insights = eventInsights({
    totals,
    responseCount: responses.value.length,
    capacity,
    pace,
    countdown: clock,
  });

  // Accompagnants annoncés : l'écart entre les personnes attendues et les
  // réponses qui les annoncent. `null` tant qu'aucune question ne donne de
  // nombre — l'écart serait alors toujours zéro, ce qui ferait croire à une
  // information.
  const partyField = fieldById(schema.value, attendance.partyField);
  const companions =
    totals && partyField ? Math.max(0, totals.people - totals.attending) : null;

  const partyStats = partyField
    ? statistics.fields.find((field) => field.fieldId === partyField.id)
    : undefined;
  const party: PartySummary | null =
    partyStats && partyStats.type === 'number'
      ? {
          label: partyStats.label,
          average: partyStats.average,
          unit: partyField && partyField.type === 'number' ? partyField.unit ?? null : null,
          distribution: partyStats.distribution,
        }
      : null;

  const list = guestList(schema.value, attendance, responses.value, {
    filter: view.filter,
    search: view.search,
  });
  const rows = list.rows.slice(0, view.shown);

  const siteUrl = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const publicUrl = `${siteUrl}/s/${session.organisationSlug}/${survey.value.slug}`;
  const okCode = typeof query['ok'] === 'string' ? query['ok'] : undefined;
  const errorCode = typeof query['erreur'] === 'string' ? query['erreur'] : undefined;

  const settingsHref = `/admin/sondages/${survey.value.id}/evenement`;
  const exportCsvHref = `/api/admin/surveys/${survey.value.id}/export?format=csv`;
  const exportJsonHref = `/api/admin/surveys/${survey.value.id}/export?format=json`;

  const when = eventWhen(survey.value.event_starts_at, timeZone, survey.value.event_all_day);

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-5)' } as React.CSSProperties}>
      <PageHeader
        actions={
          <>
            <a className="sp-btn sp-btn--outline" href={exportCsvHref}>
              Exporter en tableur
            </a>
            <a className="sp-btn sp-btn--ghost" href={exportJsonHref}>
              Export JSON
            </a>
          </>
        }
        crumbs={[
          { label: 'Formulaires', href: '/admin/sondages' },
          { label: survey.value.title, href: `/admin/sondages/${survey.value.id}` },
          { label: 'Statistiques' },
        ]}
        lead={`Ce que les répondants ont envoyé à « ${survey.value.title} », et de quoi le sortir quand vous voulez.`}
        meta={
          when || survey.value.event_location_label || clock ? (
            <>
              {when ? <span className="sp-tag">{when}</span> : null}
              {survey.value.event_location_label ? (
                <span className="sp-tag">{survey.value.event_location_label}</span>
              ) : null}
              {clock ? (
                <span className={`sp-tag${clock.past ? '' : ' sp-tag--accent'}`}>
                  <span aria-hidden="true">{clock.badge}</span>
                  <span className="sp-visually-hidden">{clock.label}</span>
                </span>
              ) : null}
            </>
          ) : null
        }
        title="Statistiques"
      />

      {okCode && NOTICES[okCode] ? <Alert tone="success">{NOTICES[okCode]}</Alert> : null}
      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      {responses.value.length === 0 ? (
        <EmptyState
          action={
            survey.value.status === 'published' ? (
              <p className="sp-empty__url">
                <a href={publicUrl} rel="noreferrer" target="_blank">
                  {publicUrl}
                </a>
              </p>
            ) : (
              <Link className="sp-btn" href={`/admin/sondages/${survey.value.id}`}>
                Ouvrir l’éditeur
              </Link>
            )
          }
          lead={
            survey.value.status === 'published'
              ? 'Le formulaire est en ligne : partagez son adresse pour recevoir les premières réponses.'
              : 'Le formulaire n’est pas publié : il n’accepte donc aucune réponse. Publiez-le depuis l’éditeur.'
          }
          title="Aucune réponse pour l’instant"
        />
      ) : (
        <>
          <StatisticsTabs current={view.tab} surveyId={survey.value.id} view={view} />

          {/* Le titre de la vue n'est pas répété : l'onglet actif le porte, et
              `aria-current` l'annonce. Un `h2` identique au libellé de l'onglet
              se lirait deux fois de suite. */}
          <div aria-label={STATISTICS_TAB_LABELS[view.tab]} role="region">
            {view.tab === 'apercu' ? (
              <EventOverview
                capacity={capacity}
                companions={companions}
                delta={delta}
                insights={insights}
                pace={pace}
                party={party}
                responseCount={responses.value.length}
                settingsHref={settingsHref}
                surveyId={survey.value.id}
                totals={totals}
              />
            ) : null}

            {view.tab === 'questions' ? (
              <StatisticsPanel
                guestsHref={statisticsUrl(survey.value.id, { tab: 'invites' })}
                statistics={statistics}
              />
            ) : null}

            {view.tab === 'invites' ? (
              <div
                className="sp-stack"
                style={{ '--sp-stack-gap': 'var(--sp-space-4)' } as React.CSSProperties}
              >
                <p className="sp-hint">
                  Ces lignes contiennent les réponses telles qu’elles ont été saisies,
                  donc possiblement des données personnelles : ne les diffusez qu’aux
                  destinataires annoncés dans vos mentions d’information. Le
                  consentement et son texte figurent dans l’export.
                </p>
                <GuestList
                  counting={counting}
                  deleteAction={deleteResponseAction}
                  list={list}
                  named={Boolean(fieldById(schema.value, attendance.identityField))}
                  rows={rows}
                  settingsHref={settingsHref}
                  surveyId={survey.value.id}
                  view={view}
                />
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Date de l'événement, dans le fuseau DE L'ÉVÉNEMENT.
 *
 * Pas dans celui du serveur ni du navigateur : « 19 h » veut dire 19 h sur
 * place, et c'est cette heure-là qu'un organisateur compare à son propre
 * agenda. Un formateur par appel plutôt qu'une constante, le fuseau variant
 * d'un sondage à l'autre.
 */
function eventWhen(
  startsAt: string | null,
  timeZone: string,
  allDay: boolean,
): string | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'long',
      ...(allDay ? {} : { timeStyle: 'short' }),
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
}
