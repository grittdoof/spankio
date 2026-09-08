import { z } from 'zod';
import { attendanceSettingsSchema } from './attendance';
import { MAX_LENGTHS } from './limits';
import { publicPageSchema } from './public-page';

/**
 * Réglages d'affichage d'un sondage, rangés dans `surveys.settings` (jsonb).
 *
 * Ce qui vit ici plutôt qu'en colonne : tout ce qui est du texte d'interface ou
 * une option de présentation. Le critère est simple — une colonne dédiée
 * n'existe que si le RLS, une contrainte ou une requête en a besoin. Ajouter
 * un texte d'accueil ne doit jamais demander une migration.
 *
 * Tous les champs sont optionnels : un sondage sans réglage s'affiche avec les
 * textes par défaut de l'interface, jamais avec un vide.
 */

const text = (max: number) => z.string().trim().max(max);

export const surveySettingsSchema = z.object({
  /** Écran d'accueil. */
  welcome: z
    .object({
      /** Petite pastille au-dessus du titre (« Inscription », « Consultation »…). */
      badge: text(60).optional(),
      title: text(MAX_LENGTHS.label).optional(),
      description: text(MAX_LENGTHS.stepIntro).optional(),
      /** Libellé du bouton de départ. */
      ctaLabel: text(60).optional(),
    })
    .optional(),

  /** Écran de remerciement. */
  thankYou: z
    .object({
      title: text(MAX_LENGTHS.label).optional(),
      message: text(MAX_LENGTHS.stepIntro).optional(),
      /** Rappel de l'agenda et de l'itinéraire (mode événement). */
      showCalendar: z.boolean().optional(),
    })
    .optional(),

  /** Barre de progression collante. Vraie par défaut côté rendu. */
  showProgress: z.boolean().optional(),

  /**
   * Texte de consentement propre au sondage. En son absence, l'interface
   * compose un texte à partir des mentions RGPD du sondage — jamais une
   * formule vague.
   */
  consentText: text(MAX_LENGTHS.stepIntro).optional(),

  /**
   * Comptage des présents (mode événement). L'organisation DÉSIGNE ici la
   * question qui dit « je viens » et celle qui donne le nombre : la plateforme
   * est générique, elle ne peut pas les deviner.
   */
  attendance: attendanceSettingsSchema.optional(),

  /**
   * Page publique d'un événement : quels blocs s'affichent, et leur contenu
   * propre (déroulé, questions fréquentes, mot de l'organisateur…). Voir
   * `src/lib/survey/public-page.ts` — la liste enregistrée est celle des blocs
   * MASQUÉS, pour qu'un bloc ajouté plus tard ne naisse pas invisible.
   */
  publicPage: publicPageSchema.optional(),

  /**
   * Courriel de confirmation envoyé au répondant après son inscription.
   *
   * L'adresse du destinataire est DÉSIGNÉE, comme la présence et le nom : la
   * plateforme ne peut pas savoir laquelle des questions porte un courriel — un
   * formulaire peut en demander deux, celui de l'invité et celui de son
   * assistant. Sans désignation, rien n'est envoyé.
   */
  confirmation: z
    .object({
      enabled: z.boolean().optional(),
      emailField: z.string().trim().max(MAX_LENGTHS.identifier).optional(),
      /** Texte en tête du courriel. À défaut, une phrase neutre est composée. */
      text: text(MAX_LENGTHS.stepIntro).optional(),
    })
    .optional(),
});

export type SurveySettings = z.infer<typeof surveySettingsSchema>;

export type SettingsValidation =
  | { readonly ok: true; readonly settings: SurveySettings }
  | { readonly ok: false; readonly issues: readonly { path: string; message: string }[] };

export function validateSurveySettings(input: unknown): SettingsValidation {
  const parsed = surveySettingsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  return { ok: true, settings: parsed.data };
}
