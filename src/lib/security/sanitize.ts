/**
 * Normalisation des valeurs textuelles reçues du public.
 *
 * Ce module ne fait PAS d'échappement HTML : React échappe déjà tout ce qu'il
 * rend, et `dangerouslySetInnerHTML` est interdit par ESLint. Il fait autre
 * chose, tout aussi nécessaire : retirer les caractères qui n'ont rien à faire
 * dans une donnée saisie et qui servent à tromper la lecture d'un export ou
 * d'un écran d'administration.
 */

/**
 * Plages de points de code retirées de toute valeur textuelle, exprimées en
 * nombres plutôt qu'en littéraux d'expression régulière : un source contenant
 * de vrais caractères de contrôle est illisible et se corrompt au copier-coller.
 */
const FORBIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  // Contrôle C0, sauf tabulation (0x09) et sauts de ligne (0x0A).
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  // Suppression + contrôle C1.
  [0x7f, 0x9f],
  // Largeur nulle et marques de direction : un RLO (0x202E) inséré dans une
  // valeur permet d'afficher « gnp.exe » pour « exe.png ». Ce n'est pas
  // théorique, c'est une technique d'usurpation courante.
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  // Espace insécable de largeur nulle / marque d'ordre des octets.
  [0xfeff, 0xfeff],
];

function isForbidden(codePoint: number): boolean {
  return FORBIDDEN_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to);
}

/** Retire les caractères interdits, en itérant par point de code. */
function stripForbidden(value: string): string {
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isForbidden(codePoint)) {
      result += character;
    }
  }
  return result;
}

export interface SanitizeOptions {
  /** Autorise les sauts de ligne (champs `textarea`). */
  multiline?: boolean;
  /** Longueur maximale conservée, en points de code. */
  maxLength?: number;
}

/**
 * Nettoie une chaîne : normalisation Unicode, retrait des caractères de
 * contrôle et invisibles, uniformisation des sauts de ligne, découpage.
 */
export function sanitizeText(value: string, options: SanitizeOptions = {}): string {
  // NFC : « é » composé et « e » suivi d'un accent combinant deviennent la
  // même chaîne. Sans cette étape, deux réponses identiques à l'œil
  // passeraient l'anti-doublon.
  let result = stripForbidden(value.normalize('NFC').replace(/\r\n?/g, '\n'));

  if (options.multiline) {
    // Trois sauts de ligne consécutifs ou plus n'ajoutent rien.
    result = result.replace(/\n{3,}/g, '\n\n');
  } else {
    result = result.replace(/\n/g, ' ');
  }

  // Espaces multiples réduits ligne par ligne, sauts de ligne conservés.
  result = result
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .trim();

  if (options.maxLength !== undefined) {
    // Découpage par points de code : ne coupe pas un emoji en deux.
    result = [...result].slice(0, options.maxLength).join('');
  }

  return result;
}

/** Vrai si la chaîne ne contient rien d'exploitable après nettoyage. */
export function isBlank(value: string): boolean {
  return sanitizeText(value) === '';
}

/**
 * Normalisation d'une valeur servant de clé anti-doublon : casse et espaces
 * ignorés, pour que « Jean@Exemple.test » et « jean@exemple.test  » désignent
 * la même personne. Le hachage lui-même est fait en SQL (`app.dedup_hash`).
 */
export function normaliseDedupValue(value: string): string {
  return sanitizeText(value).toLowerCase();
}
