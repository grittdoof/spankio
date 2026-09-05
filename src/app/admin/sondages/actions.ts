'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { textFieldOrEmpty, trimmedField } from '@/lib/api/form';
import { logger } from '@/lib/logger';
import {
  createSurvey,
  createSurveySchema,
  deleteSurvey,
  softDeleteResponse,
} from '@/lib/services/surveys';

/**
 * Actions de gestion des formulaires.
 *
 * Aucune vérification de rôle ici : le RLS refuse déjà l'écriture à qui n'a ni
 * le rôle ni le module. Un second contrôle donnerait deux vérités à maintenir,
 * et c'est toujours la plus permissive qu'on oublie de mettre à jour.
 *
 * Ce sont des `<form action>` classiques : la création et la suppression
 * fonctionnent sans JavaScript.
 */

const idSchema = z.string().uuid();

export async function createSurveyAction(formData: FormData): Promise<void> {
  const templateKey = trimmedField(formData, 'templateKey');
  const parsed = createSurveySchema.safeParse({
    title: textFieldOrEmpty(formData, 'title'),
    kind: textFieldOrEmpty(formData, 'kind') || 'survey',
    ...(templateKey ? { templateKey } : {}),
  });
  if (!parsed.success) redirect('/admin/sondages/nouveau?erreur=formulaire');

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  // L'organisation vient du profil, jamais du formulaire : un client ne peut
  // pas créer un formulaire chez un autre tenant.
  const profile = await context.port.selectOne<{ organisation_id: string | null }>({
    table: 'profiles',
    columns: 'organisation_id',
    where: [eq('id', context.userId)],
  });
  if (profile.error || !profile.data.organisation_id) {
    redirect('/admin/sondages/nouveau?erreur=rattachement');
  }

  const created = await createSurvey(context, profile.data.organisation_id, parsed.data);
  if (!created.ok) {
    logger.warn('surveys.create_refused', 'Création de formulaire refusée.', {
      code: created.error.code,
    });
    // `23505` : l'adresse publique dérivée du titre est déjà prise. On ne
    // devine pas un suffixe à la place de l'utilisateur, qui choisirait
    // peut-être un tout autre titre.
    redirect(
      created.error.code === '23505'
        ? '/admin/sondages/nouveau?erreur=adresse'
        : '/admin/sondages/nouveau?erreur=creation',
    );
  }

  revalidatePath('/admin/sondages');
  redirect(`/admin/sondages/${created.value.id}`);
}

export async function deleteSurveyAction(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(formData.get('surveyId'));
  if (!surveyId.success) redirect('/admin/sondages?erreur=identifiant');

  const context = await resolveRequestContext();
  const deleted = await deleteSurvey(context, surveyId.data);
  if (!deleted.ok) {
    logger.warn('surveys.delete_refused', 'Suppression de formulaire refusée.', {
      code: deleted.error.code,
    });
    redirect('/admin/sondages?erreur=suppression');
  }

  revalidatePath('/admin/sondages');
  redirect('/admin/sondages?ok=supprime');
}

export async function deleteResponseAction(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(formData.get('surveyId'));
  const responseId = idSchema.safeParse(formData.get('responseId'));
  if (!surveyId.success) redirect('/admin/sondages?erreur=identifiant');
  if (!responseId.success) redirect(`/admin/sondages/${surveyId.data}/reponses?erreur=identifiant`);

  const context = await resolveRequestContext();
  const deleted = await softDeleteResponse(context, responseId.data);
  if (!deleted.ok) {
    logger.warn('responses.delete_refused', 'Suppression de réponse refusée.', {
      code: deleted.error.code,
    });
    redirect(`/admin/sondages/${surveyId.data}/reponses?erreur=suppression`);
  }

  revalidatePath(`/admin/sondages/${surveyId.data}/reponses`);
  redirect(`/admin/sondages/${surveyId.data}/reponses?ok=supprimee`);
}
