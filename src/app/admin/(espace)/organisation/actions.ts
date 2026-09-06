'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq } from '@/lib/data/port';
import { publicEnv } from '@/lib/config/env';
import { resolveRequestContext } from '@/lib/data/context';
import { textFieldOrEmpty, trimmedField } from '@/lib/api/form';
import { logger } from '@/lib/logger';
import {
  organisationProfileSchema,
  updateOrganisationProfile,
} from '@/lib/services/organisation';

/**
 * Enregistrement du profil de l'organisation.
 *
 * Aucun contrôle de rôle : le RLS n'autorise la mise à jour qu'au super
 * administrateur et à l'administrateur de CETTE organisation. L'identifiant
 * vient du profil de l'appelant, jamais du formulaire — sinon un compte
 * pourrait modifier l'organisation d'un autre tenant.
 */
export async function saveOrganisationProfile(formData: FormData): Promise<void> {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const profile = await context.port.selectOne<{ organisation_id: string | null }>({
    table: 'profiles',
    columns: 'organisation_id',
    where: [eq('id', context.userId)],
  });
  if (profile.error || !profile.data.organisation_id) redirect('/admin');

  const parsed = organisationProfileSchema.safeParse({
    name: textFieldOrEmpty(formData, 'name'),
    logoUrl: trimmedField(formData, 'logoUrl'),
    contactEmail: trimmedField(formData, 'contactEmail'),
    contactPhone: trimmedField(formData, 'contactPhone'),
    address: trimmedField(formData, 'address'),
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    redirect(`/admin/organisation?erreur=${encodeURIComponent(String(field ?? 'saisie'))}`);
  }

  const updated = await updateOrganisationProfile(
    context,
    profile.data.organisation_id,
    parsed.data,
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
  );
  if (!updated.ok) {
    // `PT400` : le logo désigne le bucket d'une autre organisation. Ce n'est
    // pas une panne, c'est un refus — et il est nommé comme tel.
    if (updated.error.code === 'PT400') redirect('/admin/organisation?erreur=logo');
    logger.warn('organisation.update_refused', 'Mise à jour du profil refusée.', {
      code: updated.error.code,
    });
    redirect('/admin/organisation?erreur=enregistrement');
  }

  revalidatePath('/admin');
  revalidatePath('/admin/organisation');
  redirect('/admin/organisation?ok=1');
}
