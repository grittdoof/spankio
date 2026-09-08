import type { SurveyField, SurveySchema } from './schema';

/**
 * DÉSIGNATION DE LA CLÉ ANTI-DOUBLON.
 *
 * `surveys.dedup_field` est un identifiant de question, pas une colonne : le
 * schéma vit dans du `jsonb` et rien, en base, ne garantit que la question
 * désignée existe encore. Refaire ses questions suffit à laisser une clé qui
 * ne pointe plus sur rien.
 *
 * Ce module est la SEULE lecture de cette désignation — écrans de création et
 * d'édition, soumission publique. Trois lectures auraient divergé, et c'est
 * exactement ce qui s'est produit : la liste de l'éditeur excluait les champs
 * libres, celle de `builder.ts` les acceptait.
 */

/**
 * Champs utilisables comme clé d'unicité.
 *
 * Seuls un courriel et un téléphone identifient une personne. Un texte libre
 * non : deux invités peuvent porter le même nom, et le second serait refusé
 * sans jamais comprendre pourquoi.
 */
export function dedupCandidates(schema: SurveySchema): SurveyField[] {
  return schema.steps
    .flatMap((step) => step.fields)
    .filter((field) => field.type === 'email' || field.type === 'tel');
}

export type DedupDesignation =
  /** Aucune clé : chaque envoi est enregistré. */
  | { readonly kind: 'off' }
  /** La question désignée existe au schéma. */
  | { readonly kind: 'field'; readonly field: SurveyField }
  /** La question désignée a disparu du schéma. L'unicité est INAPPLICABLE. */
  | { readonly kind: 'missing'; readonly id: string };

/** Que vaut la désignation enregistrée, face au schéma d'aujourd'hui ? */
export function dedupDesignation(
  schema: SurveySchema,
  dedupField: string | null | undefined,
): DedupDesignation {
  if (!dedupField) return { kind: 'off' };

  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (field.id === dedupField) return { kind: 'field', field };
    }
  }

  return { kind: 'missing', id: dedupField };
}

/**
 * L'unicité ne couvre-t-elle qu'une PARTIE des réponses ?
 *
 * Une question facultative peut être sautée, une question conditionnée n'est
 * pas posée à tout le monde : dans les deux cas la réponse n'emporte aucune
 * clé, donc rien ne l'empêche d'être renvoyée. Ce n'est pas un défaut — c'est
 * un coût, qui se dit avant d'être choisi.
 */
export function dedupCoverageIsPartial(field: SurveyField): boolean {
  return field.condition !== undefined || !field.required;
}
