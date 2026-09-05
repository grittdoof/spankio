import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { StatisticsPanel } from '@/components/admin/StatisticsPanel';
import { Alert } from '@/components/ui/Alert';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { responseRows } from '@/lib/export/csv';
import { fr } from '@/lib/i18n/fr';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';
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
  const shown = responses.value.slice(0, TABLE_LIMIT);
  const rows = responseRows(schema.value, shown);
  const header = rows[0] ?? [];
  const body = rows.slice(1);

  const okCode = typeof query['ok'] === 'string' ? query['ok'] : undefined;
  const errorCode = typeof query['erreur'] === 'string' ? query['erreur'] : undefined;

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <div className="sp-page-header">
        <div>
          <p className="sp-meta">
            <Link href="/admin/sondages">Formulaires</Link>
            {' · '}
            <Link href={`/admin/sondages/${survey.value.id}`}>{survey.value.title}</Link>
          </p>
          <h1>Réponses</h1>
        </div>
        <div className="sp-actions">
          <a
            className="sp-btn sp-btn--outline sp-btn--sm"
            href={`/api/admin/surveys/${survey.value.id}/export?format=csv`}
          >
            Exporter en CSV
          </a>
          <a
            className="sp-btn sp-btn--ghost sp-btn--sm"
            href={`/api/admin/surveys/${survey.value.id}/export?format=json`}
          >
            Exporter en JSON
          </a>
        </div>
      </div>

      {okCode && NOTICES[okCode] ? <Alert tone="success">{NOTICES[okCode]}</Alert> : null}
      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      <section>
        <h2>Statistiques</h2>
        <StatisticsPanel statistics={statistics} />
      </section>

      <section className="sp-stack">
        <div className="sp-card__header">
          <h2>Détail des réponses</h2>
          <p className="sp-muted">
            Ce tableau montre les réponses telles qu’elles ont été saisies. Elles peuvent
            contenir des données personnelles : ne les diffusez qu’aux destinataires annoncés
            aux répondants.
          </p>
        </div>

        {responses.value.length > TABLE_LIMIT ? (
          <Alert tone="info">
            {responses.value.length} réponses au total ; les {TABLE_LIMIT} plus récentes sont
            affichées. L’export les contient toutes (jusqu’à {EXPORT_LIMIT}).
          </Alert>
        ) : null}

        {body.length === 0 ? (
          <div className="sp-card">
            <p className="sp-muted">Aucune réponse pour l’instant.</p>
          </div>
        ) : (
          <div className="sp-table-wrapper">
            <table className="sp-table">
              <caption className="sp-visually-hidden">
                Réponses au formulaire {survey.value.title}
              </caption>
              <thead>
                <tr>
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
                  return (
                    <tr key={response?.id ?? index}>
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
        )}
      </section>
    </div>
  );
}
