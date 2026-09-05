import { validateSurveySchema, type SurveySchema } from './schema';

/**
 * Ce qui manque pour publier un formulaire.
 *
 * Cette liste existe parce que « Publication impossible » ne dit rien. Le
 * serveur refuse déjà la publication incomplète et renvoie les motifs, mais
 * l'utilisateur les découvre alors APRÈS avoir cliqué — et parfois après avoir
 * travaillé une heure. La même liste est donc calculée en continu et affichée
 * pendant la composition.
 *
 * Une seule définition, partagée par l'écran et par le contrôle serveur
 * (`updateSurvey`) : deux listes divergeraient, et l'écran finirait par
 * annoncer « prêt à publier » sur un formulaire que le serveur refuse.
 */

export interface PublicationRequirement {
  /** Identifiant stable, pour associer l'exigence à un champ de l'écran. */
  readonly key: 'schema' | 'purpose' | 'legalBasis' | 'retentionDays' | 'eventStartsAt';
  /** Ce qui manque, dit à l'utilisateur. */
  readonly label: string;
  /** Où le corriger. */
  readonly where: string;
}

export interface PublicationInput {
  readonly kind: 'survey' | 'event';
  readonly schema: SurveySchema;
  readonly purpose: string | null;
  readonly legalBasis: string | null;
  readonly retentionDays: number | null;
  readonly eventStartsAt: string | null;
}

/** Exigences non satisfaites, dans l'ordre où il est naturel de les traiter. */
export function missingForPublication(
  input: PublicationInput,
): readonly PublicationRequirement[] {
  const missing: PublicationRequirement[] = [];

  if (!validateSurveySchema(input.schema).ok) {
    missing.push({
      key: 'schema',
      label: 'Au moins une question',
      where: 'Section « Questions »',
    });
  }

  if (!input.purpose || input.purpose.trim() === '') {
    missing.push({
      key: 'purpose',
      label: 'La finalité de la collecte',
      where: 'Section « Informations aux répondants »',
    });
  }

  if (!input.legalBasis) {
    missing.push({
      key: 'legalBasis',
      label: 'La base légale',
      where: 'Section « Informations aux répondants »',
    });
  }

  if (!input.retentionDays) {
    missing.push({
      key: 'retentionDays',
      label: 'La durée de conservation',
      where: 'Section « Informations aux répondants »',
    });
  }

  // Un événement sans date n'aurait ni fichier d'agenda ni itinéraire : la
  // page publique afficherait une inscription à un événement sans dire quand.
  if (input.kind === 'event' && !input.eventStartsAt) {
    missing.push({
      key: 'eventStartsAt',
      label: 'La date de l’événement',
      where: 'Écran « Réglages de l’événement »',
    });
  }

  return missing;
}

export function isPublishable(input: PublicationInput): boolean {
  return missingForPublication(input).length === 0;
}
