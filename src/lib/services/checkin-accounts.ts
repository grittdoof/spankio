import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  mayResetPassword,
  staffIdentifier,
  staffIdentifierHost,
} from '@/lib/checkin/account';
import { logger } from '@/lib/logger';
import type { SurveyOutcome } from './surveys';

/**
 * Création de comptes de pointage — LE SEUL usage du `service role` déclenché
 * par un administrateur de tenant, et il est assumé.
 *
 * L'architecture est RLS-first : le `service role` contourne tout, donc il est
 * réservé au setup, au cron et au super-administrateur. L'invitation du lot 4b
 * a été conçue pour ne PAS créer de compte, précisément pour rester hors de
 * cette exception. Le client a tranché autrement : pour une soirée tenue par
 * du personnel engagé à la journée, faire créer un compte depuis un téléphone
 * est une marche trop haute, et il préfère remettre un identifiant et un mot
 * de passe de la main à la main.
 *
 * Créer un utilisateur n'est possible QUE par l'API d'administration de
 * Supabase, qui exige cette clé : il n'existe aucun chemin sous RLS. La
 * décision ne se contourne donc pas, elle se BORNE — et le prix de ces bornes
 * est qu'elles sont écrites ici, en TypeScript, puisque le moteur ne les
 * appliquera pas :
 *
 *  1. le compte créé reçoit le rôle `host`, jamais un autre : il n'ouvre rien
 *     par lui-même, et c'est l'affectation qui donne la liste d'UN événement ;
 *  2. il naît rattaché à l'organisation de l'appelant, lue de SON profil et
 *     jamais du formulaire ;
 *  3. toute reprise en main d'un compte existant (mot de passe) est refusée
 *     sauf si ce compte est un compte de pointage FABRIQUÉ, `host`, et de la
 *     même organisation — sans quoi un administrateur se donnerait le mot de
 *     passe d'un éditeur, voire d'un super-administrateur ;
 *  4. chaque acte est écrit à l'audit avec l'auteur réel.
 *
 * Les deux premières bornes tiennent aussi côté moteur — le rôle `host` ne
 * donne rien sans `checkin_staff`, et les clés étrangères composites refusent
 * une affectation qui croiserait deux organisations. La troisième est la seule
 * qui ne repose que sur ce fichier : c'est elle qu'il faut relire.
 */

interface ProfileRow {
  id: string;
  email: string | null;
  role: string;
  organisation_id: string | null;
}

function failure(code: string, message: string): SurveyOutcome<never> {
  return { ok: false, error: { code, message } };
}

export interface CreateAccountInput {
  readonly organisationId: string;
  readonly surveyId: string;
  readonly label: string;
  readonly password: string;
  readonly expiresAt: string | null;
  readonly siteUrl: string;
  readonly actorId: string;
}

export interface CreatedAccount {
  readonly profileId: string;
  readonly identifier: string;
}

/** Trois tirages suffisent : une collision sur quatre caractères est rare. */
const IDENTIFIER_ATTEMPTS = 3;

/**
 * Crée le compte, le rattache, l'affecte — ou ne laisse rien derrière lui.
 *
 * Il n'y a pas de transaction possible ici : l'utilisateur naît dans `auth`,
 * le profil et l'affectation dans `public`, par deux appels distincts. Le
 * rattrapage est donc explicite — si le rattachement ou l'affectation échoue,
 * l'utilisateur tout juste créé est SUPPRIMÉ. Un compte orphelin, rattaché à
 * rien, serait pire qu'une erreur : il porterait un identifiant que
 * l'organisation croit valide.
 */
export async function createStaffAccount(
  input: CreateAccountInput,
): Promise<SurveyOutcome<CreatedAccount>> {
  const admin = createSupabaseServiceClient();
  const host = staffIdentifierHost(input.siteUrl);

  let userId: string | null = null;
  let identifier = '';

  for (let attempt = 0; attempt < IDENTIFIER_ATTEMPTS; attempt += 1) {
    identifier = staffIdentifier(input.label, host);
    const created = await admin.auth.admin.createUser({
      email: identifier,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.label.trim() },
    });

    if (!created.error && created.data.user) {
      userId = created.data.user.id;
      break;
    }
    // Une adresse déjà prise est le seul échec qui mérite un second tirage ;
    // tout le reste (mot de passe refusé, service indisponible) se répéterait.
    const message = created.error?.message ?? '';
    if (!/already|registered|exists/i.test(message)) {
      logger.warn('checkin.account_create_failed', 'Création de compte refusée.', {
        message,
      });
      return failure('PT500', message || 'La création du compte a échoué.');
    }
  }

  if (userId === null) {
    return failure('PT409', 'Aucun identifiant libre n’a pu être tiré. Réessayez.');
  }

  // Le déclencheur `handle_new_user` a posé un profil `viewer`/`pending`. On le
  // porte à `host`/`active` et on le rattache : le garde-fou d'escalade laisse
  // passer, l'appel n'ayant aucun jeton (contexte serveur de confiance).
  const attached = await admin
    .from('profiles')
    .update({
      organisation_id: input.organisationId,
      role: 'host',
      status: 'active',
      full_name: input.label.trim(),
    })
    .eq('id', userId);

  if (attached.error) {
    await admin.auth.admin.deleteUser(userId);
    logger.warn('checkin.account_attach_failed', 'Rattachement du compte refusé.', {
      message: attached.error.message,
    });
    return failure('PT500', 'Le compte n’a pas pu être rattaché à votre organisation.');
  }

  const assigned = await admin.from('checkin_staff').insert({
    survey_id: input.surveyId,
    profile_id: userId,
    organisation_id: input.organisationId,
    granted_by: input.actorId,
    expires_at: input.expiresAt,
  });

  if (assigned.error) {
    await admin.auth.admin.deleteUser(userId);
    logger.warn('checkin.account_assign_failed', 'Affectation du compte refusée.', {
      message: assigned.error.message,
    });
    return failure('PT500', 'Le compte n’a pas pu être affecté à cet événement.');
  }

  await admin.from('audit_log').insert({
    organisation_id: input.organisationId,
    actor_id: input.actorId,
    action: 'checkin.account_created',
    target_table: 'profiles',
    target_id: userId,
    // Jamais le mot de passe, évidemment — ni ici ni ailleurs.
    meta: { survey_id: input.surveyId, identifier },
  });

  return { ok: true, value: { profileId: userId, identifier } };
}

export interface ResetPasswordInput {
  readonly profileId: string;
  readonly organisationId: string;
  readonly password: string;
  readonly siteUrl: string;
  readonly actorId: string;
}

/**
 * Remet le mot de passe d'un compte de pointage.
 *
 * C'est l'appel le plus dangereux du module : avec la clé de service, rien
 * n'empêche techniquement de réécrire le mot de passe de n'importe qui. Les
 * trois conditions ci-dessous sont donc vérifiées AVANT, et elles sont
 * cumulatives — même organisation, rôle `host`, identifiant fabriqué par la
 * plateforme. Un éditeur affecté à la porte garde son mot de passe ; un
 * super-administrateur aussi, fût-il dans l'organisation.
 */
export async function resetStaffPassword(
  input: ResetPasswordInput,
): Promise<SurveyOutcome<{ identifier: string }>> {
  const admin = createSupabaseServiceClient();
  const host = staffIdentifierHost(input.siteUrl);

  const profile = await admin
    .from('profiles')
    .select('id, email, role, organisation_id')
    .eq('id', input.profileId)
    .maybeSingle<ProfileRow>();

  if (profile.error || !profile.data) {
    return failure('PT404', 'Ce compte est introuvable.');
  }

  const target = profile.data;
  // La décision elle-même est pure et testée pour elle-même : c'est la seule
  // barrière de ce module que le moteur n'applique pas.
  const verdict = mayResetPassword(
    {
      organisationId: target.organisation_id,
      role: target.role,
      email: target.email,
    },
    input.organisationId,
    host,
  );
  if (!verdict.ok) {
    logger.warn('checkin.password_reset_refused', 'Remise à zéro refusée.', {
      profileId: input.profileId,
    });
    return failure(verdict.code, verdict.message);
  }

  const updated = await admin.auth.admin.updateUserById(input.profileId, {
    password: input.password,
  });
  if (updated.error) {
    return failure('PT500', 'Le mot de passe n’a pas pu être remplacé.');
  }

  await admin.from('audit_log').insert({
    organisation_id: input.organisationId,
    actor_id: input.actorId,
    action: 'checkin.account_password_reset',
    target_table: 'profiles',
    target_id: input.profileId,
    meta: { identifier: target.email },
  });

  return { ok: true, value: { identifier: target.email ?? '' } };
}
