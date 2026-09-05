import { isValidSlug, slugify } from '@/lib/utils/slug';
import type { PublicationRequirement } from './publication';

/**
 * Parcours guidé d'ÉDITION d'un formulaire.
 *
 * Même principe que la création — une préoccupation par écran — mais l'état
 * vit ici côté client et non dans l'URL, pour une raison précise : l'édition
 * ne s'enregistre qu'au bouton « Enregistrer ». Un changement d'étape qui
 * rechargerait la page perdrait le brouillon en cours de saisie.
 *
 * Ce module est PUR : il décrit les étapes et dit ce qui bloque le passage à
 * la suivante. C'est ce qui permet de tester le blocage sans monter
 * l'interface — et de n'avoir qu'une seule définition de « champ obligatoire
 * mal rempli », partagée par le blocage et par l'affichage des erreurs.
 */

export const EDITOR_STEPS = [
  {
    key: 'identite',
    label: 'Identité',
    question: 'Comment se présente ce formulaire ?',
    lead: 'Le titre et la description s’affichent sur l’écran d’accueil vu par les répondants.',
  },
  {
    key: 'questions',
    label: 'Questions',
    question: 'Que voulez-vous demander ?',
    lead: 'Les répondants voient une question par écran. Les étapes regroupent celles qui vont ensemble.',
  },
  {
    key: 'informations',
    label: 'Informations',
    question: 'Qu’allez-vous dire aux répondants ?',
    lead: 'Ces mentions sont affichées avant l’envoi, puis conservées avec chaque réponse comme preuve de ce qui a été annoncé.',
  },
  {
    key: 'publication',
    label: 'Publication',
    question: 'Prêt à recevoir des réponses ?',
    lead: 'Vérifiez ce qui reste à faire, puis publiez. Un formulaire publié est accessible à son adresse publique.',
  },
] as const;

export type EditorStepKey = (typeof EDITOR_STEPS)[number]['key'];

export const EDITOR_TOTAL = EDITOR_STEPS.length;

export function editorStepNumber(key: EditorStepKey): number {
  return EDITOR_STEPS.findIndex((step) => step.key === key) + 1;
}

export function editorStep(key: EditorStepKey): (typeof EDITOR_STEPS)[number] {
  const found = EDITOR_STEPS.find((step) => step.key === key);
  if (!found) throw new Error(`Étape d'édition inconnue : ${key}`);
  return found;
}

/** Étape suivante, ou `null` sur la dernière. */
export function nextEditorStep(key: EditorStepKey): EditorStepKey | null {
  const index = EDITOR_STEPS.findIndex((step) => step.key === key);
  return EDITOR_STEPS[index + 1]?.key ?? null;
}

/** Étape précédente, ou `null` sur la première. */
export function previousEditorStep(key: EditorStepKey): EditorStepKey | null {
  const index = EDITOR_STEPS.findIndex((step) => step.key === key);
  return index > 0 ? (EDITOR_STEPS[index - 1]?.key ?? null) : null;
}

// ---------------------------------------------------------------------------
// Blocage du passage à l'étape suivante
// ---------------------------------------------------------------------------

/**
 * Valeurs vérifiées avant de laisser avancer. Volontairement plus étroit que
 * le brouillon complet : une fonction pure ne doit dépendre que de ce qu'elle
 * examine.
 */
export interface EditorStepValues {
  readonly title: string;
  readonly slug: string;
  readonly purpose: string | null;
  readonly legalBasis: string | null;
  readonly retentionDays: number | null;
}

export interface StepBlock {
  /** Erreurs par identifiant de champ, tel que rendu dans l'écran. */
  readonly errors: Readonly<Record<string, string>>;
  /** Premier champ en défaut, sur lequel poser le focus. */
  readonly firstField: string;
}

export type StepCheck = { readonly ok: true } | { readonly ok: false; readonly block: StepBlock };

/**
 * Champs obligatoires par étape.
 *
 * Ce qui est vérifié ici est ce qui EMPÊCHERA d'enregistrer ou de publier —
 * pas ce qui serait souhaitable. Bloquer sur un champ facultatif
 * transformerait un guide en obstacle, et la première réaction serait de
 * remplir n'importe quoi pour passer.
 */
export function checkEditorStep(step: EditorStepKey, values: EditorStepValues): StepCheck {
  const errors: Record<string, string> = {};

  if (step === 'identite') {
    const title = values.title.trim();
    if (title.length < 2) {
      errors['titre'] = 'Indiquez un titre d’au moins deux caractères.';
    } else if (title.length > 200) {
      errors['titre'] = 'Le titre ne doit pas dépasser 200 caractères.';
    }

    // L'adresse est dérivée du titre si elle est vide ; on ne refuse donc
    // qu'une saisie explicite dont il ne reste rien d'utilisable.
    const raw = values.slug.trim();
    if (raw !== '' && !isValidSlug(slugify(raw, 82), 82)) {
      errors['slug'] =
        'Cette adresse n’est pas utilisable. Utilisez des lettres, des chiffres et des tirets.';
    }
  }

  if (step === 'informations') {
    if (!values.purpose || values.purpose.trim().length < 10) {
      errors['purpose'] = 'Décrivez la finalité en une phrase au moins.';
    }
    if (!values.legalBasis) {
      errors['legalBasis'] = 'Choisissez la base légale de cette collecte.';
    }
    if (
      values.retentionDays === null ||
      !Number.isInteger(values.retentionDays) ||
      values.retentionDays < 1 ||
      values.retentionDays > 3650
    ) {
      errors['retentionDays'] = 'Indiquez une durée entre 1 et 3650 jours.';
    }
  }

  const first = Object.keys(errors)[0];
  if (first === undefined) return { ok: true };
  return { ok: false, block: { errors, firstField: first } };
}

/** Étape où corriger une exigence de publication non satisfaite. */
export function stepForRequirement(
  requirement: PublicationRequirement,
): EditorStepKey | null {
  switch (requirement.key) {
    case 'schema':
      return 'questions';
    case 'purpose':
    case 'legalBasis':
    case 'retentionDays':
      return 'informations';
    // La date d'un événement se règle sur son propre écran, hors de l'éditeur.
    case 'eventStartsAt':
      return null;
  }
}
