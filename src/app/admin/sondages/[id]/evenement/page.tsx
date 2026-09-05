import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { Alert } from '@/components/ui/Alert';
import type { EventDraft } from '@/components/admin/EventSettings';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { getSurvey } from '@/lib/services/surveys';
import { EventSettingsClient } from './EventSettingsClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Réglages de l’événement' };

const idSchema = z.string().uuid();

/**
 * Réglages de l'événement d'un formulaire.
 *
 * Réservée aux formulaires de type `event` : proposer ces réglages sur un
 * sondage ordinaire laisserait croire qu'ils auront un effet, alors que rien
 * ne les afficherait. Le type se fixe à la création — il détermine le module,
 * donc les droits.
 */
export default async function EventSettingsPage({
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
  if (!session.attached || !session.organisationId) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  if (survey.value.kind !== 'event') {
    return (
      <div className="sp-stack">
        <h1>{survey.value.title}</h1>
        <Alert tone="info">
          Ce formulaire est un sondage, pas un événement : il n’a ni date, ni lieu, ni
          bannière. Le type se choisit à la création.
        </Alert>
        <p>
          <Link className="sp-btn sp-btn--outline sp-btn--sm" href={`/admin/sondages/${survey.value.id}`}>
            Revenir aux questions
          </Link>
        </p>
      </div>
    );
  }

  const initial: EventDraft = {
    bannerPath: survey.value.banner_path,
    eventStartsAt: survey.value.event_starts_at,
    eventEndsAt: survey.value.event_ends_at,
    eventAllDay: survey.value.event_all_day,
    eventTimezone: survey.value.event_timezone,
    eventLocationLabel: survey.value.event_location_label,
    eventAddress: survey.value.event_address,
    eventLat: survey.value.event_lat,
    eventLng: survey.value.event_lng,
    eventOrganiser: survey.value.event_organiser,
    eventDetails: survey.value.event_details,
  };

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <div className="sp-page-header">
        <div>
          <p className="sp-meta">
            <Link href="/admin/sondages">Formulaires</Link>
            {' · '}
            <Link href={`/admin/sondages/${survey.value.id}`}>{survey.value.title}</Link>
          </p>
          <h1>Réglages de l’événement</h1>
          <p className="sp-muted">
            Ces informations alimentent la page publique, le fichier d’agenda et
            l’itinéraire proposé aux répondants.
          </p>
        </div>
      </div>

      <EventSettingsClient
        organisationId={session.organisationId}
        surveyId={survey.value.id}
        initial={initial}
      />
    </div>
  );
}
