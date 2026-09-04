/**
 * Fabrication d'identifiants d'URL.
 *
 * Le résultat doit satisfaire les contraintes SQL `organisations_slug_format`
 * et `surveys_slug_format` : minuscules, chiffres et tirets, ni au début ni à
 * la fin, 62 caractères au plus pour une organisation.
 */

const MAX_LENGTH = 62;

export function slugify(value: string, maxLength = MAX_LENGTH): string {
  const normalised = value
    .normalize('NFD')
    // Retire les diacritiques : « Événement » → « evenement ».
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalised === '') return '';
  return normalised.slice(0, maxLength).replace(/-+$/g, '');
}

/** Vrai si la valeur est déjà un identifiant acceptable pour la base. */
export function isValidSlug(value: string, maxLength = MAX_LENGTH): boolean {
  return (
    value.length >= 1 &&
    value.length <= maxLength &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  );
}

/**
 * Ajoute un suffixe numéroté tant que l'identifiant est déjà pris.
 * `taken` est consulté par l'appelant (qui seul sait interroger la base).
 */
export function uniqueSlug(
  base: string,
  taken: (candidate: string) => boolean,
  fallback = 'organisation',
  maxLength = MAX_LENGTH,
): string {
  const root = slugify(base, maxLength) || fallback;
  if (!taken(root)) return root;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const marker = `-${suffix}`;
    const candidate = `${root.slice(0, maxLength - marker.length).replace(/-+$/g, '')}${marker}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`Impossible de dériver un identifiant unique depuis « ${base} »`);
}
