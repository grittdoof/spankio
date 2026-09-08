import { answerText } from './answer-text';
import { visibleFields } from './conditions';
import type { SurveySchema } from './schema';

/**
 * Récapitulatif de ce qu'un répondant a saisi, pour lui être relu.
 *
 * Sert au courriel de confirmation : « voici ce que vous avez répondu ». Trois
 * règles, qui découlent toutes du fait que le destinataire est la personne
 * concernée elle-même.
 *
 *  1. **Seules les questions RÉELLEMENT posées.** Le moteur de conditions
 *     décide : une question masquée n'a pas été vue, la faire figurer dans un
 *     récapitulatif laisserait croire à un oubli.
 *  2. **Les libellés, jamais les valeurs.** `option_2` ne veut rien dire ; « 2 »
 *     si. C'est `answerText` qui s'en charge, la même fonction que la liste
 *     d'accueil.
 *  3. **Les réponses vides sont omises.** « Téléphone : — » n'apprend rien, et
 *     un récapitulatif rempli de tirets fait douter de ce qui a été enregistré.
 */

/**
 * Plafond par valeur. Une réponse libre peut faire 5 000 caractères : la
 * recopier en entier dans un courriel de confirmation le rendrait illisible,
 * alors que son rôle est de faire vérifier d'un coup d'œil.
 */
const MAX_VALUE = 300;

export interface RecapLine {
  readonly label: string;
  readonly value: string;
}

export function submittedRecap(
  schema: SurveySchema,
  data: Readonly<Record<string, unknown>>,
): RecapLine[] {
  const lines: RecapLine[] = [];

  for (const { field } of visibleFields(schema, data)) {
    const value = answerText(field, data);
    if (!value) continue;
    lines.push({
      label: field.label,
      value:
        value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE).trimEnd()}…` : value,
    });
  }

  return lines;
}
