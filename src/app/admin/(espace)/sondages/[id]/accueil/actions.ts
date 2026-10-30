'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/config/zod';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { textFieldOrEmpty, trimmedField } from '@/lib/api/form';
import { logger } from '@/lib/logger';
import { assignStaff, inviteStaff, revokeInvitation, revokeStaff } from '@/lib/services/checkin';
import { getSurvey } from '@/lib/services/surveys';
import { defaultInvitationExpiry, isEmailShape } from '@/lib/checkin/invitation';
import {
  isPasswordAcceptable,
  isStaffLabelShape,
  type StaffAccountState,
} from '@/lib/checkin/account';
import { createStaffAccount, resetStaffPassword } from '@/lib/services/checkin-accounts';
import { publicEnv } from '@/lib/config/env';

/**
 * Affectations du poste d'accueil.
 *
 * Aucune vérification de rôle ici, comme ailleurs : les policies de
 * `checkin_staff` exigent déjà l'administrateur de l'organisation ET le
 * module `checkin`, et les clés étrangères composites refusent
 * structurellement une affectation qui croiserait deux organisations. Un
 * second contrôle donnerait deux vérités à maintenir, et c'est toujours la
 * plus permissive qu'on oublie.
 *
 * Ce sont des `<form action>` : affecter et retirer fonctionnent sans
 * JavaScript, comme la suppression groupée des réponses.
 */

const idSchema = z.string().uuid();

/**
 * Une date de fin saisie « 2026-11-20 » vaut la FIN de ce jour-là.
 *
 * Saisir le jour de l'événement et voir l'accès tomber à minuit pile, donc
 * avant même l'ouverture des portes, serait le piège le plus sûr de cet
 * écran : l'organisation croirait avoir donné l'accès pour la soirée.
 */
function endOfDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function requireOrganisation(): Promise<{ userId: string; organisationId: string }> {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  // L'organisation vient du PROFIL, jamais du formulaire : sans quoi un
  // formulaire forgé affecterait quelqu'un chez un autre tenant.
  const profile = await context.port.selectOne<{ organisation_id: string | null }>({
    table: 'profiles',
    columns: 'organisation_id',
    where: [eq('id', context.userId)],
  });
  if (profile.error || !profile.data.organisation_id) redirect('/admin');

  return { userId: context.userId, organisationId: profile.data.organisation_id };
}

export async function assignStaffAction(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(trimmedField(formData, 'surveyId'));
  const profileId = idSchema.safeParse(trimmedField(formData, 'profileId'));
  if (!surveyId.success) redirect('/admin/sondages');
  if (!profileId.success) redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=personne`);

  const { organisationId } = await requireOrganisation();
  const context = await resolveRequestContext();

  const raw = textFieldOrEmpty(formData, 'expiresOn');
  const expiresAt = raw === '' ? null : endOfDay(raw);
  if (raw !== '' && expiresAt === null) {
    redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=date`);
  }

  const assigned = await assignStaff(context, {
    surveyId: surveyId.data,
    profileId: profileId.data,
    organisationId,
    expiresAt,
  });

  if (!assigned.ok) {
    logger.warn('checkin.assign_refused', 'Affectation refusée.', {
      code: assigned.error.code,
    });
    // `23503` : le profil n'appartient pas à l'organisation du sondage. C'est
    // la clé étrangère composite qui parle, et elle a raison.
    redirect(
      `/admin/sondages/${surveyId.data}/accueil?erreur=${
        assigned.error.code === '23503' ? 'organisation' : 'refus'
      }`,
    );
  }

  revalidatePath(`/admin/sondages/${surveyId.data}/accueil`);
  redirect(`/admin/sondages/${surveyId.data}/accueil?fait=affectation`);
}

export async function revokeStaffAction(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(trimmedField(formData, 'surveyId'));
  const profileId = idSchema.safeParse(trimmedField(formData, 'profileId'));
  if (!surveyId.success) redirect('/admin/sondages');
  if (!profileId.success) redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=personne`);

  await requireOrganisation();
  const context = await resolveRequestContext();

  const removed = await revokeStaff(context, surveyId.data, profileId.data);
  if (!removed.ok) {
    logger.warn('checkin.revoke_refused', 'Retrait d’affectation refusé.', {
      code: removed.error.code,
    });
    redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=refus`);
  }

  revalidatePath(`/admin/sondages/${surveyId.data}/accueil`);
  redirect(`/admin/sondages/${surveyId.data}/accueil?fait=retrait`);
}

/**
 * Invite quelqu'un qui n'a pas encore de compte — ou qui en a un sans être
 * rattaché.
 *
 * L'invitation est créée ET envoyée dans le même geste, et le jeton n'apparaît
 * jamais à l'écran : le faire transiter par une redirection le mettrait dans
 * l'historique du navigateur et dans les journaux, pour un secret qui ouvre
 * une liste nominative.
 *
 * Conséquence assumée, et dite à l'écran : si le courriel ne part pas, le lien
 * est perdu — il n'existe nulle part en clair. On retire l'invitation et on
 * recommence.
 */
export async function inviteStaffAction(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(trimmedField(formData, 'surveyId'));
  if (!surveyId.success) redirect('/admin/sondages');

  const email = textFieldOrEmpty(formData, 'email').trim();
  if (!isEmailShape(email)) {
    redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=adresse`);
  }

  const { organisationId } = await requireOrganisation();
  const context = await resolveRequestContext();

  const survey = await getSurvey(context, surveyId.data);
  if (!survey.ok) redirect('/admin/sondages');

  const raw = textFieldOrEmpty(formData, 'expiresOn');
  const staffExpiresAt = raw === '' ? null : endOfDay(raw);
  if (raw !== '' && staffExpiresAt === null) {
    redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=date`);
  }

  const invited = await inviteStaff(context, {
    surveyId: surveyId.data,
    organisationId,
    email,
    expiresAt: defaultInvitationExpiry().toISOString(),
    staffExpiresAt,
    siteUrl: publicEnv().NEXT_PUBLIC_SITE_URL,
    eventTitle: survey.value.title,
  });

  if (!invited.ok) {
    logger.warn('checkin.invite_refused', 'Invitation refusée.', {
      code: invited.error.code,
    });
    redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=refus`);
  }

  revalidatePath(`/admin/sondages/${surveyId.data}/accueil`);
  redirect(
    `/admin/sondages/${surveyId.data}/accueil?fait=${
      invited.value.emailSent ? 'invitation' : 'invitation-sans-courriel'
    }`,
  );
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(trimmedField(formData, 'surveyId'));
  const invitationId = idSchema.safeParse(trimmedField(formData, 'invitationId'));
  if (!surveyId.success) redirect('/admin/sondages');
  if (!invitationId.success) {
    redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=refus`);
  }

  await requireOrganisation();
  const context = await resolveRequestContext();

  const removed = await revokeInvitation(context, surveyId.data, invitationId.data);
  if (!removed.ok) {
    logger.warn('checkin.invite_revoke_refused', 'Retrait d’invitation refusé.', {
      code: removed.error.code,
    });
    redirect(`/admin/sondages/${surveyId.data}/accueil?erreur=refus`);
  }

  revalidatePath(`/admin/sondages/${surveyId.data}/accueil`);
  redirect(`/admin/sondages/${surveyId.data}/accueil?fait=invitation-retiree`);
}


/**
 * Crée un compte de pointage et l'affecte, d'un seul geste.
 *
 * Cette action REND un état au lieu de rediriger, contrairement à toutes ses
 * voisines, et c'est délibéré. L'organisation doit repartir de cet écran avec
 * le couple identifiant / mot de passe à transmettre ; une redirection ne peut
 * le porter que dans l'URL, donc dans l'historique du navigateur et les
 * journaux du serveur — précisément ce que le jeton d'invitation refuse de
 * faire. La réponse d'un POST, elle, ne laisse aucune de ces traces.
 *
 * Le mot de passe est CHOISI par l'organisation, pas tiré puis révélé : celui
 * qui crée le compte est celui qui le transmet, il l'a déjà sous les yeux.
 * L'écran se contente de lui en proposer un solide et prononçable.
 *
 * Sans JavaScript, le formulaire poste quand même et l'état revient dans la
 * page rendue : le couple s'affiche, et le parcours reste entier.
 */
export async function createStaffAccountAction(
  _previous: StaffAccountState,
  formData: FormData,
): Promise<StaffAccountState> {
  const surveyId = idSchema.safeParse(trimmedField(formData, 'surveyId'));
  if (!surveyId.success) redirect('/admin/sondages');

  const label = textFieldOrEmpty(formData, 'label').trim();
  if (!isStaffLabelShape(label)) {
    return { status: 'error', message: 'Donnez un nom à ce poste — « Marie », « Entrée principale ».' };
  }

  const password = textFieldOrEmpty(formData, 'password');
  if (!isPasswordAcceptable(password)) {
    return {
      status: 'error',
      message: 'Le mot de passe doit faire au moins dix caractères, sans espace au début ni à la fin.',
    };
  }

  const { organisationId, userId } = await requireOrganisation();
  const context = await resolveRequestContext();

  // Le sondage est relu sous RLS : sans ce passage, un identifiant forgé
  // ferait créer un compte rattaché à l'organisation de l'appelant mais
  // affecté à l'événement d'une autre — que la clé étrangère composite
  // refuserait, mais après avoir créé l'utilisateur.
  const survey = await getSurvey(context, surveyId.data);
  if (!survey.ok) redirect('/admin/sondages');

  const raw = textFieldOrEmpty(formData, 'expiresOn');
  const expiresAt = raw === '' ? null : endOfDay(raw);
  if (raw !== '' && expiresAt === null) {
    return { status: 'error', message: 'La date de fin n’a pas été comprise.' };
  }

  const created = await createStaffAccount({
    organisationId,
    surveyId: surveyId.data,
    label,
    password,
    expiresAt,
    siteUrl: publicEnv().NEXT_PUBLIC_SITE_URL,
    actorId: userId,
  });

  if (!created.ok) {
    logger.warn('checkin.account_refused', 'Création de compte refusée.', {
      code: created.error.code,
    });
    return { status: 'error', message: created.error.message };
  }

  revalidatePath(`/admin/sondages/${surveyId.data}/accueil`);
  return {
    status: 'created',
    label,
    identifier: created.value.identifier,
    password,
  };
}

/**
 * Remplace le mot de passe d'un compte de pointage.
 *
 * Les trois conditions qui rendent ce geste acceptable — même organisation,
 * rôle `host`, identifiant fabriqué par la plateforme — sont vérifiées dans le
 * service, pas ici : c'est lui qui tient la clé de service, et c'est donc là
 * que doit vivre la seule barrière que le moteur n'applique pas.
 */
export async function resetStaffPasswordAction(
  _previous: StaffAccountState,
  formData: FormData,
): Promise<StaffAccountState> {
  const surveyId = idSchema.safeParse(trimmedField(formData, 'surveyId'));
  const profileId = idSchema.safeParse(trimmedField(formData, 'profileId'));
  if (!surveyId.success) redirect('/admin/sondages');
  if (!profileId.success) {
    return { status: 'error', message: 'Ce compte est introuvable.' };
  }

  const password = textFieldOrEmpty(formData, 'password');
  if (!isPasswordAcceptable(password)) {
    return {
      status: 'error',
      message: 'Le mot de passe doit faire au moins dix caractères, sans espace au début ni à la fin.',
    };
  }

  const { organisationId, userId } = await requireOrganisation();

  const reset = await resetStaffPassword({
    profileId: profileId.data,
    organisationId,
    password,
    siteUrl: publicEnv().NEXT_PUBLIC_SITE_URL,
    actorId: userId,
  });

  if (!reset.ok) {
    logger.warn('checkin.password_refused', 'Remise à zéro refusée.', {
      code: reset.error.code,
    });
    return { status: 'error', message: reset.error.message };
  }

  revalidatePath(`/admin/sondages/${surveyId.data}/accueil`);
  return { status: 'reset', identifier: reset.value.identifier, password };
}
