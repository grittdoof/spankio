/**
 * Lecture de champs de formulaire.
 *
 * `FormData.get()` renvoie `string | File | null` : un client peut envoyer une
 * partie fichier là où l'application attend du texte. Convertir sans vérifier
 * produirait la chaîne « [object File] » et la ferait passer pour une saisie
 * valide. Ces fonctions refusent ce cas au lieu de le déguiser.
 */

export function textField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
}

/** Champ texte obligatoire, ramené à une chaîne vide s'il est absent. */
export function textFieldOrEmpty(formData: FormData, name: string): string {
  return textField(formData, name) ?? '';
}

/** Champ texte nettoyé, ou `null` s'il est vide après nettoyage. */
export function trimmedField(formData: FormData, name: string): string | null {
  const value = textField(formData, name)?.trim();
  return value === undefined || value === '' ? null : value;
}

/** Valeurs multiples d'une même clé (cases à cocher). */
export function textFields(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === 'string');
}
