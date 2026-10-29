import { toIsoString } from '@/lib/export/csv';
import { eq, gte, inList, isNull, type DbError } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';
import type { CheckinState } from '@/lib/checkin/reducer';
import type { StaffMember } from '@/lib/checkin/readiness';
import { getSurvey, listResponses, parseSurveySchema, EXPORT_LIMIT } from './surveys';
import type { SurveyRow, SurveyOutcome, ResponseRow } from './surveys';
import { surveySettingsSchema } from '@/lib/survey/settings';
import type { AttendanceSettings } from '@/lib/survey/attendance';
import type { SurveySchema } from '@/lib/survey/schema';

/**
 * Poste d'accueil — accès aux données.
 *
 * Ce service ne décide d'AUCUN droit, comme les autres : c'est le RLS qui
 * laisse un compte d'accueil voir le seul événement où il est affecté, et
 * `public.set_checkin` qui revérifie l'autorisation d'écrire. Ce qu'on trouve
 * ici, c'est la forme : des lignes de base traduites en objets que le réducteur
 * sait manipuler, et une seule porte d'écriture.
 */

/** Ligne de `checkin_staff` telle que l'accueil la lit : ses propres affectations. */
export interface AssignmentRow {
  readonly surveyId: string;
  readonly title: string;
  readonly expiresAt: string | null;
}

interface RawAssignment {
  survey_id: string;
  expires_at: string | Date | null;
}

interface RawCheckin {
  response_id: string;
  arrived_at: string | Date | null;
  people_in: number | null;
  version: number;
  updated_at: string | Date;
}

function toState(row: RawCheckin): CheckinState {
  return {
    responseId: row.response_id,
    arrivedAt: row.arrived_at === null ? null : toIsoString(row.arrived_at),
    peopleIn: row.people_in,
    version: row.version,
    updatedAt: toIsoString(row.updated_at),
  };
}

/**
 * Les événements que CE compte peut tenir.
 *
 * Le filtre sur l'expiration est posé ici EN PLUS du RLS : le moteur refuse
 * déjà de lire les réponses d'une affectation expirée, mais une rangée morte
 * qui resterait dans le sélecteur mènerait à un écran vide et incompréhensible.
 * Mieux vaut ne pas la proposer.
 */
export async function listAssignments(
  context: RequestContext,
  now: Date = new Date(),
): Promise<SurveyOutcome<AssignmentRow[]>> {
  if (!context.userId) {
    return { ok: false, error: { code: 'PT403', message: 'Session requise' } };
  }

  const rows = await context.port.select<RawAssignment>({
    table: 'checkin_staff',
    columns: 'survey_id, expires_at',
    where: [eq('profile_id', context.userId)],
    limit: 50,
  });
  if (rows.error) return { ok: false, error: rows.error };

  const live = rows.data.filter(
    (row) => row.expires_at === null || new Date(toIsoString(row.expires_at)) > now,
  );

  const assignments: AssignmentRow[] = [];
  for (const row of live) {
    // Le titre passe par la lecture normale du sondage, donc par le RLS :
    // si l'affectation n'ouvre rien, le sondage reste invisible et la rangée
    // disparaît d'elle-même.
    const survey = await getSurvey(context, row.survey_id);
    if (!survey.ok) continue;
    assignments.push({
      surveyId: row.survey_id,
      title: survey.value.title,
      expiresAt: row.expires_at === null ? null : toIsoString(row.expires_at),
    });
  }

  return { ok: true, value: assignments };
}

export interface DeskData {
  readonly survey: SurveyRow;
  readonly schema: SurveySchema;
  readonly attendance: AttendanceSettings;
  readonly responses: readonly ResponseRow[];
  readonly states: readonly CheckinState[];
}

/**
 * Tout ce qu'il faut pour afficher le poste, en une fois.
 *
 * Le premier rendu est SERVEUR et complet : la liste s'affiche entière au
 * chargement, et reste lisible si le JavaScript ne démarre jamais. Le delta ne
 * fait que la tenir à jour ensuite.
 */
export async function loadDesk(
  context: RequestContext,
  surveyId: string,
): Promise<SurveyOutcome<DeskData>> {
  const survey = await getSurvey(context, surveyId);
  if (!survey.ok) return survey;

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return schema;

  const responses = await listResponses(context, surveyId, EXPORT_LIMIT);
  if (!responses.ok) return responses;

  const states = await readCheckins(context, surveyId);
  if (!states.ok) return states;

  // Des réglages illisibles ne doivent pas vider l'écran : on retombe sur un
  // comptage non configuré, exactement comme la page publique retombe sur ses
  // valeurs par défaut quand `settings` ne se lit pas.
  const parsed = surveySettingsSchema.safeParse(survey.value.settings ?? {});
  const attendance: AttendanceSettings = parsed.success
    ? (parsed.data.attendance ?? {})
    : {};

  return {
    ok: true,
    value: {
      survey: survey.value,
      schema: schema.value,
      attendance,
      responses: responses.value,
      states: states.value,
    },
  };
}

/**
 * État des arrivées, éventuellement depuis un curseur.
 *
 * `since` est le plus grand `updated_at` déjà connu du client. On relit à
 * partir de cette borne INCLUSE — une borne stricte perdrait les écritures
 * tombées dans la même milliseconde que le curseur, ce qui arrive précisément
 * quand deux postes pointent en même temps.
 */
export async function readCheckins(
  context: RequestContext,
  surveyId: string,
  since?: string,
): Promise<SurveyOutcome<CheckinState[]>> {
  const where = [eq('survey_id', surveyId)];
  if (since) where.push(gte('updated_at', since));

  const rows = await context.port.select<RawCheckin>({
    table: 'event_checkins',
    columns: 'response_id, arrived_at, people_in, version, updated_at',
    where,
    order: { column: 'updated_at', ascending: true },
    limit: EXPORT_LIMIT,
  });
  if (rows.error) return { ok: false, error: rows.error };

  return { ok: true, value: rows.data.map(toState) };
}

export interface CheckinInput {
  readonly responseId: string;
  readonly arrived: boolean;
  readonly opId: string;
  readonly expectedVersion: number | null;
  readonly peopleIn: number | null;
}

interface RawRpcResult {
  response_id: string;
  arrived_at: string | null;
  people_in: number | null;
  version: number;
  replayed: boolean;
}

export interface CheckinResult extends CheckinState {
  /** L'opération avait déjà été enregistrée : c'est un réessai, pas une faute. */
  readonly replayed: boolean;
}

/**
 * La seule écriture du module.
 *
 * Aucune policy n'autorise d'écrire `event_checkins` directement : tout passe
 * par cette fonction, parce qu'une écriture directe n'écrirait pas le journal
 * et rendrait l'idempotence contournable.
 *
 * `updated_at` n'est pas renvoyé par la fonction SQL — elle rend l'état, pas
 * sa date d'écriture. On prend donc l'instant local comme curseur : il ne sert
 * qu'à ordonner les deltas suivants, et une milliseconde d'écart ne peut pas
 * faire perdre de ligne puisque la borne du delta est INCLUSE.
 */
export async function recordCheckin(
  context: RequestContext,
  input: CheckinInput,
  now: Date = new Date(),
): Promise<SurveyOutcome<CheckinResult>> {
  const result = await context.port.rpc<RawRpcResult>('set_checkin', {
    p_response_id: input.responseId,
    p_arrived: input.arrived,
    p_op_id: input.opId,
    p_expected_version: input.expectedVersion,
    p_people_in: input.peopleIn,
  });
  if (result.error) return { ok: false, error: result.error };

  const row = result.data;
  return {
    ok: true,
    value: {
      responseId: row.response_id,
      arrivedAt: row.arrived_at,
      peopleIn: row.people_in,
      version: row.version,
      updatedAt: now.toISOString(),
      replayed: row.replayed,
    },
  };
}


// ---------------------------------------------------------------------------
// Préparation : qui tient la porte, et s'est-il déjà connecté
// ---------------------------------------------------------------------------

interface RawStaff {
  profile_id: string;
  expires_at: string | Date | null;
  first_seen_at: string | Date | null;
  last_seen_at: string | Date | null;
}

interface RawProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  status: string;
}

export interface OrganisationMember {
  readonly profileId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly role: string;
}

/**
 * Les personnes affectées à cet événement, avec leur identité.
 *
 * Deux lectures plutôt qu'une jointure : le port est volontairement étroit, et
 * l'étendre pour un écran d'administration peu fréquenté coûterait plus cher
 * en surface qu'il ne rapporte. Les deux passent par le RLS.
 */
export async function listStaff(
  context: RequestContext,
  surveyId: string,
): Promise<SurveyOutcome<StaffMember[]>> {
  const rows = await context.port.select<RawStaff>({
    table: 'checkin_staff',
    columns: 'profile_id, expires_at, first_seen_at, last_seen_at',
    where: [eq('survey_id', surveyId)],
    order: { column: 'granted_at', ascending: true },
    limit: 100,
  });
  if (rows.error) return { ok: false, error: rows.error };
  if (rows.data.length === 0) return { ok: true, value: [] };

  const profiles = await context.port.select<RawProfile>({
    table: 'profiles',
    columns: 'id, full_name, email, role, status',
    where: [inList('id', rows.data.map((row) => row.profile_id))],
    limit: 100,
  });
  if (profiles.error) return { ok: false, error: profiles.error };

  const byId = new Map(profiles.data.map((profile) => [profile.id, profile]));

  return {
    ok: true,
    value: rows.data.map((row) => {
      const profile = byId.get(row.profile_id);
      return {
        profileId: row.profile_id,
        name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        expiresAt: row.expires_at === null ? null : toIsoString(row.expires_at),
        firstSeenAt: row.first_seen_at === null ? null : toIsoString(row.first_seen_at),
        lastSeenAt: row.last_seen_at === null ? null : toIsoString(row.last_seen_at),
      };
    }),
  };
}

/**
 * Les membres actifs de l'organisation, affectables.
 *
 * Tous les rôles sont proposés, pas seulement « Accueil ». Affecter un éditeur
 * ne lui donne rien qu'il n'ait déjà — il voit déjà toutes les réponses de son
 * organisation — et l'interdire obligerait à créer un second compte à
 * quelqu'un qui tient la porte une heure avant de reprendre son travail.
 * L'écran affiche le rôle pour que le choix se fasse en connaissance de cause.
 */
export async function listAssignableMembers(
  context: RequestContext,
): Promise<SurveyOutcome<OrganisationMember[]>> {
  const rows = await context.port.select<RawProfile>({
    table: 'profiles',
    columns: 'id, full_name, email, role, status',
    where: [eq('status', 'active')],
    order: { column: 'full_name', ascending: true },
    limit: 200,
  });
  if (rows.error) return { ok: false, error: rows.error };

  return {
    ok: true,
    value: rows.data.map((row) => ({
      profileId: row.id,
      name: row.full_name,
      email: row.email,
      role: row.role,
    })),
  };
}

export interface AssignInput {
  readonly surveyId: string;
  readonly profileId: string;
  readonly organisationId: string;
  /** `null` : l'affectation ne cesse jamais d'elle-même. */
  readonly expiresAt: string | null;
}

/**
 * Affecte quelqu'un à la porte.
 *
 * Aucun contrôle de droit ici : les policies de `checkin_staff` exigent déjà
 * l'administrateur de l'organisation ET le module, et les deux clés étrangères
 * composites refusent structurellement une affectation qui croiserait deux
 * organisations — même exécutée par le propriétaire de la base.
 */
export async function assignStaff(
  context: RequestContext,
  input: AssignInput,
): Promise<SurveyOutcome<{ profileId: string }>> {
  const result = await context.port.upsert<{ profile_id: string }>(
    'checkin_staff',
    {
      survey_id: input.surveyId,
      profile_id: input.profileId,
      organisation_id: input.organisationId,
      granted_by: context.userId,
      expires_at: input.expiresAt,
    },
    ['survey_id', 'profile_id'],
    'profile_id',
  );
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, value: { profileId: result.data.profile_id } };
}

/**
 * Retire une affectation.
 *
 * Elle est SUPPRIMÉE, pas expirée : un retrait est un geste délibéré, et une
 * ligne laissée là avec une date passée se lirait comme un oubli. Le journal
 * des arrivées, lui, garde `by_profile` — le rapport pourra toujours dire qui
 * tenait la porte.
 */
export async function revokeStaff(
  context: RequestContext,
  surveyId: string,
  profileId: string,
): Promise<SurveyOutcome<{ removed: number }>> {
  const result = await context.port.remove<{ profile_id: string }>(
    'checkin_staff',
    [eq('survey_id', surveyId), eq('profile_id', profileId)],
    'profile_id',
  );
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, value: { removed: result.data.length } };
}

/**
 * Marque que l'appelant vient d'ouvrir ce poste.
 *
 * Appelée au rendu de l'écran, donc SANS JavaScript : une hôtesse qui ouvre la
 * page prouve qu'elle sait se connecter, et c'est exactement ce que l'écran de
 * préparation affiche la veille. Un échec n'est jamais remonté — ne pas savoir
 * tracer une ouverture ne doit pas empêcher de tenir la porte.
 */
export async function touchStaff(
  context: RequestContext,
  surveyId: string,
): Promise<boolean> {
  const result = await context.port.rpc<boolean>('touch_checkin_staff', {
    p_survey_id: surveyId,
  });
  return result.error ? false : result.data === true;
}

/** Réexporté pour que les routes n'aient pas à connaître deux modules. */
export type { DbError, ResponseRow, SurveyRow };
export { isNull };
