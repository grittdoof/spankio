import { OTHER_VALUE, otherKey, type SurveyField } from './schema';

/**
 * Rendu LISIBLE d'une réponse à une question.
 *
 * Sorti de `guests.ts` le jour où le courriel de confirmation a eu besoin de la
 * même chose : il n'y a aucune raison qu'une réponse se lise autrement dans une
 * liste d'accueil, dans un courriel ou dans un export. Deux implémentations
 * auraient fini par afficher `option_2` d'un côté et « 2 » de l'autre.
 */

/**
 * Texte lisible d'une réponse à une question, pour l'afficher dans une rangée.
 *
 * Les choix sont rendus par leur LIBELLÉ, jamais par leur valeur : celle-ci est
 * un identifiant figé à la création (`option_1`) qui ne veut rien dire pour une
 * personne. Une saisie libre « autre » est reprise telle quelle.
 */
export function answerText(
  field: SurveyField,
  data: Readonly<Record<string, unknown>>,
): string | null {
  const value = data[field.id];
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'string') {
    if (field.type === 'select' || field.type === 'radio') {
      if (value === OTHER_VALUE) {
        const free = data[otherKey(field.id)];
        return typeof free === 'string' && free !== '' ? free : null;
      }
      const option = field.options.find((candidate) => candidate.value === value);
      return option ? option.label : null;
    }
    return value;
  }

  if (typeof value === 'number') return String(value);

  // Choix multiple : les libellés, séparés par une virgule. Utile surtout à la
  // recherche — la seconde ligne d'une rangée ne propose jamais ce type.
  if (Array.isArray(value)) {
    const labels = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => {
        if (entry === OTHER_VALUE) {
          const free = data[otherKey(field.id)];
          return typeof free === 'string' ? free : '';
        }
        if (field.type === 'checkbox' || field.type === 'select' || field.type === 'radio') {
          return field.options.find((candidate) => candidate.value === entry)?.label ?? '';
        }
        return entry;
      })
      .filter((label) => label !== '');
    return labels.length > 0 ? labels.join(', ') : null;
  }

  return null;
}
