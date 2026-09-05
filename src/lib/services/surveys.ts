import { z } from 'zod';
import { toIsoString } from '@/lib/export/csv';
import { eq, isNull, type DbError } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';
import { isBannerPathOf } from '@/lib/event/banner';
import { templateByKey } from '@/lib/event/templates';
import { MAX_LENGTHS } from '@/lib/survey/limits';
import {
  validateDraftSchema,
  validateSurveySchema,
  type SchemaIssue,
  type SurveySchema,
} from '@/lib/survey/schema';
import { surveySettingsSchema, type SurveySettings } from '@/lib/survey/settings';
import { computeStatistics, type SurveyStatistics } from '@/lib/survey/statistics';
import { isValidSlug, slugify } from '@/lib/utils/slug';

/**
 * Gestion des sondages par l'organisation.
 *
 * Ce service ne décide d'aucun droit : le RLS filtre déjà les lignes visibles
 * et refuse les écritures hors organisation ou hors module autorisé. Ce qu'il
 * apporte, c'est la cohérence du CONTENU — un schéma reçu de l'éditeur visuel
 * est une entrée non fiable comme une autre, et un sondage publié doit
 * satisfaire des exigences que le SQL ne peut pas toutes exprimer avec un bon
 * message d'erreur.
 */

export type SurveyOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DbError; readonly issues?: readonly SchemaIssue[] };

export interface SurveyRow {
  id: string;
  organisation_id: string;
  module_key: string;
  slug: string;
  title: string;
  description: string | null;
  kind: 'survey' | 'event';
  status: 'draft' | 'published' | 'closed';
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
  opens_at: string | null;
  closes_at: string | null;
  response_limit: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const SURVEY_COLUMNS =
  'id, organisation_id, module_key, slug, title, description, kind, status, schema, ' +
  'settings, banner_path, event_starts_at, event_ends_at, event_all_day, ' +
  'event_timezone, event_location_label, event_address, event_lat, event_lng, ' +
  'event_organiser, event_details, purpose, legal_basis, retention_days, recipients, ' +
  'require_consent, dedup_field, opens_at, closes_at, response_limit, published_at, ' +
  'created_at, updated_at';

const LIST_COLUMNS =
  'id, slug, title, kind, status, module_key, published_at, closes_at, updated_at, created_at';

export interface SurveySummary {
  id: string;
  slug: string;
  title: string;
  kind: 'survey' | 'event';
  status: 'draft' | 'published' | 'closed';
  module_key: string;
  published_at: string | null;
  closes_at: string | null;
  updated_at: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

export const LEGAL_BASES = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
] as const;

export const createSurveySchema = z.object({
  title: z.string().trim().min(2).max(200),
  kind: z.enum(['survey', 'event']).default('survey'),
  /** Modèle de départ. Absent : sondage vierge. */
  templateKey: z.string().trim().max(64).optional(),
  slug: z.string().trim().max(82).optional(),
});

export type CreateSurveyInput = z.infer<typeof createSurveySchema>;

const isoDate = z.string().datetime({ offset: true });

export const updateSurveySchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  slug: z.string().trim().max(82).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(['draft', 'published', 'closed']).optional(),
  schema: z.unknown().optional(),
  settings: z.unknown().optional(),

  purpose: z.string().trim().max(2000).nullable().optional(),
  legalBasis: z.enum(LEGAL_BASES).nullable().optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  recipients: z.string().trim().max(2000).nullable().optional(),
  requireConsent: z.boolean().optional(),

  dedupField: z.string().trim().max(MAX_LENGTHS.identifier).nullable().optional(),
  opensAt: isoDate.nullable().optional(),
  closesAt: isoDate.nullable().optional(),
  responseLimit: z.number().int().positive().nullable().optional(),

  bannerPath: z.string().trim().max(300).nullable().optional(),
  eventStartsAt: isoDate.nullable().optional(),
  eventEndsAt: isoDate.nullable().optional(),
  eventAllDay: z.boolean().optional(),
  eventTimezone: z.string().trim().max(60).optional(),
  eventLocationLabel: z.string().trim().max(200).nullable().optional(),
  eventAddress: z.string().trim().max(300).nullable().optional(),
  eventLat: z.number().min(-90).max(90).nullable().optional(),
  eventLng: z.number().min(-180).max(180).nullable().optional(),
  eventOrganiser: z.string().trim().max(200).nullable().optional(),
  eventDetails: z.string().trim().max(4000).nullable().optional(),
});

export type UpdateSurveyInput = z.infer<typeof updateSurveySchema>;

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listSurveys(
  context: RequestContext,
): Promise<SurveyOutcome<SurveySummary[]>> {
  const result = await context.port.select<SurveySummary>({
    table: 'surveys',
    columns: LIST_COLUMNS,
    // Le RLS restreint déjà à l'organisation ; ce filtre-ci écarte la
    // corbeille, que le tableau de bord n'a pas à montrer.
    where: [isNull('deleted_at')],
    order: { column: 'updated_at', ascending: false },
    limit: 200,
  });
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, value: result.data };
}

export async function getSurvey(
  context: RequestContext,
  id: string,
): Promise<SurveyOutcome<SurveyRow>> {
  const result = await context.port.selectOne<SurveyRow>({
    table: 'surveys',
    columns: SURVEY_COLUMNS,
    where: [eq('id', id), isNull('deleted_at')],
  });
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, value: result.data };
}

/** Schéma d'un sondage, validé. Un schéma cassé en base est une anomalie. */
export function parseSurveySchema(row: SurveyRow): SurveyOutcome<SurveySchema> {
  const parsed = validateDraftSchema(row.schema);
  if (!parsed.ok) {
    return {
      ok: false,
      error: { code: 'PT500', message: 'Schéma de sondage invalide' },
      issues: parsed.issues,
    };
  }
  return { ok: true, value: parsed.schema };
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/**
 * Crée un sondage, éventuellement à partir d'un modèle.
 *
 * L'identifiant d'URL est dérivé du titre s'il n'est pas fourni. En cas de
 * collision, la contrainte d'unicité renvoie `23505`, traduite en conflit :
 * on ne devine pas un suffixe à la place de l'utilisateur, qui choisirait
 * peut-être un tout autre titre.
 */
export async function createSurvey(
  context: RequestContext,
  organisationId: string,
  input: CreateSurveyInput,
): Promise<SurveyOutcome<SurveyRow>> {
  const template = input.templateKey ? templateByKey(input.templateKey) : undefined;
  if (input.templateKey && !template) {
    return { ok: false, error: { code: 'PT404', message: 'Modèle introuvable' } };
  }

  const slug = input.slug?.trim() ? slugify(input.slug, 82) : slugify(input.title, 82);
  if (!isValidSlug(slug, 82)) {
    return {
      ok: false,
      error: { code: 'PT400', message: "Impossible de dériver un identifiant d'URL de ce titre" },
    };
  }

  const kind = template?.kind ?? input.kind;

  const created = await context.port.insert<SurveyRow>(
    'surveys',
    {
      organisation_id: organisationId,
      module_key: kind === 'event' ? 'event' : 'core',
      slug,
      title: input.title,
      kind,
      status: 'draft',
      schema: template?.schema ?? { version: 1, steps: [] },
      settings: template?.settings ?? {},
      dedup_field: template?.suggestedDedupField ?? null,
      created_by: context.userId,
    },
    SURVEY_COLUMNS,
  );

  if (created.error) return { ok: false, error: created.error };
  return { ok: true, value: created.data };
}

/** Colonnes de la base correspondant aux champs d'entrée. */
const COLUMN_BY_FIELD: Readonly<Record<string, string>> = {
  title: 'title',
  slug: 'slug',
  description: 'description',
  status: 'status',
  schema: 'schema',
  settings: 'settings',
  purpose: 'purpose',
  legalBasis: 'legal_basis',
  retentionDays: 'retention_days',
  recipients: 'recipients',
  requireConsent: 'require_consent',
  dedupField: 'dedup_field',
  opensAt: 'opens_at',
  closesAt: 'closes_at',
  responseLimit: 'response_limit',
  bannerPath: 'banner_path',
  eventStartsAt: 'event_starts_at',
  eventEndsAt: 'event_ends_at',
  eventAllDay: 'event_all_day',
  eventTimezone: 'event_timezone',
  eventLocationLabel: 'event_location_label',
  eventAddress: 'event_address',
  eventLat: 'event_lat',
  eventLng: 'event_lng',
  eventOrganiser: 'event_organiser',
  eventDetails: 'event_details',
};

/**
 * Met à jour un sondage.
 *
 * La validation du schéma dépend de l'état visé : un brouillon peut être
 * incomplet — on construit rarement un formulaire d'un seul geste — mais un
 * sondage publié doit être complet et cohérent. Publier un formulaire sans
 * question serait une impasse pour les répondants.
 */
export async function updateSurvey(
  context: RequestContext,
  id: string,
  input: UpdateSurveyInput,
): Promise<SurveyOutcome<SurveyRow>> {
  const existing = await getSurvey(context, id);
  if (!existing.ok) return existing;

  const targetStatus = input.status ?? existing.value.status;
  const values: Record<string, unknown> = {};

  if (input.schema !== undefined) {
    const parsed =
      targetStatus === 'published'
        ? validateSurveySchema(input.schema)
        : validateDraftSchema(input.schema);
    if (!parsed.ok) {
      return {
        ok: false,
        error: { code: 'PT400', message: 'Schéma invalide' },
        issues: parsed.issues,
      };
    }
    values['schema'] = parsed.schema;
  }

  if (input.settings !== undefined) {
    const parsed = surveySettingsSchema.safeParse(input.settings ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'PT400', message: 'Réglages invalides' },
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      };
    }
    values['settings'] = parsed.data satisfies SurveySettings;
  }

  if (input.slug !== undefined) {
    const slug = slugify(input.slug, 82);
    if (!isValidSlug(slug, 82)) {
      return { ok: false, error: { code: 'PT400', message: "Identifiant d'URL invalide" } };
    }
    values['slug'] = slug;
  }

  // La bannière est téléversée directement du navigateur vers Storage, dont le
  // RLS impose le dossier de l'organisation. Mais RIEN n'empêcherait
  // d'enregistrer ici un chemin pointant ailleurs : le bucket est public, et une
  // organisation illustrerait sa page avec le fichier d'une autre. Le chemin est
  // donc revérifié contre CE sondage et CETTE organisation.
  if (typeof input.bannerPath === 'string' && input.bannerPath !== '') {
    if (!isBannerPathOf(input.bannerPath, existing.value.organisation_id, id)) {
      return {
        ok: false,
        error: { code: 'PT400', message: 'Chemin de bannière invalide' },
        issues: [
          {
            path: 'bannerPath',
            code: 'foreign_path',
            message: 'Cette image n’appartient pas à ce formulaire.',
          },
        ],
      };
    }
  }

  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    if (['schema', 'settings', 'slug'].includes(field)) continue;
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) values[column] = value;
  }

  // Publication : on vérifie ici ce que la contrainte SQL refuserait, pour
  // pouvoir dire CE QUI manque plutôt que de renvoyer une violation opaque.
  //
  // Ces contrôles ne se déclenchent QUE si la requête publie explicitement, ou
  // si elle touche l'un des éléments vérifiés. Sans cette restriction,
  // corriger une faute de frappe dans le titre d'un sondage déjà publié
  // échouerait à cause d'un défaut préexistant que l'on n'était pas en train
  // de créer — et l'utilisateur ne comprendrait pas le refus.
  const touchesPublicationRequirements =
    input.status === 'published' ||
    input.schema !== undefined ||
    input.purpose !== undefined ||
    input.legalBasis !== undefined ||
    input.retentionDays !== undefined ||
    input.eventStartsAt !== undefined;

  if (targetStatus === 'published' && touchesPublicationRequirements) {
    const purpose = input.purpose ?? existing.value.purpose;
    const legalBasis = input.legalBasis ?? existing.value.legal_basis;
    const retentionDays = input.retentionDays ?? existing.value.retention_days;

    const missing: SchemaIssue[] = [];
    if (!purpose) {
      missing.push({ path: 'purpose', code: 'required', message: 'La finalité est obligatoire.' });
    }
    if (!legalBasis) {
      missing.push({
        path: 'legalBasis',
        code: 'required',
        message: 'La base légale est obligatoire.',
      });
    }
    if (!retentionDays) {
      missing.push({
        path: 'retentionDays',
        code: 'required',
        message: 'La durée de conservation est obligatoire.',
      });
    }

    const schemaToCheck = values['schema'] ?? existing.value.schema;
    const parsed = validateSurveySchema(schemaToCheck);
    if (!parsed.ok) {
      missing.push({
        path: 'schema',
        code: 'incomplete',
        message: 'Le formulaire doit comporter au moins une question.',
      });
    }

    const kind = existing.value.kind;
    const startsAt = input.eventStartsAt ?? existing.value.event_starts_at;
    if (kind === 'event' && !startsAt) {
      missing.push({
        path: 'eventStartsAt',
        code: 'required',
        message: 'Un événement publié doit avoir une date de début.',
      });
    }

    if (missing.length > 0) {
      return {
        ok: false,
        error: { code: 'PT400', message: 'Publication impossible' },
        issues: missing,
      };
    }
  }

  if (Object.keys(values).length === 0) {
    return { ok: true, value: existing.value };
  }

  const updated = await context.port.update<SurveyRow>(
    'surveys',
    values,
    [eq('id', id), isNull('deleted_at')],
    SURVEY_COLUMNS,
  );
  if (updated.error) return { ok: false, error: updated.error };

  const row = updated.data[0];
  if (!row) {
    return { ok: false, error: { code: 'PT403', message: 'Modification refusée' } };
  }
  return { ok: true, value: row };
}

/**
 * Suppression logique. Les réponses restent en base et sortent des agrégats ;
 * la purge définitive relève de la conservation, pas d'un clic.
 */
export async function deleteSurvey(
  context: RequestContext,
  id: string,
): Promise<SurveyOutcome<{ id: string }>> {
  const deleted = await context.port.update<{ id: string }>(
    'surveys',
    { deleted_at: new Date().toISOString() },
    [eq('id', id), isNull('deleted_at')],
    'id',
  );
  if (deleted.error) return { ok: false, error: deleted.error };

  const row = deleted.data[0];
  if (!row) return { ok: false, error: { code: 'PT404', message: 'Sondage introuvable' } };
  return { ok: true, value: row };
}

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export interface ResponseRow {
  id: string;
  submitted_at: string;
  consent_given: boolean;
  consent_text: string | null;
  data: Record<string, unknown>;
}

/**
 * Ligne telle qu'elle sort du port : l'horodatage peut être une chaîne ou un
 * `Date` selon l'adaptateur. On le normalise ici, une fois, pour que tout le
 * reste du code voie une forme unique.
 */
interface RawResponseRow extends Omit<ResponseRow, 'submitted_at'> {
  submitted_at: string | Date;
}

/** Plafond d'un export. Au-delà, il faut une pagination, pas un fichier géant. */
export const EXPORT_LIMIT = 5000;

export async function listResponses(
  context: RequestContext,
  surveyId: string,
  limit = 100,
): Promise<SurveyOutcome<ResponseRow[]>> {
  const result = await context.port.select<RawResponseRow>({
    table: 'survey_responses',
    columns: 'id, submitted_at, consent_given, consent_text, data',
    // `deleted_at is null` : TOUT agrégat et toute liste excluent la corbeille.
    where: [eq('survey_id', surveyId), isNull('deleted_at')],
    order: { column: 'submitted_at', ascending: false },
    limit,
  });
  if (result.error) return { ok: false, error: result.error };

  return {
    ok: true,
    value: result.data.map((row) => ({ ...row, submitted_at: toIsoString(row.submitted_at) })),
  };
}

export async function surveyStatistics(
  context: RequestContext,
  surveyId: string,
): Promise<SurveyOutcome<{ survey: SurveyRow; statistics: SurveyStatistics }>> {
  const survey = await getSurvey(context, surveyId);
  if (!survey.ok) return survey;

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return schema;

  const responses = await listResponses(context, surveyId, EXPORT_LIMIT);
  if (!responses.ok) return responses;

  return {
    ok: true,
    value: {
      survey: survey.value,
      statistics: computeStatistics(schema.value, responses.value),
    },
  };
}

/** Suppression logique d'une réponse (droit à l'effacement, modération). */
export async function softDeleteResponse(
  context: RequestContext,
  responseId: string,
): Promise<SurveyOutcome<{ id: string }>> {
  const deleted = await context.port.update<{ id: string }>(
    'survey_responses',
    { deleted_at: new Date().toISOString() },
    [eq('id', responseId), isNull('deleted_at')],
    'id',
  );
  if (deleted.error) return { ok: false, error: deleted.error };

  const row = deleted.data[0];
  if (!row) return { ok: false, error: { code: 'PT404', message: 'Réponse introuvable' } };
  return { ok: true, value: row };
}
