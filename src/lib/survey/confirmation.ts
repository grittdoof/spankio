import type { SurveySchema } from './schema';
import type { SurveySettings } from './settings';

/**
 * Courriel de confirmation : à qui l'envoyer.
 *
 * L'adresse est DÉSIGNÉE, comme la présence et le nom de l'invité. Deviner
 * serait tentant — la plupart des formulaires n'ont qu'une question de type
 * « adresse électronique » — mais un formulaire peut en demander deux, celle de
 * l'invité et celle de son assistant, et envoyer la confirmation à la mauvaise
 * ne se verrait jamais côté organisation.
 */

/**
 * Questions pouvant porter l'adresse du destinataire : uniquement le type
 * « adresse électronique ».
 *
 * Un champ texte libre n'est pas retenu, même si un courriel peut y être
 * saisi : il n'est pas validé comme une adresse, et l'envoi échouerait une
 * fois sur deux sans que personne ne le sache.
 */
export function emailCandidates(schema: SurveySchema) {
  return schema.steps.flatMap((step) => step.fields).filter((field) => field.type === 'email');
}

/** L'envoi est-il configuré au point de partir ? */
export function isConfirmationConfigured(
  settings: SurveySettings['confirmation'],
): boolean {
  return Boolean(settings?.enabled && settings.emailField);
}
