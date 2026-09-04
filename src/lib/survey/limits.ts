/**
 * Plafonds appliqués aux schémas et aux soumissions.
 *
 * Ils existent pour une raison unique : une entrée publique non bornée est une
 * arme. Chaque valeur est volontairement basse, et le plafond de payload est
 * DÉLIBÉRÉMENT identique à celui de `public.submit_survey_response` — la
 * vérification est faite deux fois, en TypeScript puis en SQL, pour qu'aucun
 * chemin d'appel ne puisse la contourner.
 */

/** Taille maximale du corps JSON d'une soumission (aligné sur le SQL). */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Nombre maximal de champs répondus dans une soumission. */
export const MAX_RESPONSE_FIELDS = 200;

/** Longueurs maximales par type de champ. */
export const MAX_LENGTHS = {
  text: 500,
  email: 320,
  tel: 40,
  textarea: 5000,
  /** Valeur libre d'une option « autre ». */
  other: 500,
  /** Identifiant de champ, d'étape ou d'option. */
  identifier: 64,
  /** Libellé affiché. */
  label: 300,
  /** Texte d'aide. */
  hint: 500,
  /** Intitulé d'étape. */
  stepTitle: 200,
  /** Introduction d'étape. */
  stepIntro: 2000,
} as const;

/** Bornes structurelles du schéma d'un sondage. */
export const SCHEMA_LIMITS = {
  maxSteps: 50,
  maxFieldsPerStep: 50,
  maxFieldsTotal: 200,
  maxOptionsPerField: 100,
  maxGridRows: 50,
  maxGridColumns: 20,
  /** Profondeur maximale d'imbrication d'une condition. */
  maxConditionDepth: 4,
  /** Nombre maximal de sous-conditions dans un `all` / `any`. */
  maxConditionBranches: 10,
} as const;

/** Bornes des réponses à choix multiples. */
export const RESPONSE_LIMITS = {
  maxSelectedPerField: 50,
  maxGridRowsAnswered: 50,
} as const;

/** Bornes d'une échelle (`scale`). */
export const SCALE_BOUNDS = { min: 0, max: 100 } as const;
