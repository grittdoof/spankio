import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { Alert } from '@/components/ui/Alert';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAdminSession } from '@/lib/admin/session';
import { publicEnv } from '@/lib/config/env';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { getSurvey } from '@/lib/services/surveys';
import { validateSurveySettings } from '@/lib/survey/settings';
import { InvitationSettingsClient } from './InvitationSettingsClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Page publique' };

const idSchema = z.string().uuid();

/**
 * Ce que voit l'invité : l'invitation publique, bloc par bloc.
 *
 * Écran distinct des « réglages de l'événement », qui établissent des faits —
 * dates, lieu, comptage. Ici on décide de la PRÉSENTATION : quels blocs
 * s'affichent, et ce qu'ils racontent. Deux tâches, deux écrans ; réunies,
 * elles donnaient une page où l'on ne trouvait plus rien.
 *
 * Réservée aux formulaires de type `event` : les blocs proposés parlent de
 * déroulé, d'accès et de compte à rebours. Les offrir à un sondage ordinaire
 * laisserait croire à un effet qui n'existerait pas.
 */
export default async function InvitationSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  if (survey.value.kind !== 'event') {
    return (
      <div className="sp-stack">
        <h1>{survey.value.title}</h1>
        <Alert tone="info">
          Ce formulaire est un sondage, pas un événement : sa page publique n’a ni
          déroulé, ni compte à rebours, ni itinéraire. Le type se choisit à la
          création.
        </Alert>
        <p>
          <Link
            className="sp-btn sp-btn--outline sp-btn--sm"
            href={`/admin/sondages/${survey.value.id}`}
          >
            Revenir aux questions
          </Link>
        </p>
      </div>
    );
  }

  const settings = validateSurveySettings(survey.value.settings);
  if (!settings.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  const site = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <PageHeader
        crumbs={[
          { label: 'Formulaires', href: '/admin/sondages' },
          { label: survey.value.title, href: `/admin/sondages/${survey.value.id}` },
          { label: 'Page publique' },
        ]}
        lead="Choisissez ce que vos invités voient, et ce que la page leur raconte. Chaque bloc s’ouvre ou se ferme sans rien perdre."
        title="Page publique"
      />

      <InvitationSettingsClient
        published={survey.value.status === 'published'}
        publicUrl={`${site}/s/${session.organisationSlug}/${survey.value.slug}`}
        settings={settings.settings}
        surveyId={survey.value.id}
      />
    </div>
  );
}
