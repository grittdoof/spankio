import { OWNER, type TestDb } from './db';

/**
 * Fabriques de données pour les tests.
 *
 * Toutes les écritures de préparation passent par le rôle `postgres` (contexte
 * de migration) : les tests vérifient ensuite ce que voient réellement `anon`
 * et `authenticated`. Préparer les données avec les droits de l'application
 * reviendrait à tester le RLS avec le RLS, donc à ne rien prouver.
 */

export type Role = 'super_admin' | 'admin' | 'editor' | 'viewer' | 'host';

export async function createAccount(
  db: TestDb,
  email: string,
  fullName = 'Compte de test',
): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    OWNER,
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('full_name', $2::text))
     returning id`,
    [email, fullName],
  );
  if (!row) throw new Error(`Création du compte ${email} impossible`);
  return row.id;
}

export async function createOrganisation(
  db: TestDb,
  slug: string,
  name = slug,
): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    OWNER,
    'insert into public.organisations (slug, name) values ($1, $2) returning id',
    [slug, name],
  );
  if (!row) throw new Error(`Création de l'organisation ${slug} impossible`);
  return row.id;
}

export async function activateMember(
  db: TestDb,
  userId: string,
  organisationId: string | null,
  role: Role,
): Promise<void> {
  await db.query(
    OWNER,
    `update public.profiles
        set organisation_id = $2, role = $3::public.user_role, status = 'active'
      where id = $1`,
    [userId, organisationId, role],
  );
}

export async function grantModule(
  db: TestDb,
  organisationId: string,
  moduleKey: string,
  enabled = true,
): Promise<void> {
  await db.query(
    OWNER,
    `insert into public.organisation_modules (organisation_id, module_key, enabled)
     values ($1, $2, $3)
     on conflict (organisation_id, module_key) do update set enabled = excluded.enabled`,
    [organisationId, moduleKey, enabled],
  );
}

export async function setModuleOverride(
  db: TestDb,
  profileId: string,
  moduleKey: string,
  allowed: boolean,
): Promise<void> {
  await db.query(
    OWNER,
    `insert into public.profile_module_overrides (profile_id, module_key, allowed)
     values ($1, $2, $3)
     on conflict (profile_id, module_key) do update set allowed = excluded.allowed`,
    [profileId, moduleKey, allowed],
  );
}

export interface SurveyInput {
  organisationId: string;
  slug: string;
  title?: string;
  moduleKey?: string;
  kind?: 'survey' | 'event';
  status?: 'draft' | 'published' | 'closed';
  schema?: unknown;
  requireConsent?: boolean;
  dedupField?: string | null;
  responseLimit?: number | null;
  opensAt?: string | null;
  closesAt?: string | null;
  eventStartsAt?: string | null;
  eventEndsAt?: string | null;
  eventLocationLabel?: string | null;
  /** Réglages d'affichage et d'envoi, rangés dans `surveys.settings`. */
  settings?: unknown;
}

/** Sondage publié par défaut, avec les mentions RGPD que la contrainte exige. */
export async function createSurvey(db: TestDb, input: SurveyInput): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    OWNER,
    `insert into public.surveys (
       organisation_id, module_key, slug, title, kind, status, schema,
       purpose, legal_basis, retention_days, recipients, require_consent,
       dedup_field, response_limit, opens_at, closes_at, event_starts_at,
       event_ends_at, event_location_label, settings
     )
     values (
       $1, $2, $3, $4, $5::public.survey_kind, $6::public.survey_status, $7::jsonb,
       'Recenser un besoin', 'consent', 365, 'Service organisateur', $8,
       $9, $10, $11, $12, $13, $14, $15, $16::jsonb
     )
     returning id`,
    [
      input.organisationId,
      input.moduleKey ?? 'core',
      input.slug,
      input.title ?? `Sondage ${input.slug}`,
      input.kind ?? 'survey',
      input.status ?? 'published',
      JSON.stringify(input.schema ?? { steps: [] }),
      input.requireConsent ?? false,
      input.dedupField ?? null,
      input.responseLimit ?? null,
      input.opensAt ?? null,
      input.closesAt ?? null,
      input.eventStartsAt ?? (input.kind === 'event' ? '2027-06-01T10:00:00Z' : null),
      input.eventEndsAt ?? null,
      input.eventLocationLabel ?? null,
      JSON.stringify(input.settings ?? {}),
    ],
  );
  if (!row) throw new Error(`Création du sondage ${input.slug} impossible`);
  return row.id;
}

export async function insertResponse(
  db: TestDb,
  surveyId: string,
  data: Record<string, unknown> = { q1: 'oui' },
  options: { consentGiven?: boolean; consentText?: string; dedupKey?: string } = {},
): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    OWNER,
    `insert into public.survey_responses
       (survey_id, organisation_id, data, consent_given, consent_text, dedup_key)
     values ($1, '00000000-0000-0000-0000-000000000000'::uuid, $2::jsonb, $3, $4, $5)
     returning id`,
    [
      surveyId,
      JSON.stringify(data),
      options.consentGiven ?? false,
      options.consentText ?? null,
      options.dedupKey ?? null,
    ],
  );
  if (!row) throw new Error('Insertion de réponse impossible');
  return row.id;
}

/** Affecte un compte à la porte d'un événement. */
export async function assignStaff(
  db: TestDb,
  surveyId: string,
  profileId: string,
  organisationId: string,
  expiresAt: string | null = null,
): Promise<void> {
  await db.query(
    OWNER,
    `insert into public.checkin_staff (survey_id, profile_id, organisation_id, expires_at)
     values ($1, $2, $3, $4)
     on conflict (survey_id, profile_id) do update set expires_at = excluded.expires_at`,
    [surveyId, profileId, organisationId, expiresAt],
  );
}

export interface Tenant {
  organisationId: string;
  admin: string;
  editor: string;
  viewer: string;
  /** Compte d'accueil, affecté à `eventSurvey` et à lui seul. */
  host: string;
  /** Compte d'accueil SANS aucune affectation : il ne doit rien voir. */
  idleHost: string;
  survey: string;
  eventSurvey: string;
  response: string;
  /** Réponse rattachée à `eventSurvey`, donc visible du host affecté. */
  eventResponse: string;
}

/**
 * Deux organisations complètes et symétriques, chacune avec ses quatre rôles,
 * un sondage core, un sondage événement et une réponse. Plus un super_admin.
 *
 * Les deux comptes d'accueil ne sont pas un luxe : l'un prouve que
 * l'affectation OUVRE, l'autre que le rôle seul n'ouvre RIEN. Sans le second,
 * un test vert ne distinguerait pas « le droit vient de checkin_staff » de
 * « le droit vient d'être `host` dans cette organisation ».
 */
export async function seedTwoTenants(db: TestDb): Promise<{
  a: Tenant;
  b: Tenant;
  superAdmin: string;
}> {
  const superAdminId = await createAccount(db, 'super@plateforme.test', 'Super Admin');
  await activateMember(db, superAdminId, null, 'super_admin');

  const build = async (key: string): Promise<Tenant> => {
    const organisationId = await createOrganisation(db, `org-${key}`, `Organisation ${key}`);
    await grantModule(db, organisationId, 'event');
    await grantModule(db, organisationId, 'checkin');

    const admin = await createAccount(db, `admin@${key}.test`, `Admin ${key}`);
    const editor = await createAccount(db, `editor@${key}.test`, `Éditeur ${key}`);
    const viewer = await createAccount(db, `viewer@${key}.test`, `Lecteur ${key}`);
    const host = await createAccount(db, `host@${key}.test`, `Hôte ${key}`);
    const idleHost = await createAccount(db, `host-libre@${key}.test`, `Hôte sans poste ${key}`);
    await activateMember(db, admin, organisationId, 'admin');
    await activateMember(db, editor, organisationId, 'editor');
    await activateMember(db, viewer, organisationId, 'viewer');
    await activateMember(db, host, organisationId, 'host');
    await activateMember(db, idleHost, organisationId, 'host');

    const survey = await createSurvey(db, { organisationId, slug: `sondage-${key}` });
    const eventSurvey = await createSurvey(db, {
      organisationId,
      slug: `evenement-${key}`,
      moduleKey: 'event',
      kind: 'event',
    });
    const response = await insertResponse(db, survey, { q1: `réponse ${key}` });
    const eventResponse = await insertResponse(db, eventSurvey, { nom: `Invité ${key}` });

    await assignStaff(db, eventSurvey, host, organisationId);

    return {
      organisationId,
      admin,
      editor,
      viewer,
      host,
      idleHost,
      survey,
      eventSurvey,
      response,
      eventResponse,
    };
  };

  return {
    a: await build('a'),
    b: await build('b'),
    superAdmin: superAdminId,
  };
}
