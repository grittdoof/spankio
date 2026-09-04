'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { resolveRequestContext } from '@/lib/data/context';
import { textField, textFieldOrEmpty, trimmedField } from '@/lib/api/form';
import { logger } from '@/lib/logger';
import { checkRateLimit, clientIdentifier } from '@/lib/security/rate-limit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  createMembershipRequest,
  membershipRequestSchema,
} from '@/lib/services/membership';

/**
 * Actions serveur des écrans d'authentification.
 *
 * Elles fonctionnent sans JavaScript : les formulaires sont des `<form action>`
 * classiques. En cas d'échec, la page est réaffichée avec un CODE d'erreur en
 * paramètre d'URL — jamais l'adresse saisie ni aucune donnée personnelle, qui
 * finiraient dans les journaux du proxy et dans l'historique du navigateur.
 */

const MIN_PASSWORD_LENGTH = 12;

const emailSchema = z.string().trim().min(1).email();
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH);

async function callerIdentifier(): Promise<string> {
  return clientIdentifier(await headers());
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function signIn(formData: FormData): Promise<void> {
  const email = emailSchema.safeParse(textField(formData, 'email'));
  const password = passwordSchema.safeParse(textField(formData, 'password'));

  if (!email.success) redirect('/connexion?erreur=emailInvalid');
  // Un mot de passe trop court côté saisie n'est pas une erreur de validation
  // à afficher : il ne correspondra simplement à aucun compte.
  if (!password.success) redirect('/connexion?erreur=invalidCredentials');

  const limit = await checkRateLimit('auth', await callerIdentifier());
  if (!limit.allowed) redirect('/connexion?erreur=tooManyAttempts');

  const client = await createSupabaseServerClient();
  const { error } = await client.auth.signInWithPassword({
    email: email.data,
    password: password.data,
  });

  if (error) {
    logger.warn('auth.sign_in_failed', 'Échec de connexion.', { reason: error.message });
    redirect(
      error.message.toLowerCase().includes('confirm')
        ? '/connexion?erreur=emailNotConfirmed'
        : '/connexion?erreur=invalidCredentials',
    );
  }

  redirect('/admin');
}

export async function signUp(formData: FormData): Promise<void> {
  const fullName = z
    .string()
    .trim()
    .min(1)
    .max(160)
    .safeParse(textField(formData, 'fullName'));
  const email = emailSchema.safeParse(textField(formData, 'email'));
  const password = passwordSchema.safeParse(textField(formData, 'password'));

  if (!fullName.success) redirect('/inscription?erreur=fullNameRequired');
  if (!email.success) redirect('/inscription?erreur=emailInvalid');
  if (!password.success) redirect('/inscription?erreur=passwordTooShort');

  const limit = await checkRateLimit('auth', await callerIdentifier());
  if (!limit.allowed) redirect('/inscription?erreur=tooManyAttempts');

  const client = await createSupabaseServerClient();
  const { error } = await client.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      data: { full_name: fullName.data },
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });

  if (error) {
    logger.warn('auth.sign_up_failed', "Échec de création de compte.", {
      reason: error.message,
    });
    // Message identique qu'un compte existe déjà ou non : on n'énumère pas.
    redirect('/inscription?ok=confirmation');
  }

  redirect('/inscription?ok=confirmation');
}

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = emailSchema.safeParse(textField(formData, 'email'));
  if (!email.success) redirect('/mot-de-passe-oublie?erreur=emailInvalid');

  const limit = await checkRateLimit('auth', await callerIdentifier());
  if (!limit.allowed) redirect('/mot-de-passe-oublie?erreur=tooManyAttempts');

  const client = await createSupabaseServerClient();
  const { error } = await client.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteUrl()}/auth/callback?suite=/nouveau-mot-de-passe`,
  });
  if (error) {
    logger.warn('auth.reset_request_failed', 'Échec de demande de réinitialisation.', {
      reason: error.message,
    });
  }

  // Réponse invariable : elle ne dit pas si l'adresse est connue.
  redirect('/mot-de-passe-oublie?ok=envoye');
}

export async function updatePassword(formData: FormData): Promise<void> {
  const password = passwordSchema.safeParse(textField(formData, 'password'));
  const confirmation = textField(formData, 'passwordConfirmation');

  if (!password.success) redirect('/nouveau-mot-de-passe?erreur=passwordTooShort');
  if (password.data !== confirmation) redirect('/nouveau-mot-de-passe?erreur=passwordMismatch');

  const client = await createSupabaseServerClient();
  const { error } = await client.auth.updateUser({ password: password.data });
  if (error) {
    logger.warn('auth.password_update_failed', 'Échec de mise à jour du mot de passe.', {
      reason: error.message,
    });
    redirect('/nouveau-mot-de-passe?erreur=sessionExpired');
  }

  redirect('/connexion?ok=motDePasse');
}

export async function signOut(): Promise<void> {
  const client = await createSupabaseServerClient();
  await client.auth.signOut();
  redirect('/connexion');
}

/** Dépose une demande de rattachement pour le compte connecté. */
export async function submitMembershipRequest(formData: FormData): Promise<void> {
  const limit = await checkRateLimit('membershipRequest', await callerIdentifier());
  if (!limit.allowed) redirect('/demande-de-rattachement?erreur=tooManyAttempts');

  const rawOrganisationId = textFieldOrEmpty(formData, 'organisationId');
  const rawOrganisationName = trimmedField(formData, 'organisationName');
  const wantsNewOrganisation = rawOrganisationId === '' || rawOrganisationId === '__nouvelle';
  const message = trimmedField(formData, 'message');

  const candidate = {
    ...(wantsNewOrganisation ? {} : { organisationId: rawOrganisationId }),
    ...(wantsNewOrganisation && rawOrganisationName ? { organisationName: rawOrganisationName } : {}),
    requestedRole: textField(formData, 'requestedRole') ?? 'editor',
    ...(message ? { message } : {}),
  };

  const parsed = membershipRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    redirect('/demande-de-rattachement?erreur=organisationRequired');
  }

  const context = await resolveRequestContext();
  const result = await createMembershipRequest(context, parsed.data);

  if (!result.ok) {
    logger.warn('membership.request_failed', 'Demande de rattachement refusée.', {
      code: result.error.code,
    });
    redirect(
      result.error.code === '23505' || result.error.code === 'PT409'
        ? '/demande-de-rattachement?ok=deja'
        : '/demande-de-rattachement?erreur=unexpected',
    );
  }

  redirect('/demande-de-rattachement?ok=envoye');
}
