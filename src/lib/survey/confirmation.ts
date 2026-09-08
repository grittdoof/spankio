import { z } from 'zod';
import type { SurveyField, SurveySchema } from './schema';

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
export function emailCandidates(schema: SurveySchema): SurveyField[] {
  return schema.steps.flatMap((step) => step.fields).filter((field) => field.type === 'email');
}

/** L'envoi est-il configuré au point de partir ? */
export function isConfirmationConfigured(
  settings: ConfirmationSettings | undefined,
): boolean {
  return Boolean(settings?.enabled && settings.emailField);
}

/**
 * Blocs du COURRIEL de confirmation : lesquels s'affichent.
 *
 * Mêmes décisions que pour la page publique (`public-page.ts`), et pour les
 * mêmes raisons :
 *
 *  1. **La liste enregistrée est celle des blocs MASQUÉS.** Un bloc ajouté plus
 *     tard naîtrait invisible sur tous les formulaires existants avec une liste
 *     d'autorisation, et personne ne saurait qu'il existe.
 *  2. **Un interrupteur ne fabrique pas de contenu.** Un bloc autorisé mais
 *     vide ne s'affiche pas : l'organisation n'a pas déposé de visuel, le champ
 *     « Accès » est vide, l'événement n'a pas de date.
 *  3. **Aucun bloc n'invente de donnée.** Ce sont les mêmes valeurs que la page
 *     publique, mises en forme par les mêmes fonctions.
 *
 * L'ordre de ce tableau est l'ordre du courriel : il n'existe pas de second
 * endroit où il serait redéfini.
 */
export const CONFIRMATION_BLOCKS = [
  /** Le visuel de l'événement, en tête. */
  'banner',
  /** La date de début. */
  'when',
  /** L'heure de fin, sous la date. */
  'endTime',
  /** Le lieu : intitulé et adresse. */
  'place',
  /** Le texte du champ « Accès ». */
  'access',
  /** Les liens d'ajout à l'agenda. */
  'calendar',
  /** Le rappel de ce que le répondant a saisi. */
  'recap',
  /** Les liens d'itinéraire. */
  'directions',
  /** Le bouton « Revoir l'invitation ». */
  'link',
  /** Les coordonnées de l'organisation, en petit dans le pied de page. */
  'contact',
] as const;

export type ConfirmationBlock = (typeof CONFIRMATION_BLOCKS)[number];

export const confirmationBlockEnum = z.enum(CONFIRMATION_BLOCKS);

export const CONFIRMATION_BLOCK_LABELS: Readonly<
  Record<ConfirmationBlock, { name: string; desc: string }>
> = {
  banner: {
    name: 'Le visuel',
    desc: 'L’image de l’événement, en tête du courriel.',
  },
  when: {
    name: 'La date',
    desc: 'Le jour et l’heure de début, dans le fuseau de l’événement.',
  },
  endTime: {
    name: 'L’heure de fin',
    desc: 'Affichée sous la date. À fermer quand la fin n’est qu’indicative.',
  },
  place: { name: 'Le lieu', desc: 'L’intitulé et l’adresse.' },
  access: {
    name: 'L’accès',
    desc: 'Le texte saisi dans « Accès », le même que sur la page publique.',
  },
  calendar: {
    name: 'L’agenda',
    desc: 'Les liens Google Agenda, Outlook et le fichier .ics.',
  },
  recap: {
    name: 'Les réponses saisies',
    desc: 'Ce que la personne a répondu, pour qu’elle le vérifie.',
  },
  directions: {
    name: 'L’itinéraire',
    desc: 'Les liens Google Maps, Plans et OpenStreetMap.',
  },
  link: {
    name: 'Le lien vers l’invitation',
    desc: 'Le bouton « Revoir l’invitation ».',
  },
  contact: {
    name: 'Les coordonnées de l’organisation',
    desc: 'Courriel, téléphone et adresse postale, en petit en pied de page.',
  },
};

export const confirmationSchema = z.object({
  enabled: z.boolean().optional(),
  emailField: z.string().trim().max(64).optional(),
  /** Texte en tête du courriel. À défaut, une phrase neutre est composée. */
  text: z.string().trim().max(2000).optional(),
  /**
   * Blocs explicitement masqués. Liste de MASQUAGE, jamais d'autorisation :
   * voir la décision 1.
   */
  hidden: z.array(confirmationBlockEnum).max(CONFIRMATION_BLOCKS.length).optional(),
});

export type ConfirmationSettings = z.infer<typeof confirmationSchema>;

/**
 * Le bloc est-il autorisé à l'affichage ?
 *
 * Autorisé ne veut pas dire affiché : un bloc sans contenu ne s'affiche pas,
 * et c'est le gabarit qui l'écarte — un interrupteur ne fabrique rien.
 */
export function isConfirmationBlockShown(
  settings: ConfirmationSettings | undefined,
  block: ConfirmationBlock,
): boolean {
  return !(settings?.hidden ?? []).includes(block);
}

/**
 * Ferme ou ouvre un bloc, en renvoyant la liste des blocs masqués.
 *
 * La liste est TOUJOURS renvoyée complète et normalisée : le premier clic fige
 * l'état de tous les blocs, sinon fermer l'un rouvrirait ceux qu'un futur
 * défaut par défaut aurait fermés. C'est la même règle que pour la page
 * publique.
 */
export function toggleConfirmationBlock(
  settings: ConfirmationSettings | undefined,
  block: ConfirmationBlock,
  shown: boolean,
): ConfirmationBlock[] {
  const hidden = new Set(settings?.hidden ?? []);
  if (shown) hidden.delete(block);
  else hidden.add(block);
  return CONFIRMATION_BLOCKS.filter((candidate) => hidden.has(candidate));
}
