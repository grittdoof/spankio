import { z } from 'zod';
import { eq, inList, type DbError } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';
import { logger } from '@/lib/logger';
import { sendEmail, type EmailResult } from '@/lib/email/resend';
import {
  membershipApprovedEmail,
  membershipRejectedEmail,
  membershipRequestReceivedEmail,
} from '@/lib/email/templates/membership';
import type { EmailBranding } from '@/lib/email/templates/layout';
import { isValidSlug, slugify } from '@/lib/utils/slug';

/**
 * Parcours de rattachement.
 *
 * Toute la logique d'autorisation vit dans le RLS et dans les fonctions
 * `SECURITY DEFINER` : ce service orchestre, il ne décide pas. Il ne peut donc
 * pas être contourné par un appel direct à la base, et il reste testable contre
 * un vrai PostgreSQL.
 *
 * Les emails sont un effet de bord accessoire : leur échec est journalisé et
 * renvoyé au client comme information (`emailSent: false`), jamais comme erreur.
 */

export const ASSIGNABLE_ROLES = ['admin', 'editor', 'viewer'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const membershipRequestSchema = z
  .object({
    organisationId: z.string().uuid().optional(),
    organisationName: z.string().trim().min(2).max(160).optional(),
    requestedRole: z.enum(ASSIGNABLE_ROLES).default('editor'),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((value) => Boolean(value.organisationId) !== Boolean(value.organisationName), {
    message:
      'Indiquez soit une organisation existante, soit le nom de l’organisation à créer, mais pas les deux.',
    path: ['organisationId'],
  });

export type MembershipRequestInput = z.infer<typeof membershipRequestSchema>;

export const approvalSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
  moduleKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/)).max(20).default([]),
  /** Identifiant d'URL de l'organisation à créer, si la demande en crée une. */
  organisationSlug: z.string().trim().max(62).optional(),
  note: z.string().trim().max(2000).optional(),
});

export type ApprovalInput = z.infer<typeof approvalSchema>;

export const rejectionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

export interface ServiceDeps {
  sendEmail?: typeof sendEmail;
  siteUrl?: string;
}

export type ServiceOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: DbError };

export interface MembershipRequestRow {
  id: string;
  user_id: string;
  requester_email: string;
  requester_name: string | null;
  organisation_id: string | null;
  requested_organisation_name: string | null;
  requested_role: string;
  message: string | null;
  status: string;
  decided_role: string | null;
  decided_modules: string[];
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

interface OrganisationRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  brand: Record<string, unknown> | null;
  contact_email: string | null;
  contact_phone: string | null;
}

interface PlatformSettingsRow {
  publisher_name: string | null;
  publisher_email: string | null;
  notifications_email: string | null;
  privacy_email: string | null;
}

const REQUEST_COLUMNS =
  'id, user_id, requester_email, requester_name, organisation_id, ' +
  'requested_organisation_name, requested_role, message, status, decided_role, ' +
  'decided_modules, decision_note, decided_at, created_at';

function siteUrlOf(deps: ServiceDeps): string {
  return (deps.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
}

function legalLinks(siteUrl: string) {
  return [
    { label: 'Mentions légales', url: `${siteUrl}/mentions-legales` },
    { label: 'Confidentialité', url: `${siteUrl}/confidentialite` },
  ];
}

/** L'accent de marque est une donnée d'organisation : on ne lit qu'une chaîne. */
function brandAccent(brand: Record<string, unknown> | null): string | null {
  const value = brand?.['accent'];
  return typeof value === 'string' ? value : null;
}

function brandingOf(organisation: OrganisationRow): EmailBranding {
  return {
    organisationName: organisation.name,
    logoUrl: organisation.logo_url,
    accentColor: brandAccent(organisation.brand),
    contactEmail: organisation.contact_email,
    contactPhone: organisation.contact_phone,
  };
}

/**
 * Dépose une demande de rattachement pour le compte connecté.
 *
 * L'utilisateur ne peut déposer que pour lui-même : la policy RLS l'impose
 * (`user_id = auth.uid()`), ce service ne fait que fournir la valeur.
 */
export async function createMembershipRequest(
  context: RequestContext,
  input: MembershipRequestInput,
  deps: ServiceDeps = {},
): Promise<ServiceOutcome<{ request: MembershipRequestRow; emailSent: boolean }>> {
  if (!context.userId) {
    return { ok: false, error: { code: 'PT401', message: 'Authentification requise' } };
  }

  const profile = await context.port.selectOne<{ full_name: string | null; email: string }>({
    table: 'profiles',
    columns: 'full_name, email',
    where: [eq('id', context.userId)],
  });
  if (profile.error) return { ok: false, error: profile.error };

  const inserted = await context.port.insert<MembershipRequestRow>(
    'membership_requests',
    {
      user_id: context.userId,
      requester_email: context.email ?? profile.data.email,
      requester_name: profile.data.full_name,
      organisation_id: input.organisationId ?? null,
      requested_organisation_name: input.organisationName ?? null,
      requested_role: input.requestedRole,
      message: input.message ?? null,
    },
    REQUEST_COLUMNS,
  );
  if (inserted.error) return { ok: false, error: inserted.error };

  const emailSent = await notifyPlatform(context, inserted.data, deps);
  return { ok: true, value: { request: inserted.data, emailSent } };
}

/** Notifie l'adresse de la plateforme qu'une demande attend une décision. */
async function notifyPlatform(
  context: RequestContext,
  request: MembershipRequestRow,
  deps: ServiceDeps,
): Promise<boolean> {
  const settings = await context.port.selectOne<PlatformSettingsRow>({
    table: 'platform_settings',
    columns: 'publisher_name, publisher_email, notifications_email, privacy_email',
    where: [eq('id', 1)],
  });

  const destination =
    settings.data?.notifications_email ?? settings.data?.publisher_email ?? null;
  if (!destination) {
    logger.warn(
      'membership.notification_skipped',
      'Aucune adresse de notification de plateforme réglée : demande non notifiée.',
      { requestId: request.id },
    );
    return false;
  }

  // Le nom vient de l'annuaire, pas de `organisations` : le demandeur n'est pas
  // encore membre, donc la table lui est masquée par le RLS — c'est justement
  // la raison d'être de l'annuaire.
  let organisationLabel = request.requested_organisation_name ?? 'Organisation à préciser';
  if (request.organisation_id) {
    const organisation = await context.port.selectOne<{ name: string }>({
      table: 'organisation_directory',
      columns: 'name',
      where: [eq('id', request.organisation_id)],
    });
    if (organisation.data) organisationLabel = organisation.data.name;
  }

  const siteUrl = siteUrlOf(deps);
  const mail = membershipRequestReceivedEmail(
    {
      requesterName: request.requester_name,
      requesterEmail: request.requester_email,
      organisationLabel,
      requestedRole: request.requested_role,
      message: request.message,
    },
    {
      branding: {
        organisationName: settings.data?.publisher_name ?? 'Plateforme de sondages',
        siteUrl,
      },
      siteUrl,
      legalLinks: legalLinks(siteUrl),
    },
  );

  const result = await (deps.sendEmail ?? sendEmail)({
    to: destination,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    replyTo: request.requester_email,
  });
  return result.sent;
}

/** Demandes visibles par l'appelant : les siennes, ou toutes pour un super_admin. */
export async function listMembershipRequests(
  context: RequestContext,
  filters: { status?: 'pending' | 'approved' | 'rejected' } = {},
): Promise<ServiceOutcome<MembershipRequestRow[]>> {
  const where = filters.status ? [eq('status', filters.status)] : [];
  const result = await context.port.select<MembershipRequestRow>({
    table: 'membership_requests',
    columns: REQUEST_COLUMNS,
    where,
    order: { column: 'created_at', ascending: false },
    limit: 200,
  });
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, value: result.data ?? [] };
}

/**
 * Valide une demande : rôle ET modules autorisés sont choisis ici.
 *
 * L'autorisation est vérifiée par la fonction SQL (`is_super_admin()`), pas par
 * ce code : un appel direct à la base donnerait le même refus.
 */
export async function approveMembershipRequest(
  context: RequestContext,
  requestId: string,
  input: ApprovalInput,
  deps: ServiceDeps = {},
): Promise<ServiceOutcome<{ organisationId: string; emailSent: boolean }>> {
  const request = await context.port.selectOne<MembershipRequestRow>({
    table: 'membership_requests',
    columns: REQUEST_COLUMNS,
    where: [eq('id', requestId)],
  });
  if (request.error) return { ok: false, error: request.error };

  // Une demande de création d'organisation a besoin d'un identifiant d'URL :
  // on accepte celui fourni, sinon on le dérive du nom demandé.
  let organisationSlug: string | null = null;
  if (!request.data.organisation_id) {
    const proposed = input.organisationSlug?.trim()
      ? slugify(input.organisationSlug)
      : slugify(request.data.requested_organisation_name ?? '');
    if (!isValidSlug(proposed)) {
      return {
        ok: false,
        error: {
          code: 'PT400',
          message: "Identifiant d'organisation invalide",
        },
      };
    }
    organisationSlug = proposed;
  }

  const rpc = await context.port.rpc<string>('approve_membership_request', {
    p_request_id: requestId,
    p_role: input.role,
    p_module_keys: input.moduleKeys,
    p_organisation_slug: organisationSlug,
    p_note: input.note ?? null,
  });
  if (rpc.error) return { ok: false, error: rpc.error };
  const organisationId = rpc.data;
  if (!organisationId) {
    return { ok: false, error: { code: 'PT500', message: 'Validation sans organisation' } };
  }

  const emailSent = await notifyDecision(context, {
    kind: 'approved',
    request: request.data,
    organisationId,
    role: input.role,
    moduleKeys: input.moduleKeys,
    note: input.note ?? null,
    deps,
  });

  return { ok: true, value: { organisationId, emailSent } };
}

export async function rejectMembershipRequest(
  context: RequestContext,
  requestId: string,
  note: string | null,
  deps: ServiceDeps = {},
): Promise<ServiceOutcome<{ emailSent: boolean }>> {
  const request = await context.port.selectOne<MembershipRequestRow>({
    table: 'membership_requests',
    columns: REQUEST_COLUMNS,
    where: [eq('id', requestId)],
  });
  if (request.error) return { ok: false, error: request.error };

  const rpc = await context.port.rpc<null>('reject_membership_request', {
    p_request_id: requestId,
    p_note: note,
  });
  if (rpc.error) return { ok: false, error: rpc.error };

  const emailSent = await notifyDecision(context, {
    kind: 'rejected',
    request: request.data,
    organisationId: request.data.organisation_id,
    role: null,
    moduleKeys: [],
    note,
    deps,
  });

  return { ok: true, value: { emailSent } };
}

interface DecisionNotification {
  kind: 'approved' | 'rejected';
  request: MembershipRequestRow;
  organisationId: string | null;
  role: AssignableRole | null;
  moduleKeys: readonly string[];
  note: string | null;
  deps: ServiceDeps;
}

/** Email de décision, charté aux couleurs de l'organisation concernée. */
async function notifyDecision(
  context: RequestContext,
  input: DecisionNotification,
): Promise<boolean> {
  const siteUrl = siteUrlOf(input.deps);
  const send = input.deps.sendEmail ?? sendEmail;

  let organisation: OrganisationRow | null = null;
  if (input.organisationId) {
    const result = await context.port.selectOne<OrganisationRow>({
      table: 'organisations',
      columns: 'id, slug, name, logo_url, brand, contact_email, contact_phone',
      where: [eq('id', input.organisationId)],
    });
    organisation = result.data;
  }

  const branding: EmailBranding = organisation
    ? brandingOf(organisation)
    : { organisationName: 'Plateforme de sondages', siteUrl };

  let result: EmailResult;
  if (input.kind === 'approved') {
    const moduleNames = await resolveModuleNames(context, input.moduleKeys);
    const mail = membershipApprovedEmail(
      {
        recipientName: input.request.requester_name,
        organisationName: organisation?.name ?? 'votre organisation',
        role: input.role ?? 'viewer',
        moduleNames,
        note: input.note,
      },
      { branding, siteUrl, legalLinks: legalLinks(siteUrl) },
    );
    result = await send({
      to: input.request.requester_email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  } else {
    const mail = membershipRejectedEmail(
      {
        recipientName: input.request.requester_name,
        organisationLabel:
          organisation?.name ?? input.request.requested_organisation_name ?? 'la plateforme',
        note: input.note,
        contactEmail: organisation?.contact_email ?? null,
      },
      { branding, siteUrl, legalLinks: legalLinks(siteUrl) },
    );
    result = await send({
      to: input.request.requester_email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  }

  return result.sent;
}

async function resolveModuleNames(
  context: RequestContext,
  keys: readonly string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  const result = await context.port.select<{ name: string }>({
    table: 'modules',
    columns: 'name',
    where: [inList('key', keys)],
    order: { column: 'name' },
  });
  return (result.data ?? []).map((row) => row.name);
}
