'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/config/zod';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { trimmedField } from '@/lib/api/form';
import { logger } from '@/lib/logger';
import { assignStaff } from '@/lib/services/checkin';

/**
 * Ouvrir le poste pour soi-même.
 *
 * Un administrateur voit déjà toutes les réponses de son organisation : lui
 * permettre de tenir la porte de SON événement ne lui donne rien de nouveau.
 * Mais le droit d'ÉCRIRE une arrivée, lui, vient de `checkin_staff` et de rien
 * d'autre — c'est la règle du module, « l'affectation ouvre ». On affecte donc
 * pour de bon, par le chemin normal et sous RLS, plutôt que d'ouvrir une
 * exception dans les policies qui profiterait ensuite à tout le monde.
 *
 * Sans date de fin : c'est l'organisateur chez lui, et une expiration posée
 * dans son dos ferait disparaître son propre poste en plein service.
 */

const idSchema = z.string().uuid();

export async function openDeskAction(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(trimmedField(formData, 'surveyId'));
  if (!surveyId.success) redirect('/admin/pointage');

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  // L'organisation vient du PROFIL, jamais du formulaire.
  const profile = await context.port.selectOne<{ organisation_id: string | null }>({
    table: 'profiles',
    columns: 'organisation_id',
    where: [eq('id', context.userId)],
  });
  if (profile.error || !profile.data.organisation_id) redirect('/admin');

  const assigned = await assignStaff(context, {
    surveyId: surveyId.data,
    profileId: context.userId,
    organisationId: profile.data.organisation_id,
    expiresAt: null,
  });

  if (!assigned.ok) {
    logger.warn('checkin.self_assign_refused', 'Ouverture de poste refusée.', {
      code: assigned.error.code,
    });
    redirect('/admin/pointage?erreur=refus');
  }

  revalidatePath('/admin/pointage');
  redirect(`/accueil/${surveyId.data}`);
}
