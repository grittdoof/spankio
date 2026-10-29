'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/config/zod';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { textFieldOrEmpty, trimmedField } from '@/lib/api/form';
import { logger } from '@/lib/logger';
import { assignStaff, revokeStaff } from '@/lib/services/checkin';

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
