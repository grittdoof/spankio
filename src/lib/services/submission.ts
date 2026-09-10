import { eq, type DbError } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';
import { isPlausibleEmail, sendEmail } from '@/lib/email/resend';
import { registrationConfirmationEmail } from '@/lib/email/templates/confirmation';
import { bannerPublicUrl } from '@/lib/event/banner';
import { eventLocation, eventNote, eventTitle } from '@/lib/event/calendar-content';
import { calendarLinks, directionsLinks } from '@/lib/event/calendar-links';
import { eventWhen, eventWhenNote } from '@/lib/event/display';
import { submittedRecap } from '@/lib/survey/recap';
import { logger } from '@/lib/logger';
import { composeConsentNotice } from '@/lib/survey/consent';
import { isConfirmationBlockShown } from '@/lib/survey/confirmation';
import { dedupDesignation } from '@/lib/survey/dedup';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import { validateSurveySettings, type SurveySettings } from '@/lib/survey/settings';
import {
  dedupValueFrom,
  validateResponse,
  type ResponseError,
} from '@/lib/survey/validate-response';

/**
 * Soumission publique d'une réponse.
 *
 * Le chemin complet, dans l'ordre :
 *
 *  1. lecture du sondage par la vue `public_surveys` — seul accès anonyme, qui
 *     ne montre que les sondages publiés, ouverts, d'une organisation active ;
 *  2. validation du SCHÉMA lui-même : il vient de la base, mais rien ne dit
 *     qu'il est cohérent, et un schéma cassé ne doit pas produire une erreur
 *     incompréhensible côté répondant ;
 *  3. validation de la RÉPONSE contre ce schéma, en liste blanche ;
 *  4. composition du texte de consentement PAR LE SERVEUR ;
 *  5. appel de `submit_survey_response`, qui revérifie en SQL ce que le SQL
 *     peut prouver — publication, fenêtre, quota, consentement, unicité.
 *
 * Le client n'est cru sur rien : ni sur les valeurs, ni sur l'organisation, ni
 * sur le texte de consentement, ni sur l'état du sondage.
 */

export interface PublicSurvey {
  readonly id: string;
  readonly slug: string;
  readonly organisationSlug: string;
  readonly organisationName: string;
  readonly organisationLogoUrl: string | null;
  readonly organisationBrand: Record<string, unknown> | null;
  readonly organisationContactEmail: string | null;
  readonly organisationContactPhone: string | null;
  readonly organisationAddress: string | null;
  readonly moduleKey: string;
  readonly title: string;
  readonly description: string | null;
  readonly kind: 'survey' | 'event';
  readonly schema: SurveySchema;
  readonly settings: SurveySettings;
  readonly bannerPath: string | null;
  readonly event: {
    readonly startsAt: string | null;
    readonly endsAt: string | null;
    readonly allDay: boolean;
    readonly timezone: string;
    readonly locationLabel: string | null;
    readonly address: string | null;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly organiser: string | null;
    readonly details: string | null;
  };
  readonly purpose: string | null;
  readonly legalBasis: string | null;
  readonly retentionDays: number | null;
  readonly recipients: string | null;
  readonly requireConsent: boolean;
  readonly dedupField: string | null;
  readonly closesAt: string | null;
  readonly responseCount: number;
  readonly isFull: boolean;
}

interface PublicSurveyRow {
  id: string;
  slug: string;
  organisation_slug: string;
  organisation_name: string;
  organisation_logo_url: string | null;
  organisation_brand: Record<string, unknown> | null;
  organisation_contact_email: string | null;
  organisation_contact_phone: string | null;
  organisation_address: string | null;
  module_key: string;
  title: string;
  description: string | null;
  kind: 'survey' | 'event';
  schema: unknown;
  settings: unknown;
  banner_path: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_all_day: boolean;
  event_timezone: string;
  event_location_label: string | null;
  event_address: string | null;
  event_lat: number | null;
  event_lng: number | null;
  event_organiser: string | null;
  event_details: string | null;
  purpose: string | null;
  legal_basis: string | null;
  retention_days: number | null;
  recipients: string | null;
  require_consent: boolean;
  dedup_field: string | null;
  closes_at: string | null;
  response_count: number;
  is_full: boolean;
}

const PUBLIC_COLUMNS =
  'id, slug, organisation_slug, organisation_name, organisation_logo_url, ' +
  'organisation_brand, organisation_contact_email, organisation_contact_phone, ' +
  'organisation_address, module_key, title, description, kind, schema, settings, ' +
  'banner_path, event_starts_at, event_ends_at, event_all_day, event_timezone, ' +
  'event_location_label, event_address, event_lat, event_lng, event_organiser, ' +
  'event_details, purpose, legal_basis, retention_days, recipients, require_consent, ' +
  'dedup_field, closes_at, response_count, is_full';

export type SubmissionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DbError; readonly fields?: readonly ResponseError[] };

/** Convertit une ligne de la vue publique en objet exploitable par le rendu. */
function toPublicSurvey(row: PublicSurveyRow): SubmissionOutcome<PublicSurvey> {
  const schema = validateSurveySchema(row.schema);
  if (!schema.ok) {
    // Un schéma incohérent en base est une anomalie d'administration, pas une
    // erreur du répondant : on la journalise et on refuse proprement.
    logger.error('survey.schema_invalid', 'Schéma de sondage invalide en base.', {
      surveyId: row.id,
      issues: schema.issues.map((issue) => `${issue.path}:${issue.code}`),
    });
    return { ok: false, error: { code: 'PT500', message: 'Schéma de sondage invalide' } };
  }

  const settings = validateSurveySettings(row.settings);

  return {
    ok: true,
    value: {
      id: row.id,
      slug: row.slug,
      organisationSlug: row.organisation_slug,
      organisationName: row.organisation_name,
      organisationLogoUrl: row.organisation_logo_url,
      organisationBrand: row.organisation_brand,
      organisationContactEmail: row.organisation_contact_email,
      organisationContactPhone: row.organisation_contact_phone,
      organisationAddress: row.organisation_address,
      moduleKey: row.module_key,
      title: row.title,
      description: row.description,
      kind: row.kind,
      schema: schema.schema,
      settings: settings.ok ? settings.settings : {},
      bannerPath: row.banner_path,
      event: {
        startsAt: row.event_starts_at,
        endsAt: row.event_ends_at,
        allDay: row.event_all_day,
        timezone: row.event_timezone,
        locationLabel: row.event_location_label,
        address: row.event_address,
        latitude: row.event_lat,
        longitude: row.event_lng,
        organiser: row.event_organiser,
        details: row.event_details,
      },
      purpose: row.purpose,
      legalBasis: row.legal_basis,
      retentionDays: row.retention_days,
      recipients: row.recipients,
      requireConsent: row.require_consent,
      dedupField: row.dedup_field,
      closesAt: row.closes_at,
      responseCount: Number(row.response_count),
      isFull: row.is_full,
    },
  };
}

/** Charge un sondage public par identifiants d'URL. */
export async function loadPublicSurvey(
  context: RequestContext,
  organisationSlug: string,
  surveySlug: string,
): Promise<SubmissionOutcome<PublicSurvey>> {
  const result = await context.port.selectOne<PublicSurveyRow>({
    table: 'public_surveys',
    columns: PUBLIC_COLUMNS,
    where: [eq('organisation_slug', organisationSlug), eq('slug', surveySlug)],
  });

  if (result.error) return { ok: false, error: result.error };
  return toPublicSurvey(result.data);
}

/** Charge un sondage public par son identifiant (fichier ICS, confirmation). */
export async function loadPublicSurveyById(
  context: RequestContext,
  id: string,
): Promise<SubmissionOutcome<PublicSurvey>> {
  const result = await context.port.selectOne<PublicSurveyRow>({
    table: 'public_surveys',
    columns: PUBLIC_COLUMNS,
    where: [eq('id', id)],
  });

  if (result.error) return { ok: false, error: result.error };
  return toPublicSurvey(result.data);
}

export interface SubmissionInput {
  readonly organisationSlug: string;
  readonly surveySlug: string;
  readonly data: unknown;
  /** Case cochée par le répondant. Le TEXTE, lui, est composé ici. */
  readonly consentGiven: boolean;
}

export interface SubmissionResult {
  readonly responseId: string;
  readonly surveyId: string;
  readonly kind: 'survey' | 'event';
  /** Le courriel de confirmation est-il parti ? Informatif, jamais bloquant. */
  readonly confirmationSent: boolean;
}

export interface SubmissionDeps {
  /** Injectable pour les tests : aucun réseau implicite. */
  readonly sendEmail?: typeof sendEmail;
  readonly siteUrl?: string;
  readonly supabaseUrl?: string;
}

export async function submitPublicResponse(
  context: RequestContext,
  input: SubmissionInput,
  deps: SubmissionDeps = {},
): Promise<SubmissionOutcome<SubmissionResult>> {
  const survey = await loadPublicSurvey(context, input.organisationSlug, input.surveySlug);
  if (!survey.ok) return survey;

  const validation = validateResponse(survey.value.schema, input.data);
  if (!validation.ok) {
    return {
      ok: false,
      error: { code: 'PT400', message: 'Réponse invalide' },
      fields: validation.errors,
    };
  }

  // Le texte de consentement n'est JAMAIS celui du client : il est recomposé
  // ici à partir des mentions du sondage, faute de quoi la preuve stockée ne
  // prouverait rien.
  const confirmation = survey.value.settings.confirmation;
  const confirmationEnabled = Boolean(confirmation?.enabled && confirmation.emailField);

  const notice = composeConsentNotice({
    organisationName: survey.value.organisationName,
    purpose: survey.value.purpose,
    legalBasis: survey.value.legalBasis,
    retentionDays: survey.value.retentionDays,
    recipients: survey.value.recipients,
    customText: survey.value.settings.consentText ?? null,
    // La preuve stockée doit dire qu'un courriel part : c'est un usage de
    // l'adresse collectée, et il ne peut pas rester tacite.
    confirmationEmail: confirmationEnabled,
  });

  // La clé anti-doublon désigne une QUESTION, et le schéma vit dans du `jsonb` :
  // refaire ses questions suffit à laisser une désignation qui ne pointe plus
  // sur rien. Une désignation devenue impossible est ignorée — même règle que
  // pour une lecture d'effectif que la question ne peut pas porter — et
  // journalisée, parce que l'organisation croit son unicité active.
  const designation = dedupDesignation(survey.value.schema, survey.value.dedupField);
  if (designation.kind === 'missing') {
    logger.error(
      'survey.dedup_field_missing',
      "Clé anti-doublon désignant une question absente du schéma : l'unicité ne s'applique pas.",
      { surveyId: survey.value.id, dedupField: designation.id },
    );
  }

  const dedupValue =
    designation.kind === 'field'
      ? dedupValueFrom(validation.value.data, designation.field.id)
      : null;

  const rpc = await context.port.rpc<string>('submit_survey_response', {
    p_survey_id: survey.value.id,
    p_data: validation.value.data,
    p_consent_given: input.consentGiven,
    p_consent_text: input.consentGiven ? notice.text : null,
    p_dedup_value: dedupValue,
  });

  if (rpc.error) return { ok: false, error: rpc.error };
  if (!rpc.data) {
    return { ok: false, error: { code: 'PT500', message: 'Réponse non enregistrée' } };
  }

  logger.info('survey.response_submitted', 'Réponse enregistrée.', {
    surveyId: survey.value.id,
    // Aucune donnée de la réponse n'est journalisée : seulement des compteurs.
    fields: Object.keys(validation.value.data).length,
    dropped: validation.value.dropped.length,
  });

  // L'envoi vient APRÈS l'enregistrement, et ne peut pas le remettre en
  // cause : `sendEmail` ne lève jamais, et son échec n'est que journalisé.
  const confirmationSent = confirmationEnabled
    ? await sendConfirmation(survey.value, survey.value.schema, validation.value.data, deps)
    : false;

  return {
    ok: true,
    value: {
      responseId: rpc.data,
      surveyId: survey.value.id,
      kind: survey.value.kind,
      confirmationSent,
    },
  };
}

/**
 * Courriel de confirmation au répondant.
 *
 * Ne lève jamais et ne renvoie qu'un booléen : une inscription aboutie reste
 * aboutie, même si Resend est en panne ou si l'adresse saisie est invalide.
 * C'est la règle absolue de `sendEmail`, appliquée ici au cas le plus visible.
 */
async function sendConfirmation(
  survey: PublicSurvey,
  schema: SurveySchema,
  data: Readonly<Record<string, unknown>>,
  deps: SubmissionDeps,
): Promise<boolean> {
  const confirmation = survey.settings.confirmation;
  if (!confirmation?.emailField) return false;

  const recipient = data[confirmation.emailField];
  if (!isPlausibleEmail(recipient)) {
    // Cas courant et non fautif : la question désignée était facultative et
    // n'a pas été remplie. Rien à envoyer, rien à signaler au répondant.
    logger.info('survey.confirmation_skipped', 'Aucune adresse exploitable.', {
      surveyId: survey.id,
    });
    return false;
  }

  /**
   * Quels blocs le courriel montre.
   *
   * Le filtrage vit ICI, jamais dans le gabarit — même règle que pour la page
   * publique (`invitationContent`) : un gabarit qui déciderait lui-même
   * finirait par afficher un titre orphelin. Et un bloc autorisé mais vide ne
   * s'affiche toujours pas : l'interrupteur ne fabrique pas de contenu.
   */
  const shows = (block: Parameters<typeof isConfirmationBlockShown>[1]) =>
    isConfirmationBlockShown(confirmation, block);

  const site = (deps.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const supabaseUrl = deps.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const publicUrl = `${site}/s/${survey.organisationSlug}/${survey.slug}`;
  const start = survey.event.startsAt ? new Date(survey.event.startsAt) : null;

  const when = {
    startsAt: survey.event.startsAt,
    endsAt: survey.event.endsAt,
    allDay: survey.event.allDay,
    timeZone: survey.event.timezone,
  };

  const message = registrationConfirmationEmail({
    branding: {
      organisationName: survey.organisationName,
      logoUrl: survey.organisationLogoUrl,
      accentColor: survey.settings.publicPage?.ctaColor ?? null,
      // Le nom de l'organisation reste : c'est l'expéditeur, pas une
      // coordonnée. Seuls le courriel, le téléphone et l'adresse se ferment.
      contactEmail: shows('contact') ? survey.organisationContactEmail : null,
      contactPhone: shows('contact') ? survey.organisationContactPhone : null,
      postalAddress: shows('contact') ? survey.organisationAddress : null,
      siteUrl: site,
    },
    surveyTitle: survey.title,
    bannerUrl:
      shows('banner') && survey.bannerPath && supabaseUrl
        ? bannerPublicUrl(supabaseUrl, survey.bannerPath)
        : null,
    customText: confirmation.text ?? null,
    when: shows('when') ? eventWhen(when) : null,
    // L'heure de fin se ferme SANS la date : c'est le cas qui a motivé ces
    // interrupteurs, une fin seulement indicative qu'on ne veut pas annoncer.
    whenNote: shows('endTime') ? eventWhenNote(when) : null,
    place: shows('place')
      ? eventLocation({
          locationLabel: survey.event.locationLabel,
          address: survey.event.address,
        })
      : null,
    // L'accès vient du champ « Accès » des réglages de la page publique : une
    // seule saisie, affichée à l'écran ET reprise ici.
    access: shows('access') ? (survey.settings.publicPage?.travelNote ?? null) : null,
    // Ce que la personne a saisi, pour qu'elle le vérifie : c'est sa propre
    // réponse qu'on lui relit, et les libellés d'option, jamais leurs valeurs.
    recap: shows('recap') ? submittedRecap(schema, data) : [],
    directions: shows('directions')
      ? (directionsLinks({
          latitude: survey.event.latitude,
          longitude: survey.event.longitude,
          address: survey.event.address,
          label: survey.event.locationLabel,
        }) ?? null)
      : null,
    calendar: shows('calendar') && start
      ? calendarLinks(
          {
            title: eventTitle({
              custom: survey.settings.calendar?.title,
              title: survey.title,
            }),
            start,
            end: survey.event.endsAt ? new Date(survey.event.endsAt) : null,
            allDay: survey.event.allDay,
            // La MÊME composition que l'invitation et le fichier `.ics` : trois
            // notes différentes selon le chemin seraient trois rendez-vous.
            description: eventNote({
              custom: survey.event.details,
              description: survey.description,
              organiser: survey.event.organiser ?? survey.organisationName,
              url: publicUrl,
            }),
            location: eventLocation({
              locationLabel: survey.event.locationLabel,
              address: survey.event.address,
            }),
          },
          `${site}/api/ics/${survey.id}`,
        )
      : null,
    ...(shows('link') ? { publicUrl } : {}),
    ...(site ? { legalLinks: [{ label: 'Confidentialité', url: `${site}/confidentialite` }] } : {}),
  });

  const send = deps.sendEmail ?? sendEmail;
  const result = await send({
    to: String(recipient).trim(),
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(survey.organisationContactEmail
      ? { replyTo: survey.organisationContactEmail }
      : {}),
  });

  return result.sent;
}
