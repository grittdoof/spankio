import { templateByKey, type SurveyTemplate } from '@/lib/event/templates';

/**
 * Parcours guidé de création d'un formulaire : une question par écran.
 *
 * Toute la logique de navigation vit ici, en fonctions PURES. C'est ce qui
 * permet de la tester sans navigateur, mais surtout ce qui garantit qu'il n'y a
 * qu'une seule définition du parcours : une page qui calculerait elle-même
 * « l'étape suivante » finirait par ne plus concorder avec la barre de
 * progression, et l'utilisateur verrait « 3 / 5 » sur le dernier écran.
 *
 * **L'état vit dans l'URL**, pas en session ni en mémoire du serveur. Trois
 * conséquences voulues : le parcours survit à un rafraîchissement, le bouton
 * « retour » du navigateur fait ce qu'on attend de lui, et chaque écran est un
 * `<form action>` classique — donc le parcours fonctionne sans JavaScript.
 *
 * Rien de ce qui passe par l'URL n'est personnel : un type de formulaire et une
 * clé de modèle, tous deux issus de listes fermées.
 */

/**
 * Les écrans, dans l'ordre. Le parcours DÉPEND du type : un événement demande
 * une date et un lieu, un sondage non.
 *
 * Un écran « date et lieu » vide, affiché aux sondages, apprendrait à
 * l'utilisateur que certaines étapes ne le concernent pas — et il finirait par
 * les traverser sans les lire.
 */
const ALL_STEPS = [
  { key: 'type', label: 'Type de formulaire', kinds: ['survey', 'event'] },
  { key: 'modele', label: 'Point de départ', kinds: ['survey', 'event'] },
  { key: 'titre', label: 'Titre', kinds: ['survey', 'event'] },
  { key: 'evenement', label: 'Date et lieu', kinds: ['event'] },
  { key: 'informations', label: 'Informations aux répondants', kinds: ['survey', 'event'] },
  { key: 'pret', label: 'Récapitulatif', kinds: ['survey', 'event'] },
] as const;

export type WizardStepKey = (typeof ALL_STEPS)[number]['key'];

export type SurveyKind = 'survey' | 'event';

/** Écrans applicables à ce type. */
export function wizardSteps(
  kind: SurveyKind,
): readonly { key: WizardStepKey; label: string }[] {
  return ALL_STEPS.filter((step) => (step.kinds as readonly string[]).includes(kind)).map(
    (step) => ({ key: step.key, label: step.label }),
  );
}

export function wizardTotal(kind: SurveyKind): number {
  return wizardSteps(kind).length;
}

/** Position (1-indexée) d'une étape dans le parcours de ce type. */
export function stepNumber(key: WizardStepKey, kind: SurveyKind): number {
  return wizardSteps(kind).findIndex((step) => step.key === key) + 1;
}

export function stepLabel(key: WizardStepKey): string {
  return ALL_STEPS.find((step) => step.key === key)?.label ?? '';
}

/** Étape suivante pour ce type, ou `null` sur la dernière. */
export function nextStep(key: WizardStepKey, kind: SurveyKind): WizardStepKey | null {
  const steps = wizardSteps(kind);
  const index = steps.findIndex((step) => step.key === key);
  return steps[index + 1]?.key ?? null;
}

// ---------------------------------------------------------------------------
// Les trois premiers écrans : avant que le brouillon n'existe
// ---------------------------------------------------------------------------

export interface DraftChoices {
  readonly kind: SurveyKind;
  /** `null` = formulaire vierge. */
  readonly templateKey: string | null;
}

/**
 * Résolution d'un écran du parcours de création.
 *
 * Une étape dont les choix précédents manquent n'affiche pas un écran à moitié
 * rempli : elle renvoie l'utilisateur là où le choix se fait. Sans cela, une URL
 * bricolée à la main afficherait l'écran du titre sans savoir quel type de
 * formulaire créer, et la création échouerait après la saisie.
 */
export type StepResolution =
  | { readonly ok: true; readonly step: WizardStepKey; readonly choices: DraftChoices }
  | { readonly ok: false; readonly redirectTo: string };

export interface RawStepInput {
  readonly etape?: string | undefined;
  readonly type?: string | undefined;
  readonly modele?: string | undefined;
}

function isKind(value: unknown): value is SurveyKind {
  return value === 'survey' || value === 'event';
}

export function resolveCreationStep(input: RawStepInput): StepResolution {
  const requested = input.etape ?? 'type';

  // Étape inconnue : on ne devine pas, on ramène au début.
  if (requested !== 'type' && requested !== 'modele' && requested !== 'titre') {
    return { ok: false, redirectTo: creationUrl('type', null) };
  }

  if (requested === 'type') {
    return { ok: true, step: 'type', choices: { kind: 'survey', templateKey: null } };
  }

  if (!isKind(input.type)) {
    return { ok: false, redirectTo: creationUrl('type', null) };
  }
  const kind = input.type;

  if (requested === 'modele') {
    return { ok: true, step: 'modele', choices: { kind, templateKey: null } };
  }

  // Étape du titre : le modèle a été choisi, éventuellement « vierge ».
  const raw = input.modele ?? '';
  if (raw === '') {
    return { ok: false, redirectTo: creationUrl('modele', { kind, templateKey: null }) };
  }

  const templateKey = raw === 'vierge' ? null : raw;
  if (templateKey !== null) {
    const template = templateByKey(templateKey);
    // Clé inconnue : l'utilisateur repasse par le choix du modèle plutôt que
    // de saisir un titre pour une création qui serait refusée.
    if (!template) {
      return { ok: false, redirectTo: creationUrl('modele', { kind, templateKey: null }) };
    }
    // Un modèle impose son type : l'incohérence est corrigée, pas ignorée.
    return { ok: true, step: 'titre', choices: { kind: template.kind, templateKey } };
  }

  return { ok: true, step: 'titre', choices: { kind, templateKey: null } };
}

/** URL d'un écran de création, choix courants inclus. */
export function creationUrl(
  step: 'type' | 'modele' | 'titre',
  choices: DraftChoices | null,
): string {
  const params = new URLSearchParams({ etape: step });
  if (choices) {
    params.set('type', choices.kind);
    if (step === 'titre') params.set('modele', choices.templateKey ?? 'vierge');
  }
  return `/admin/sondages/nouveau?${params.toString()}`;
}

/** URL de l'écran précédent, ou `null` sur le premier. */
export function previousCreationUrl(
  step: WizardStepKey,
  choices: DraftChoices,
  surveyId: string | null,
): string | null {
  switch (step) {
    case 'type':
      return null;
    case 'modele':
      return creationUrl('type', choices);
    case 'titre':
      return creationUrl('modele', choices);
    case 'evenement':
      // On ne revient PAS à l'écran du titre : le brouillon existe déjà, et y
      // retourner en créerait un second. Le titre se corrige dans l'éditeur.
      return surveyId ? `/admin/sondages/${surveyId}` : null;
    case 'informations':
      // Même raison, sauf pour un événement : l'écran précédent existe alors
      // en base et se rejoue sans risque.
      if (!surveyId) return null;
      return choices.kind === 'event'
        ? guideUrl(surveyId, 'evenement')
        : `/admin/sondages/${surveyId}`;
    case 'pret':
      return surveyId ? guideUrl(surveyId, 'informations') : null;
  }
}

/**
 * URL d'un écran du parcours postérieur à la création.
 *
 * Les cinq écrans restent sous `sondages/nouveau` : l'URL raconte alors ce
 * qu'on est en train de faire, et le brouillon garde son identifiant sans
 * entrer en concurrence avec les écrans d'édition de `sondages/[id]`.
 */
export function guideUrl(
  surveyId: string,
  step: 'evenement' | 'informations' | 'pret',
): string {
  return `/admin/sondages/nouveau/${surveyId}/${step}`;
}

// ---------------------------------------------------------------------------
// Modèles proposés
// ---------------------------------------------------------------------------

/**
 * Modèles offerts pour un type donné, restreints aux modules autorisés.
 *
 * Proposer un modèle que le RLS refusera à la création serait une promesse non
 * tenue : l'utilisateur choisirait, saisirait un titre, et recevrait un refus.
 */
export function templatesFor(
  templates: readonly SurveyTemplate[],
  kind: SurveyKind,
  allowedModules: ReadonlySet<string>,
): SurveyTemplate[] {
  return templates.filter(
    (template) => template.kind === kind && allowedModules.has(template.moduleKey),
  );
}
