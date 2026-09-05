import { eq, type DbError } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';
import { logger } from '@/lib/logger';
import { composeConsentNotice } from '@/lib/survey/consent';
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
}

export async function submitPublicResponse(
  context: RequestContext,
  input: SubmissionInput,
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
  const notice = composeConsentNotice({
    organisationName: survey.value.organisationName,
    purpose: survey.value.purpose,
    legalBasis: survey.value.legalBasis,
    retentionDays: survey.value.retentionDays,
    recipients: survey.value.recipients,
    customText: survey.value.settings.consentText ?? null,
  });

  const dedupValue = dedupValueFrom(validation.value.data, survey.value.dedupField);

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

  return {
    ok: true,
    value: { responseId: rpc.data, surveyId: survey.value.id, kind: survey.value.kind },
  };
}
