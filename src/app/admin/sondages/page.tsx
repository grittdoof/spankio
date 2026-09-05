import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { loadAdminSession, canWriteSurveys } from '@/lib/admin/session';
import { publicEnv } from '@/lib/config/env';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { listSurveys, type SurveySummary } from '@/lib/services/surveys';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Formulaires' };

const NOTICES: Readonly<Record<string, string>> = {
  supprime: 'Formulaire supprimé. Les réponses restent en base jusqu’à la purge.',
};

const ERRORS: Readonly<Record<string, string>> = {
  identifiant: 'Ce formulaire est introuvable.',
  suppression: 'La suppression a été refusée.',
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

const STATUS_TONE: Readonly<Record<SurveySummary['status'], string>> = {
  draft: 'sp-badge',
  published: 'sp-badge sp-badge--success',
  closed: 'sp-badge sp-badge--warning',
};

/**
 * Liste des formulaires de l'organisation.
 *
 * Le RLS fait tout le filtrage : cette page ne mentionne jamais
 * `organisation_id`. Un compte d'une autre organisation ne verrait rien, et un
 * compte privé du module événement ne verrait pas les événements.
 */
export default async function SurveysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  const surveys = await listSurveys(context);
  if (!surveys.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  const writable = canWriteSurveys(session);
  const siteUrl = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const okCode = typeof params['ok'] === 'string' ? params['ok'] : undefined;
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <div className="sp-page-header">
        <div>
          <h1>Formulaires</h1>
          <p className="sp-muted">
            {surveys.value.length === 0
              ? 'Aucun formulaire pour l’instant.'
              : `${surveys.value.length} formulaire${surveys.value.length > 1 ? 's' : ''}.`}
          </p>
        </div>
        {writable ? (
          <Link className="sp-btn" href="/admin/sondages/nouveau">
            Nouveau formulaire
          </Link>
        ) : null}
      </div>

      {okCode && NOTICES[okCode] ? <Alert tone="success">{NOTICES[okCode]}</Alert> : null}
      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      {surveys.value.length === 0 ? (
        <div className="sp-card">
          <p className="sp-muted">
            {writable
              ? 'Créez un formulaire pour commencer : vierge, ou à partir d’un modèle.'
              : 'Votre rôle ne permet pas de créer un formulaire.'}
          </p>
        </div>
      ) : (
        <ul className="sp-survey-list">
          {surveys.value.map((survey) => (
            <li className="sp-card" key={survey.id}>
              <div className="sp-survey-row">
                <div>
                  <h2 className="sp-card__title">
                    <Link href={`/admin/sondages/${survey.id}`}>{survey.title}</Link>
                  </h2>
                  <p className="sp-meta">
                    <span className={STATUS_TONE[survey.status]}>
                      {fr.admin.surveyStatus[survey.status]}
                    </span>{' '}
                    <span className="sp-badge sp-badge--accent">
                      {fr.admin.surveyKind[survey.kind]}
                    </span>{' '}
                    <span className="sp-muted">
                      Modifié le {DATE_FORMAT.format(new Date(survey.updated_at))}
                    </span>
                  </p>
                  {survey.status === 'published' ? (
                    <p className="sp-muted" style={{ fontSize: '0.875rem' }}>
                      <a
                        href={`${siteUrl}/s/${session.organisationSlug}/${survey.slug}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {`${siteUrl}/s/${session.organisationSlug}/${survey.slug}`}
                      </a>
                    </p>
                  ) : null}
                </div>

                <div className="sp-actions">
                  <Link
                    className="sp-btn sp-btn--outline sp-btn--sm"
                    href={`/admin/sondages/${survey.id}`}
                  >
                    <span aria-hidden="true">Modifier</span>
                    <span className="sp-visually-hidden">Modifier {survey.title}</span>
                  </Link>
                  <Link
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    href={`/admin/sondages/${survey.id}/reponses`}
                  >
                    <span aria-hidden="true">Réponses</span>
                    <span className="sp-visually-hidden">Réponses de {survey.title}</span>
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
