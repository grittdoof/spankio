import { z } from 'zod';
import { MAX_LENGTHS } from './limits';

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
