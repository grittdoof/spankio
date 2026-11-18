import { answerText } from './answer-text';
import type { AttendanceSettings, NameCase } from './attendance';
import type { SurveyField } from './schema';

/**
 * Casse des noms affichés par le poste d'accueil.
 *
 * Besoin réel : à une porte, une liste où l'on lit « jean dupont »,
 * « JEAN DUPONT » et « Jean DUPONT » selon l'humeur de chaque répondant se
 * parcourt mal — l'œil cherche une forme, pas un mot. L'uniformité est donc
 * une aide à la lecture, pas une coquetterie.
 *
 * Trois décisions commandent tout ce fichier.
 *
 * **Rien n'est RÉÉCRIT en base, c'est un affichage.** `submitted_at` date
 * l'acte du répondant et `consent_text` prouve ce qui lui a été montré :
 * normaliser `data` détruirait la correspondance entre la preuve et ce
 * qu'elle prouve, pour un confort de lecture. L'export garde donc la saisie
 * telle quelle — c'est une pièce justificative et l'entrée de traitements en
 * aval — et seuls l'écran et le papier s'uniformisent.
 *
 * **La casse est DÉSIGNÉE, comme le nom lui-même.** La plateforme ne sait pas
 * laquelle des questions porte le nom de famille : « Nom » n'existe pas plus
 * que « Société » dans une plateforme générique, et le deviner d'après
 * l'intitulé serait la même faute que deviner la question de présence. La
 * désignation est attachée à la QUESTION et non à son rang dans
 * `identityFields` : changer l'ordre d'affichage (« Dupont Marie » plutôt que
 * « Marie Dupont ») ne doit pas faire passer le prénom en capitales.
 *
 * **C'est le TYPE de la question qui décide si une casse s'applique** — même
 * raisonnement que `partyModesFor`. Une adresse électronique désignée comme
 * nom (l'écran le propose) se lit « Jean.Dupont@exemple.fr » ; la mettre en
 * capitales d'initiale donnerait « Jean.dupont@exemple.fr », c'est-à-dire une
 * adresse fausse à l'œil. Seule une question à saisie libre `text` reçoit donc
 * une casse, et toutes les autres sont rendues telles qu'elles ont été
 * saisies.
 */

/** Casses proposées, dans l'ordre d'affichage. */
export const NAME_CASES: readonly NameCase[] = ['capital', 'upper', 'raw'];

/**
 * Appliquée à une question à saisie libre quand rien n'est désigné.
 *
 * « Initiale majuscule » plutôt que « tel que saisi » : la liste est alors
 * uniforme sans que personne n'ait eu à régler quoi que ce soit, ce qui est le
 * besoin. Contrepartie assumée, et dite à l'écran : une question qui porte un
 * sigle (« SNCF ») sortira « Sncf », et l'organisation choisit alors « tel que
 * saisi ». La plateforme ne peut pas distinguer un sigle d'un nom crié.
 */
export const DEFAULT_NAME_CASE: NameCase = 'capital';

export const NAME_CASE_LABELS: Readonly<Record<NameCase, string>> = {
  capital: 'Initiale majuscule — « Dupont »',
  upper: 'Majuscules — « DUPONT »',
  raw: 'Tel que saisi — « dupont », « DUPONT »',
};

/** Une casse ne s'applique qu'à une saisie libre : voir l'en-tête du module. */
export function acceptsNameCase(field: SurveyField | undefined): boolean {
  return field?.type === 'text';
}

/**
 * Casse RÉELLEMENT appliquée à une question, désignation comprise.
 *
 * Seule lecture de `attendance.nameCase` de toute l'application : l'écran de
 * réglages, la liste d'accueil, le listing papier et le titre de l'écran de
 * correction répondent donc à la même question. Une désignation posée sur une
 * question qui n'en admet pas — il suffit de refaire ses questions pour que
 * « Nom » devienne une adresse électronique — est IGNORÉE, pas appliquée :
 * muet plutôt que faux, comme toutes les désignations du module.
 */
export function nameCaseOf(
  settings: AttendanceSettings,
  field: SurveyField | undefined,
): NameCase {
  if (!acceptsNameCase(field) || !field) return 'raw';
  return settings.nameCase?.[field.id] ?? DEFAULT_NAME_CASE;
}

/**
 * Première lettre de chaque mot en majuscule, le reste en minuscules.
 *
 * Les séparateurs sont ceux d'un nom et non ceux d'une phrase : l'espace, le
 * trait d'union et l'apostrophe — « jean-pierre » donne « Jean-Pierre » et
 * « o'brien » donne « O'Brien », alors qu'un simple `toUpperCase` du premier
 * caractère donnerait « Jean-pierre ». Les deux apostrophes sont acceptées :
 * un clavier de téléphone pose la typographique, un clavier de bureau la
 * droite, et les deux arrivent dans la même liste.
 *
 * Les particules ne sont pas rabaissées : « DE LA FONTAINE » ressort « De La
 * Fontaine ». Décider que « de » est une particule et non un nom demanderait
 * une connaissance que la plateforme n'a pas, et se tromperait sur les noms
 * qui commencent réellement par là.
 */
function capitalise(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_match, separator: string, letter: string) =>
      `${separator}${letter.toLocaleUpperCase('fr-FR')}`,
    );
}

/**
 * Applique une casse à une réponse déjà lisible.
 *
 * Les espaces en trop sont résorbés au passage — « Jean   Dupont » devient
 * « Jean Dupont » — parce qu'une liste uniforme ne l'est pas si deux rangées
 * identiques se décalent l'une de l'autre. « Tel que saisi » ne touche
 * évidemment à rien : c'est sa raison d'être.
 */
export function applyNameCase(value: string, nameCase: NameCase): string {
  if (nameCase === 'raw') return value;
  const tidy = value.trim().replace(/\s+/gu, ' ');
  return nameCase === 'upper' ? tidy.toLocaleUpperCase('fr-FR') : capitalise(tidy);
}

/**
 * Le nom affiché d'une personne, composé des questions désignées.
 *
 * UNE seule composition pour toute l'application — la liste d'accueil, le
 * listing papier, la rangée de l'accompagnant et le titre de l'écran de
 * correction. Elle existait déjà en double, recopiée dans l'écran de
 * correction : les deux ont divergé au premier réglage ajouté ici, ce qui est
 * exactement ce que la règle du module annonce.
 *
 * Une réponse vide est SAUTÉE, jamais rendue par un blanc : un invité qui n'a
 * pas donné son prénom s'appelle « Dupont », pas « Dupont ».
 */
export function composeName(
  fields: readonly SurveyField[],
  data: Readonly<Record<string, unknown>>,
  settings: AttendanceSettings,
): string | null {
  const parts: string[] = [];
  for (const field of fields) {
    const text = answerText(field, data);
    if (text === null || text === '') continue;
    const cased = applyNameCase(text, nameCaseOf(settings, field));
    if (cased !== '') parts.push(cased);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
