import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { canWriteSurveys, loadAdminSession } from '@/lib/admin/session';
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
  dateStyle: 'long',
  timeZone: 'Europe/Paris',
});

const STATUS_TONE: Readonly<Record<SurveySummary['status'], string>> = {
  draft: 'sp-badge',
  published: 'sp-badge sp-badge--success',
  closed: 'sp-badge sp-badge--warning',
};

/** Ce que l'utilisateur doit faire ensuite, selon l'état du formulaire. */
const NEXT_STEP: Readonly<Record<SurveySummary['status'], string>> = {
  draft: 'À terminer puis publier',
  published: 'En ligne : partagez l’adresse',
  closed: 'Fermé : les réponses restent consultables',
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
    <div className="sp-rise">
      <PageHeader
        title="Formulaires"
        lead="Chaque formulaire a sa propre adresse publique, ses réponses et ses exports."
        actions={
          writable ? (
            <Link className="sp-btn" href="/admin/sondages/nouveau">
              Créer un formulaire
            </Link>
          ) : null
        }
      />

      {okCode && NOTICES[okCode] ? <Alert tone="success">{NOTICES[okCode]}</Alert> : null}
      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      {surveys.value.length === 0 ? (
        <EmptyState
          title="Aucun formulaire pour l’instant"
          lead={
            writable
              ? 'Un parcours guidé vous accompagne : titre, type, informations aux répondants. Vous pourrez tout modifier ensuite.'
              : 'Votre rôle est en lecture seule. Demandez le rôle d’éditeur à un administrateur de votre organisation.'
          }
          action={
            writable ? (
              <Link className="sp-btn sp-btn--lg" href="/admin/sondages/nouveau">
                Créer mon premier formulaire
              </Link>
            ) : null
          }
        />
      ) : (
        <ul className="sp-survey-list">
          {surveys.value.map((survey) => {
            const publicUrl = `${siteUrl}/s/${session.organisationSlug}/${survey.slug}`;
            return (
              <li className="sp-card sp-card--link" key={survey.id}>
                <div className="sp-survey-row">
                  <div className="sp-survey-row__main">
                    <h2 className="sp-card__title">
                      <Link href={`/admin/sondages/${survey.id}`}>{survey.title}</Link>
                    </h2>
                    <p className="sp-survey-row__badges">
                      <span className={STATUS_TONE[survey.status]}>
                        {fr.admin.surveyStatus[survey.status]}
                      </span>
                      <span className="sp-badge sp-badge--accent">
                        {fr.admin.surveyKind[survey.kind]}
                      </span>
                    </p>
                    <p className="sp-survey-row__hint">
                      {NEXT_STEP[survey.status]} · modifié le{' '}
                      {DATE_FORMAT.format(new Date(survey.updated_at))}
                    </p>
                    {survey.status === 'published' ? (
                      <p className="sp-survey-row__url">
                        <a href={publicUrl} rel="noreferrer" target="_blank">
                          {publicUrl}
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
