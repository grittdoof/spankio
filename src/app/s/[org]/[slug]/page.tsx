import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type {
  CalendarActions,
  DirectionsActions,
  WelcomeContent,
} from '@/components/public/screens';
import { ClosedScreen } from '@/components/public/screens';
import { publicEnv } from '@/lib/config/env';
import { bannerPublicUrl } from '@/lib/event/banner';
import { resolveRequestContext } from '@/lib/data/context';
import { calendarLinks, directionsLinks } from '@/lib/event/calendar-links';
import { eventLocation, eventNote } from '@/lib/event/calendar-content';
import { countdownParts } from '@/lib/event/countdown';
import { fr } from '@/lib/i18n/fr';
import { loadPublicSurvey, type PublicSurvey } from '@/lib/services/submission';
import { composeConsentNotice, consentCheckboxLabel } from '@/lib/survey/consent';
import { isBlockAllowed } from '@/lib/survey/public-page';
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

/**
 * Mise en forme d'un instant dans le fuseau DE L'ÉVÉNEMENT.
 *
 * Pas dans `Europe/Paris` en dur, comme c'était le cas : « 19 h 30 » veut dire
 * 19 h 30 sur place, et c'est l'heure que l'invité compare à son propre
 * agenda. Une soirée à Fort-de-France était annoncée avec cinq heures d'écart
 * alors que le champ « fuseau » existait et était correctement enregistré.
 *
 * Un formateur par appel plutôt qu'une constante : le fuseau varie d'un
 * formulaire à l'autre. Le `try` couvre un fuseau que le moteur ne connaîtrait
 * pas — la page affiche alors moins, jamais une erreur.
 */
function formatInZone(
  value: string | null,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone }).format(date);
  } catch {
    return null;
  }
}

function eventWhen(survey: PublicSurvey): string | null {
  return formatInZone(
    survey.event.startsAt,
    survey.event.timezone,
    survey.event.allDay
      ? { dateStyle: 'full' }
      : { dateStyle: 'full', timeStyle: 'short' },
  );
}

/**
 * Précision d'horaire sous la date : l'heure de fin.
 *
 * Rien n'est inventé — sans heure de fin enregistrée, il n'y a pas de note.
 * Une fin le même jour se dit à l'heure seule ; un événement qui se termine le
 * lendemain reprend la date entière, sinon « fin à 2 h » serait ambigu.
 */
function eventWhenNote(survey: PublicSurvey): string | null {
  const { startsAt, endsAt, timezone, allDay } = survey.event;
  if (!endsAt || allDay) return null;
  const sameDay =
    formatInZone(startsAt, timezone, { dateStyle: 'short' }) ===
    formatInZone(endsAt, timezone, { dateStyle: 'short' });
  const end = formatInZone(
    endsAt,
    timezone,
    sameDay ? { timeStyle: 'short' } : { dateStyle: 'long', timeStyle: 'short' },
  );
  return end ? `Fin prévue à ${end}` : null;
}

function eventMeta(survey: PublicSurvey): string[] {
  const meta: string[] = [];
  const when = eventWhen(survey);
  if (when) meta.push(when);
  if (survey.event.locationLabel) meta.push(survey.event.locationLabel);
  if (survey.event.address) meta.push(survey.event.address);
  if (survey.event.organiser) meta.push(`Organisé par ${survey.event.organiser}`);
  return meta;
}

/** Adresse publique du formulaire : le lien qui ramène à l'invitation. */
function publicUrl(survey: PublicSurvey): string {
  const site = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  return `${site}/s/${survey.organisationSlug}/${survey.slug}`;
}

function bannerUrl(survey: PublicSurvey): string | null {
  if (!survey.bannerPath) return null;
  // Une seule composition d'URL de bannière, partagée avec l'espace
  // d'administration : deux versions finiraient par diverger d'un segment.
  return bannerPublicUrl(publicEnv().NEXT_PUBLIC_SUPABASE_URL, survey.bannerPath);
}

/**
 * Composition de l'invitation : ce que la page publique affiche, bloc par bloc.
 *
 * **Le filtrage est ici, et nulle part ailleurs.** Le composant reçoit du
 * contenu déjà trié : un bloc masqué par l'organisation, ou dont le contenu
 * n'existe pas, n'arrive tout simplement pas. C'est ce qui garantit qu'aucun
 * titre de section ne surplombe du vide — un composant qui déciderait
 * lui-même finirait par afficher « Déroulé » suivi de rien.
 *
 * Un bloc a donc DEUX conditions, et les deux sont nécessaires : l'interrupteur
 * de l'organisation (`isBlockAllowed`) et l'existence du contenu.
 */
function invitationContent(
  survey: PublicSurvey,
  options: {
    readonly isEvent: boolean;
    readonly calendar: CalendarActions | undefined;
    readonly directions: DirectionsActions | undefined;
    readonly now: Date;
  },
): Omit<WelcomeContent, 'branding'> {
  const page = survey.settings.publicPage;
  const allowed = (block: Parameters<typeof isBlockAllowed>[1]) =>
    isBlockAllowed(page, block);

  const parts = options.isEvent
    ? countdownParts(survey.event.startsAt, options.now)
    : null;

  const place =
    survey.event.locationLabel || survey.event.address
      ? { label: survey.event.locationLabel, address: survey.event.address }
      : null;

  const word = page?.organiserWord;
  const programme = page?.programme ?? [];
  const faq = page?.faq ?? [];
  const details = page?.details ?? [];

  return {
    badge: survey.settings.welcome?.badge ?? (options.isEvent ? 'Inscription' : undefined),
    title: survey.settings.welcome?.title ?? survey.title,
    description: survey.settings.welcome?.description ?? survey.description ?? undefined,
    ctaLabel: survey.settings.welcome?.ctaLabel ?? fr.survey.start,

    // La page publique n'existe QUE pour un formulaire publié et ouvert : la
    // pastille énonce donc un fait, elle n'est jamais un vœu.
    status: allowed('status') ? (page?.statusLabel ?? 'Inscriptions ouvertes') : null,

    ...(allowed('countdown') && parts && !parts.reached && survey.event.startsAt
      ? { countdown: { startsAt: survey.event.startsAt, initial: parts } }
      : {}),

    responseCount:
      allowed('responseCount') && survey.responseCount > 0 ? survey.responseCount : null,

    deadline: allowed('deadline')
      ? formatInZone(survey.closesAt, survey.event.timezone, { dateStyle: 'long' })
      : null,

    ...(allowed('practical') && options.isEvent
      ? {
          when: eventWhen(survey),
          whenNote: eventWhenNote(survey),
          place,
          details,
        }
      : {}),

    organiserWord: allowed('organiserWord') && word ? word : null,
    programme: allowed('programme') ? programme : [],
    calendar: allowed('calendar') ? (options.calendar ?? null) : null,
    directions: allowed('directions') ? (options.directions ?? null) : null,
    travelNote: allowed('directions') ? (page?.travelNote ?? null) : null,
    faq: allowed('faq') ? faq : [],
    shareUrl: allowed('share') ? publicUrl(survey) : null,
    privacyNote: allowed('privacyNote') ? privacyNote() : null,
  };
}

/**
 * Mention sur les données, en une phrase.
 *
 * Elle est FIXE, et ne reprend pas la finalité déclarée par l'organisation.
 * Défaut réel corrigé : la phrase composait « Elles servent à {finalité} », et
 * une organisation dont la finalité était rédigée comme une phrase complète
 * obtenait « Elles servent à Vos réponses ont bien été enregistrées par le
 * service de direction ». La plateforme ne peut pas connaître la forme
 * grammaticale d'un texte libre — elle ne l'insère donc pas dans une autre
 * phrase.
 *
 * La finalité, la base légale, les destinataires et la durée sont énoncés en
 * entier sur l'écran de consentement, par `composeConsentNotice`, qui est fait
 * pour cela.
 */
function privacyNote(): string {
  return 'Les données enregistrées sont celles des champs de ce formulaire ; aucune donnée technique de traçage n’est collectée. La finalité, les destinataires et la durée de conservation sont détaillés avant l’envoi.';
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
              // Contenu composé par la MÊME fonction que le fichier `.ics` :
              // deux compositions donneraient deux rendez-vous différents
              // selon le bouton cliqué.
              description: eventNote({
                custom: survey.event.details,
                description: survey.description,
                organiser: survey.event.organiser ?? survey.organisationName,
                url: publicUrl(survey),
              }),
              location: eventLocation({
                locationLabel: survey.event.locationLabel,
                address: survey.event.address,
              }),
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
          // Le visuel et le logo sont des blocs comme les autres : masqués,
          // ils n'arrivent pas jusqu'au rendu. Le nom de l'organisation reste,
          // lui, toujours affiché — une invitation sans émetteur n'existe pas.
          logoUrl: isBlockAllowed(survey.settings.publicPage, 'logo')
            ? survey.organisationLogoUrl
            : null,
          bannerUrl: isBlockAllowed(survey.settings.publicPage, 'banner')
            ? bannerUrl(survey)
            : null,
        }}
        welcome={invitationContent(survey, {
          isEvent,
          calendar: event?.calendar,
          directions: event?.directions,
          // Une seule lecture de l'horloge, passée en paramètre : le compte à
          // rebours rendu par le serveur et celui que reprend le navigateur
          // partent ainsi du même instant.
          now: new Date(),
        })}
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
