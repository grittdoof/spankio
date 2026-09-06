import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import Link from 'next/link';
import { AttendancePanel } from '@/components/admin/AttendancePanel';
import { StatisticsPanel } from '@/components/admin/StatisticsPanel';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAdminSession } from '@/lib/admin/session';
import { publicEnv } from '@/lib/config/env';
import { resolveRequestContext } from '@/lib/data/context';
import { responseRows } from '@/lib/export/csv';
import { fr } from '@/lib/i18n/fr';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';
import {
  ATTENDANCE_STATUS_LABELS,
  attendanceRows,
  countAttendance,
  isAttendanceConfigured,
  type AttendanceStatus,
} from '@/lib/survey/attendance';
import { validateSurveySettings } from '@/lib/survey/settings';
import { computeStatistics } from '@/lib/survey/statistics';
import { deleteResponseAction } from '../../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Réponses' };

const idSchema = z.string().uuid();

const NOTICES: Readonly<Record<string, string>> = {
  supprimee: 'Réponse supprimée. Elle sort de tous les comptages et des exports.',
};

const ERRORS: Readonly<Record<string, string>> = {
  identifiant: 'Cette réponse est introuvable.',
  suppression: 'La suppression a été refusée.',
};

/** Nombre de réponses détaillées affichées. Au-delà, l'export prend le relais. */
const TABLE_LIMIT = 100;

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

/** Le statut est porté par un mot ET une couleur, jamais par la couleur seule. */
const STATUS_BADGE: Readonly<Record<AttendanceStatus, string>> = {
  attending: 'sp-badge sp-badge--success',
  declined: 'sp-badge',
  unknown: 'sp-badge sp-badge--warning',
};

/**
 * Horodatage lisible. C'est la SEULE cellule qui diffère de l'export : celui-ci
 * garde l'ISO 8601, non ambigu pour un tableur ou un programme, quand l'écran
 * s'adresse à une personne.
 */
function formatMoment(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
}

/**
 * Réponses d'un formulaire : agrégats, détail et exports.
 *
 * Le détail affiche de VRAIES réponses — c'est le sens même d'une liste
 * d'inscriptions — donc potentiellement des données personnelles. La page le
 * dit franchement plutôt que de le laisser découvrir.
 */
export default async function SurveyResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();
  const query = await searchParams;

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  // Une seule lecture sert aux agrégats ET au détail : deux requêtes
  // pourraient renvoyer des ensembles différents et afficher un total qui ne
  // correspond pas aux lignes montrées.
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
  const shown = responses.value.slice(0, TABLE_LIMIT);
  // `meta: 'screen'` : la date suffit à l'écran. Le consentement et son texte
  // restent dans l'export, où ils servent de preuve.
  const rows = responseRows(schema.value, shown, { meta: 'screen' });
  const perResponse = counting
    ? attendanceRows(schema.value, attendance, shown)
    : null;
  const header = rows[0] ?? [];
  const body = rows.slice(1);

  const siteUrl = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const publicUrl = `${siteUrl}/s/${session.organisationSlug}/${survey.value.slug}`;
  const okCode = typeof query['ok'] === 'string' ? query['ok'] : undefined;
  const errorCode = typeof query['erreur'] === 'string' ? query['erreur'] : undefined;

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <PageHeader
        title="Réponses"
        lead={`Suivez ce que les répondants ont envoyé à « ${survey.value.title} », et exportez-le quand vous voulez.`}
        crumbs={[
          { label: 'Formulaires', href: '/admin/sondages' },
          { label: survey.value.title, href: `/admin/sondages/${survey.value.id}` },
          { label: 'Réponses' },
        ]}
        actions={
          <>
            <a
              className="sp-btn sp-btn--outline"
              href={`/api/admin/surveys/${survey.value.id}/export?format=csv`}
            >
              Exporter en tableur
            </a>
            <a
              className="sp-btn sp-btn--ghost"
              href={`/api/admin/surveys/${survey.value.id}/export?format=json`}
            >
              Export JSON
            </a>
          </>
        }
      />

      {okCode && NOTICES[okCode] ? <Alert tone="success">{NOTICES[okCode]}</Alert> : null}
      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      {responses.value.length === 0 ? (
        <EmptyState
          title="Aucune réponse pour l’instant"
          lead={
            survey.value.status === 'published'
              ? 'Le formulaire est en ligne : partagez son adresse pour recevoir les premières réponses.'
              : 'Le formulaire n’est pas publié : il n’accepte donc aucune réponse. Publiez-le depuis l’éditeur.'
          }
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
        />
      ) : (
        <>
          {totals ? (
            <section className="sp-section">
              <h2 className="sp-section__title">Effectif attendu</h2>
              <p className="sp-section__lead">
                Le nombre de personnes, accompagnants compris — non le nombre de
                réponses.
              </p>
              <AttendancePanel totals={totals} />
            </section>
          ) : null}

          <section className="sp-section">
            <h2 className="sp-section__title">Statistiques</h2>
            <p className="sp-section__lead">
              Les champs libres n’y produisent qu’un compteur : un tableau de bord n’est
              pas un écran de lecture de données personnelles.
            </p>
            <StatisticsPanel statistics={statistics} />
          </section>

          <section className="sp-section sp-stack">
            <div>
              <h2 className="sp-section__title">Réponses</h2>
              <p className="sp-section__lead">
                Les réponses telles qu’elles ont été saisies. Elles peuvent contenir des
                données personnelles : ne les diffusez qu’aux destinataires annoncés.
                Le consentement et son texte figurent dans l’export.
              </p>
            </div>

        {responses.value.length > TABLE_LIMIT ? (
          <Alert tone="info">
            {responses.value.length} réponses au total ; les {TABLE_LIMIT} plus récentes sont
            affichées. L’export les contient toutes (jusqu’à {EXPORT_LIMIT}).
          </Alert>
        ) : null}

            <div className="sp-table-wrapper">
            <table className="sp-table sp-table--compact">
              <caption className="sp-visually-hidden">
                Réponses au formulaire {survey.value.title}
              </caption>
              <thead>
                <tr>
                  {perResponse ? (
                    <>
                      <th scope="col">Présence</th>
                      <th scope="col">Personnes</th>
                    </>
                  ) : null}
                  {header.map((cell, index) => (
                    <th key={`${cell}-${index}`} scope="col">
                      {cell}
                    </th>
                  ))}
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {body.map((row, index) => {
                  const response = shown[index];
                  const line = perResponse?.[index];
                  return (
                    <tr
                      className={line?.ambiguous ? 'sp-row--check' : undefined}
                      key={response?.id ?? index}
                    >
                      {line ? (
                        <>
                          <td>
                            <span className={STATUS_BADGE[line.status]}>
                              {ATTENDANCE_STATUS_LABELS[line.status]}
                            </span>
                          </td>
                          <td className="sp-people">
                            {line.people}
                            {line.ambiguous ? (
                              <>
                                {' '}
                                <span className="sp-badge sp-badge--warning">à vérifier</span>
                              </>
                            ) : null}
                          </td>
                        </>
                      ) : null}
                      {row.map((cell, cellIndex) => (
                        <td key={`${cellIndex}-${cell}`}>
                          {cellIndex === 0 && response ? formatMoment(response.submitted_at) : cell}
                        </td>
                      ))}
                      <td>
                        {response ? (
                          <form action={deleteResponseAction}>
                            <input name="surveyId" type="hidden" value={survey.value.id} />
                            <input name="responseId" type="hidden" value={response.id} />
                            <button
                              className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--danger-text"
                              type="submit"
                            >
                              <span aria-hidden="true">Supprimer</span>
                              <span className="sp-visually-hidden">
                                Supprimer la réponse du {formatMoment(response.submitted_at)}
                              </span>
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
