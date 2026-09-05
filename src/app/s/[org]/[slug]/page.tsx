import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClosedScreen } from '@/components/public/screens';
import { publicEnv } from '@/lib/config/env';
import { bannerPublicUrl } from '@/lib/event/banner';
import { resolveRequestContext } from '@/lib/data/context';
import { calendarLinks, directionsLinks } from '@/lib/event/calendar-links';
import { fr } from '@/lib/i18n/fr';
import { loadPublicSurvey, type PublicSurvey } from '@/lib/services/submission';
import { composeConsentNotice, consentCheckboxLabel } from '@/lib/survey/consent';
import { PublicSurveyClient } from './PublicSurveyClient';

/**
 * Page publique d'un formulaire.
 *
 * Elle lit la vue `public_surveys` — seul accès anonyme aux sondages — donc un
 * brouillon, un sondage fermé ou celui d'une organisation désactivée renvoie
 * naturellement 404, sans qu'aucune condition ne soit écrite ici.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ org: string; slug: string }>;
}

async function load(params: PageProps['params']): Promise<PublicSurvey> {
  const { org, slug } = await params;
  const context = await resolveRequestContext();
  const result = await loadPublicSurvey(context, org, slug);
  if (!result.ok) notFound();
  return result.value;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { org, slug } = await params;
  const context = await resolveRequestContext();
  const result = await loadPublicSurvey(context, org, slug);
  if (!result.ok) return { title: fr.platform.name };

  return {
    title: `${result.value.title} — ${result.value.organisationName}`,
    ...(result.value.description ? { description: result.value.description } : {}),
    // Un formulaire ouvert est public : il peut être indexé, contrairement au
    // reste de la plateforme.
    robots: { index: true, follow: true },
  };
}

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' });

function eventMeta(survey: PublicSurvey): string[] {
  const meta: string[] = [];
  if (survey.event.startsAt) {
    const start = new Date(survey.event.startsAt);
    meta.push(survey.event.allDay ? DAY_FORMAT.format(start) : DATE_FORMAT.format(start));
  }
  if (survey.event.locationLabel) meta.push(survey.event.locationLabel);
  if (survey.event.address) meta.push(survey.event.address);
  if (survey.event.organiser) meta.push(`Organisé par ${survey.event.organiser}`);
  return meta;
}

function bannerUrl(survey: PublicSurvey): string | null {
  if (!survey.bannerPath) return null;
  // Une seule composition d'URL de bannière, partagée avec l'espace
  // d'administration : deux versions finiraient par diverger d'un segment.
  return bannerPublicUrl(publicEnv().NEXT_PUBLIC_SUPABASE_URL, survey.bannerPath);
}

export default async function PublicSurveyPage({ params }: PageProps) {
  const survey = await load(params);

  if (survey.isFull) {
    return (
      <main id="contenu" className="sp-container" style={{ paddingBlock: '4rem' }}>
        <ClosedScreen reason={fr.survey.full} />
      </main>
    );
  }

  const notice = composeConsentNotice({
    organisationName: survey.organisationName,
    purpose: survey.purpose,
    legalBasis: survey.legalBasis,
    retentionDays: survey.retentionDays,
    recipients: survey.recipients,
    customText: survey.settings.consentText ?? null,
  });

  const isEvent = survey.kind === 'event' && survey.event.startsAt !== null;
  const start = survey.event.startsAt ? new Date(survey.event.startsAt) : null;

  const event =
    isEvent && start
      ? {
          calendar: calendarLinks(
            {
              title: survey.title,
              start,
              end: survey.event.endsAt ? new Date(survey.event.endsAt) : null,
              allDay: survey.event.allDay,
              description: survey.event.details,
              location: survey.event.address ?? survey.event.locationLabel,
            },
            `/api/ics/${survey.id}`,
          ),
          directions:
            directionsLinks({
              latitude: survey.event.latitude,
              longitude: survey.event.longitude,
              address: survey.event.address,
              label: survey.event.locationLabel,
            }) ?? undefined,
          summary: eventMeta(survey),
        }
      : undefined;

  return (
    <main id="contenu">
      <PublicSurveyClient
        organisationSlug={survey.organisationSlug}
        surveySlug={survey.slug}
        schema={survey.schema}
        branding={{
          organisationName: survey.organisationName,
          logoUrl: survey.organisationLogoUrl,
          bannerUrl: bannerUrl(survey),
        }}
        welcome={{
          badge: survey.settings.welcome?.badge ?? (isEvent ? 'Inscription' : undefined),
          title: survey.settings.welcome?.title ?? survey.title,
          description: survey.settings.welcome?.description ?? survey.description ?? undefined,
          meta: isEvent ? eventMeta(survey) : [],
          ctaLabel: survey.settings.welcome?.ctaLabel ?? fr.survey.start,
        }}
        consent={{
          required: survey.requireConsent,
          notice,
          checkboxLabel: consentCheckboxLabel(survey.legalBasis),
          privacyHref: '/confidentialite',
        }}
        thankYou={{
          title: survey.settings.thankYou?.title ?? fr.survey.thankYouTitle,
          message: survey.settings.thankYou?.message ?? fr.survey.thankYouMessage,
        }}
        event={event}
      />
    </main>
  );
}
