import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import type { SurveySettings } from '@/lib/survey/settings';

/**
 * Modèles de sondages et d'événements, en TypeScript.
 *
 * En TypeScript et non en seed SQL, pour deux raisons : un modèle est du
 * contenu applicatif qui évolue à chaque livraison, et il doit être VALIDÉ par
 * le même code que n'importe quel schéma reçu de l'extérieur — ce qu'un
 * `insert` SQL ne permet pas. Un test vérifie donc que chaque modèle passe
 * `validateSurveySchema`.
 *
 * Vocabulaire volontairement neutre : ces modèles servent une entreprise, une
 * association, un établissement ou une collectivité sans être retouchés.
 */

export interface SurveyTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly kind: 'survey' | 'event';
  readonly moduleKey: 'core' | 'event';
  /** Champ proposé comme clé anti-doublon, s'il y en a un de pertinent. */
  readonly suggestedDedupField: string | null;
  readonly settings: SurveySettings;
  readonly schema: SurveySchema;
}

/**
 * Les modèles sont écrits en objets littéraux puis validés à la construction :
 * un modèle incohérent devient une erreur au démarrage, pas un formulaire
 * cassé chez un client.
 */
function template(
  input: Omit<SurveyTemplate, 'schema'> & { schema: unknown },
): SurveyTemplate {
  const result = validateSurveySchema(input.schema);
  if (!result.ok) {
    throw new Error(
      `Modèle « ${input.key} » invalide : ${result.issues
        .map((issue) => `${issue.path} ${issue.code}`)
        .join(', ')}`,
    );
  }
  return { ...input, schema: result.schema };
}

const identityFields = [
  { id: 'nom', type: 'text', label: 'Nom et prénom', required: true },
  { id: 'email', type: 'email', label: 'Adresse électronique', required: true },
  {
    id: 'telephone',
    type: 'tel',
    label: 'Téléphone',
    hint: 'Facultatif, pour être joint en cas de changement.',
  },
];

/** Inscription simple à un événement daté. */
const eventRegistration = template({
  key: 'event_registration',
  name: 'Inscription à un événement',
  description:
    'Recueille les inscriptions à un événement daté : identité, nombre de personnes et remarque.',
  kind: 'event',
  moduleKey: 'event',
  suggestedDedupField: 'email',
  settings: {
    welcome: {
      badge: 'Inscription',
      ctaLabel: 'Je m’inscris',
    },
    thankYou: {
      title: 'Votre inscription est enregistrée',
      message: 'Vous pouvez ajouter l’événement à votre agenda ci-dessous.',
      showCalendar: true,
    },
  },
  schema: {
    version: 1,
    steps: [
      {
        id: 'participation',
        title: 'Votre participation',
        fields: [
          {
            id: 'presence',
            type: 'radio',
            label: 'Serez-vous présent ?',
            required: true,
            options: [
              { value: 'oui', label: 'Oui, je serai présent' },
              { value: 'non', label: 'Non, je ne pourrai pas venir' },
            ],
          },
          {
            id: 'accompagnants',
            type: 'number',
            label: 'Nombre de personnes vous accompagnant',
            hint: 'Vous compris, indiquez le nombre total de participants.',
            min: 1,
            max: 20,
            unit: 'personnes',
            condition: { field: 'presence', op: 'equals', value: 'oui' },
          },
        ],
      },
      {
        id: 'coordonnees',
        title: 'Vos coordonnées',
        fields: identityFields,
      },
      {
        id: 'complement',
        title: 'Un mot à ajouter ?',
        hideIntro: true,
        fields: [
          {
            id: 'remarque',
            type: 'textarea',
            label: 'Remarque ou besoin particulier',
            hint: 'Accessibilité, régime alimentaire, question à poser…',
          },
        ],
      },
    ],
  },
});

/** Inscription avec choix d'un ou plusieurs créneaux. */
const eventSlots = template({
  key: 'event_slots',
  name: 'Inscription avec choix de créneau',
  description:
    'Recueille les inscriptions en laissant choisir un ou plusieurs créneaux dans une grille.',
  kind: 'event',
  moduleKey: 'event',
  suggestedDedupField: 'email',
  settings: {
    welcome: { badge: 'Inscription', ctaLabel: 'Choisir mon créneau' },
    thankYou: {
      title: 'Votre créneau est réservé',
      message: 'Un récapitulatif vous a été présenté ci-dessous.',
      showCalendar: true,
    },
  },
  schema: {
    version: 1,
    steps: [
      {
        id: 'creneaux',
        title: 'Vos disponibilités',
        intro: 'Cochez tous les créneaux qui vous conviennent.',
        fields: [
          {
            id: 'disponibilites',
            type: 'checkbox_grid',
            label: 'Créneaux souhaités',
            required: true,
            rows: [
              { value: 'jour_1', label: 'Premier jour' },
              { value: 'jour_2', label: 'Deuxième jour' },
              { value: 'jour_3', label: 'Troisième jour' },
            ],
            columns: [
              { value: 'matin', label: 'Matin' },
              { value: 'apres_midi', label: 'Après-midi' },
              { value: 'soir', label: 'Soir' },
            ],
          },
        ],
      },
      {
        id: 'coordonnees',
        title: 'Vos coordonnées',
        fields: identityFields,
      },
    ],
  },
});

/** Recensement de besoins, sans hypothèse sur le domaine. */
const needsSurvey = template({
  key: 'needs_survey',
  name: 'Recensement de besoins',
  description:
    'Mesure l’intérêt pour une liste de propositions et recueille les besoins non prévus.',
  kind: 'survey',
  moduleKey: 'core',
  suggestedDedupField: null,
  settings: {
    welcome: { badge: 'Consultation', ctaLabel: 'Donner mon avis' },
    thankYou: { title: 'Merci pour votre contribution' },
  },
  schema: {
    version: 1,
    steps: [
      {
        id: 'interet',
        title: 'Votre intérêt',
        fields: [
          {
            id: 'niveau_interet',
            type: 'scale',
            label: 'À quel point ce sujet vous concerne-t-il ?',
            required: true,
            min: 1,
            max: 5,
            minLabel: 'Pas du tout',
            maxLabel: 'Tout à fait',
          },
        ],
      },
      {
        id: 'besoins',
        title: 'Vos besoins',
        fields: [
          {
            id: 'propositions',
            type: 'checkbox',
            label: 'Quelles propositions retiennent votre attention ?',
            hint: 'Plusieurs réponses possibles.',
            allowOther: true,
            options: [
              { value: 'proposition_1', label: 'Première proposition' },
              { value: 'proposition_2', label: 'Deuxième proposition' },
              { value: 'proposition_3', label: 'Troisième proposition' },
            ],
          },
          {
            id: 'priorite',
            type: 'select',
            label: 'Quelle proposition traiter en priorité ?',
            options: [
              { value: 'proposition_1', label: 'Première proposition' },
              { value: 'proposition_2', label: 'Deuxième proposition' },
              { value: 'proposition_3', label: 'Troisième proposition' },
            ],
            condition: { field: 'propositions', op: 'answered' },
          },
        ],
      },
      {
        id: 'expression',
        title: 'Votre expression libre',
        hideIntro: true,
        fields: [
          {
            id: 'commentaire',
            type: 'textarea',
            label: 'Souhaitez-vous ajouter quelque chose ?',
          },
        ],
      },
    ],
  },
});

/** Enquête de satisfaction après un événement ou un service rendu. */
const satisfactionSurvey = template({
  key: 'satisfaction_survey',
  name: 'Enquête de satisfaction',
  description: 'Mesure la satisfaction et recueille les points à améliorer.',
  kind: 'survey',
  moduleKey: 'core',
  suggestedDedupField: null,
  settings: {
    welcome: { badge: 'Votre avis', ctaLabel: 'Répondre' },
    thankYou: { title: 'Merci pour votre retour' },
  },
  schema: {
    version: 1,
    steps: [
      {
        id: 'appreciation',
        title: 'Votre appréciation',
        fields: [
          {
            id: 'satisfaction',
            type: 'scale',
            label: 'Quel est votre niveau de satisfaction ?',
            required: true,
            min: 1,
            max: 5,
            minLabel: 'Très insatisfait',
            maxLabel: 'Très satisfait',
          },
          {
            id: 'recommandation',
            type: 'radio',
            label: 'Le recommanderiez-vous ?',
            options: [
              { value: 'oui', label: 'Oui' },
              { value: 'peut_etre', label: 'Peut-être' },
              { value: 'non', label: 'Non' },
            ],
          },
        ],
      },
      {
        id: 'details',
        title: 'Pour aller plus loin',
        fields: [
          { id: 'points_forts', type: 'textarea', label: 'Ce qui vous a plu' },
          {
            id: 'points_ameliorer',
            type: 'textarea',
            label: 'Ce qui pourrait être amélioré',
          },
          {
            id: 'motif_insatisfaction',
            type: 'textarea',
            label: 'Qu’est-ce qui n’a pas fonctionné ?',
            condition: { field: 'recommandation', op: 'equals', value: 'non' },
          },
        ],
      },
    ],
  },
});

/** Tous les modèles proposés, dans l'ordre d'affichage. */
export const SURVEY_TEMPLATES: readonly SurveyTemplate[] = [
  eventRegistration,
  eventSlots,
  needsSurvey,
  satisfactionSurvey,
];

export function templateByKey(key: string): SurveyTemplate | undefined {
  return SURVEY_TEMPLATES.find((candidate) => candidate.key === key);
}

/** Modèles disponibles pour un compte, selon les modules qui lui sont ouverts. */
export function templatesFor(allowedModules: readonly string[]): SurveyTemplate[] {
  return SURVEY_TEMPLATES.filter((candidate) => allowedModules.includes(candidate.moduleKey));
}
