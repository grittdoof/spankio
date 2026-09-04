'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { resolveRequestContext } from '@/lib/data/context';
import { textFieldOrEmpty, textFields, trimmedField } from '@/lib/api/form';
import { logger } from '@/lib/logger';
import {
  approvalSchema,
  approveMembershipRequest,
  rejectMembershipRequest,
} from '@/lib/services/membership';

/**
 * Décisions de rattachement.
 *
 * Aucun contrôle de rôle ici : `approve_membership_request` et
 * `reject_membership_request` refusent elles-mêmes tout appelant qui n'est pas
 * super administrateur. Un second contrôle dans l'action serveur donnerait deux
 * vérités à maintenir.
 */

const idSchema = z.string().uuid();

function moduleKeysFrom(formData: FormData): string[] {
  return textFields(formData, 'moduleKeys').filter((value) =>
    /^[a-z][a-z0-9_]{1,40}$/.test(value),
  );
}

export async function approve(formData: FormData): Promise<void> {
  const requestId = idSchema.safeParse(formData.get('requestId'));
  if (!requestId.success) redirect('/super-admin/demandes?erreur=identifiant');

  const organisationSlug = trimmedField(formData, 'organisationSlug');
  const note = trimmedField(formData, 'note');
  const parsed = approvalSchema.safeParse({
    role: textFieldOrEmpty(formData, 'role'),
    moduleKeys: moduleKeysFrom(formData),
    ...(organisationSlug ? { organisationSlug } : {}),
    ...(note ? { note } : {}),
  });
  if (!parsed.success) redirect('/super-admin/demandes?erreur=formulaire');

  const context = await resolveRequestContext();
  const result = await approveMembershipRequest(context, requestId.data, parsed.data);

  if (!result.ok) {
    logger.warn('membership.approve_refused', 'Validation refusée.', {
      code: result.error.code,
    });
    redirect(`/super-admin/demandes?erreur=${encodeURIComponent(result.error.code)}`);
  }

  revalidatePath('/super-admin/demandes');
  redirect(
    result.value.emailSent
      ? '/super-admin/demandes?ok=validee'
      : '/super-admin/demandes?ok=validee-sans-courriel',
  );
}

export async function reject(formData: FormData): Promise<void> {
  const requestId = idSchema.safeParse(formData.get('requestId'));
  if (!requestId.success) redirect('/super-admin/demandes?erreur=identifiant');

  const note = trimmedField(formData, 'note');
  const context = await resolveRequestContext();
  const result = await rejectMembershipRequest(
    context,
    requestId.data,
    note === null ? null : note.slice(0, 2000),
  );

  if (!result.ok) {
    logger.warn('membership.reject_refused', 'Refus impossible.', { code: result.error.code });
    redirect(`/super-admin/demandes?erreur=${encodeURIComponent(result.error.code)}`);
  }

  revalidatePath('/super-admin/demandes');
  redirect(
    result.value.emailSent
      ? '/super-admin/demandes?ok=refusee'
      : '/super-admin/demandes?ok=refusee-sans-courriel',
  );
}
