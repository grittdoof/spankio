'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { creationUrl, guideUrl } from '@/lib/admin/wizard';
import { textFieldOrEmpty, trimmedField } from '@/lib/api/form';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { logger } from '@/lib/logger';
import {
  createSurvey,
  createSurveySchema,
  LEGAL_BASES,
  updateSurvey,
} from '@/lib/services/surveys';

/**
 * Actions du parcours guidé.
 *
 * Chaque écran est un `<form action>` classique : le parcours fonctionne sans
 * JavaScript, et un rafraîchissement ne perd rien puisque l'état vit dans
 * l'URL et, à partir du quatrième écran, en base.
 *
 * Aucune vérification de rôle ici : le RLS refuse déjà l'écriture à qui n'a ni
 * le rôle ni le module. Un second contrôle donnerait deux vérités à maintenir,
 * et c'est toujours la plus permissive qu'on oublie de mettre à jour.
 */

const idSchema = z.string().uuid();
const kindSchema = z.enum(['survey', 'event']);

/**
 * Écran 1 → 2 : le type choisi passe dans l'URL, rien n'est encore créé.
 *
 * `async` sans `await` : une action serveur DOIT être asynchrone, et ces deux
 * premiers écrans ne touchent ni la base ni le réseau — ils ne font que
 * recomposer une URL.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function chooseKind(formData: FormData): Promise<void> {
  const kind = kindSchema.safeParse(textFieldOrEmpty(formData, 'kind'));
  if (!kind.success) redirect(creationUrl('type', null));
  redirect(creationUrl('modele', { kind: kind.data, templateKey: null }));
}

/** Écran 2 → 3 : le modèle choisi rejoint l'URL. Voir `chooseKind`. */
// eslint-disable-next-line @typescript-eslint/require-await
export async function chooseTemplate(formData: FormData): Promise<void> {
  const kind = kindSchema.safeParse(textFieldOrEmpty(formData, 'kind'));
  if (!kind.success) redirect(creationUrl('type', null));

  const raw = textFieldOrEmpty(formData, 'templateKey');
  const templateKey = raw === '' || raw === 'vierge' ? null : raw;

  redirect(creationUrl('titre', { kind: kind.data, templateKey }));
}

/** Écran 3 : le brouillon est créé, puis le parcours continue en base. */
export async function createDraft(formData: FormData): Promise<void> {
  const kind = kindSchema.safeParse(textFieldOrEmpty(formData, 'kind'));
  if (!kind.success) redirect(creationUrl('type', null));

  const rawTemplate = textFieldOrEmpty(formData, 'templateKey');
  const templateKey = rawTemplate === '' || rawTemplate === 'vierge' ? null : rawTemplate;
  const choices = { kind: kind.data, templateKey };

  const parsed = createSurveySchema.safeParse({
    title: textFieldOrEmpty(formData, 'title'),
    kind: kind.data,
    ...(templateKey ? { templateKey } : {}),
  });
  if (!parsed.success) {
    redirect(`${creationUrl('titre', choices)}&erreur=titre`);
  }

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
    redirect(`${creationUrl('titre', choices)}&erreur=rattachement`);
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
      `${creationUrl('titre', choices)}&erreur=${
        created.error.code === '23505' ? 'adresse' : 'creation'
      }`,
    );
  }

  revalidatePath('/admin/sondages');
  redirect(guideUrl(created.value.id, 'informations'));
}

const informationsSchema = z.object({
  purpose: z.string().trim().min(10).max(2000),
  legalBasis: z.enum(LEGAL_BASES),
  retentionDays: z.number().int().min(1).max(3650),
  recipients: z.string().trim().max(2000).nullable(),
});

/** Écran 4 : les mentions d'information, exigées pour publier. */
export async function saveInformations(formData: FormData): Promise<void> {
  const surveyId = idSchema.safeParse(formData.get('surveyId'));
  if (!surveyId.success) redirect(creationUrl('type', null));

  const rawRetention = textFieldOrEmpty(formData, 'retentionDays');
  const parsed = informationsSchema.safeParse({
    purpose: textFieldOrEmpty(formData, 'purpose'),
    legalBasis: textFieldOrEmpty(formData, 'legalBasis'),
    retentionDays: rawRetention === '' ? Number.NaN : Number(rawRetention),
    recipients: trimmedField(formData, 'recipients'),
  });

  if (!parsed.success) {
    // Le premier champ en défaut suffit : l'écran n'en demande que quatre, et
    // une liste d'erreurs sur un écran unique se lit moins bien qu'un repère.
    const field = parsed.error.issues[0]?.path[0];
    redirect(`${guideUrl(surveyId.data, 'informations')}?erreur=${String(field ?? 'saisie')}`);
  }

  const context = await resolveRequestContext();
  const updated = await updateSurvey(context, surveyId.data, {
    purpose: parsed.data.purpose,
    legalBasis: parsed.data.legalBasis,
    retentionDays: parsed.data.retentionDays,
    recipients: parsed.data.recipients,
  });

  if (!updated.ok) {
    logger.warn('surveys.informations_refused', 'Mentions refusées.', {
      code: updated.error.code,
    });
    redirect(`${guideUrl(surveyId.data, 'informations')}?erreur=enregistrement`);
  }

  redirect(guideUrl(surveyId.data, 'pret'));
}
