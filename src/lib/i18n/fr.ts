/**
 * Chaînes de l'interface, centralisées.
 *
 * L'internationalisation complète est hors périmètre du MVP (risque R8), mais
 * aucune chaîne n'est écrite en dur dans un composant : le jour où une seconde
 * langue est demandée, c'est ce fichier qui se duplique, pas l'interface.
 *
 * Vocabulaire volontairement NEUTRE : « organisation », « répondant »,
 * « formulaire ». Aucun terme sectoriel — la plateforme est générique.
 */

export const fr = {
  platform: {
    name: 'Plateforme de sondages et d’inscriptions',
    tagline:
      'Recensez des besoins, sondez un public, gérez des inscriptions à des événements.',
  },

  nav: {
    skipToContent: 'Aller au contenu principal',
    legalNotice: 'Mentions légales',
    privacy: 'Confidentialité',
    signOut: 'Se déconnecter',
  },

  auth: {
    signIn: {
      title: 'Connexion',
      description: 'Accédez à l’espace de votre organisation.',
      emailLabel: 'Adresse électronique',
      passwordLabel: 'Mot de passe',
      submit: 'Se connecter',
      forgotPassword: 'Mot de passe oublié ?',
      noAccount: 'Pas encore de compte ?',
      createAccount: 'Créer un compte',
    },
    signUp: {
      title: 'Créer un compte',
      description:
        'Un compte créé n’a aucun accès tant qu’une demande de rattachement n’a pas été validée.',
      fullNameLabel: 'Nom et prénom',
      emailLabel: 'Adresse électronique',
      passwordLabel: 'Mot de passe',
      passwordHint: 'Au moins 12 caractères.',
      submit: 'Créer le compte',
      haveAccount: 'Vous avez déjà un compte ?',
      signInLink: 'Se connecter',
      confirmationSent:
        'Compte créé. Un message de confirmation vient de vous être envoyé : ouvrez-le pour activer votre accès.',
      confirmationSentNoEmail:
        'Compte créé. La confirmation par courriel n’est pas configurée sur cette instance : contactez l’administrateur de la plateforme pour activer votre accès.',
    },
    forgotPassword: {
      title: 'Mot de passe oublié',
      description:
        'Indiquez votre adresse : si un compte y correspond, vous recevrez un lien de réinitialisation.',
      submit: 'Envoyer le lien',
      // Réponse volontairement identique que l'adresse existe ou non : dire
      // « ce compte n'existe pas » révélerait qui est inscrit.
      sent:
        'Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.',
      backToSignIn: 'Retour à la connexion',
    },
    newPassword: {
      title: 'Nouveau mot de passe',
      description: 'Choisissez un nouveau mot de passe pour votre compte.',
      passwordLabel: 'Nouveau mot de passe',
      confirmLabel: 'Confirmer le mot de passe',
      submit: 'Enregistrer',
      updated: 'Mot de passe mis à jour. Vous pouvez vous connecter.',
    },
    membershipRequest: {
      title: 'Demande de rattachement',
      description:
        'Indiquez l’organisation que vous souhaitez rejoindre. Un administrateur de la plateforme validera votre demande et choisira vos droits.',
      existingOrganisationLabel: 'Organisation',
      existingOrganisationPlaceholder: 'Choisir une organisation…',
      newOrganisationOption: 'Mon organisation n’est pas dans la liste',
      newOrganisationLabel: 'Nom de l’organisation à créer',
      roleLabel: 'Rôle souhaité',
      roleHint: 'Le rôle définitif est choisi par l’administrateur de la plateforme.',
      messageLabel: 'Message (facultatif)',
      messageHint: 'Précisez votre fonction ou le contexte de votre demande.',
      submit: 'Envoyer la demande',
      sent:
        'Demande envoyée. Vous recevrez un courriel dès qu’une décision aura été prise.',
      pending:
        'Une demande est déjà en attente de décision pour ce compte. Vous serez prévenu par courriel.',
    },
    roles: {
      admin: 'Administrateur de l’organisation',
      editor: 'Éditeur',
      viewer: 'Lecteur',
    },
    status: {
      pendingTitle: 'Compte en attente de rattachement',
      pendingBody:
        'Votre compte est créé mais n’est encore rattaché à aucune organisation. Déposez une demande de rattachement pour obtenir un accès.',
    },
  },

  errors: {
    invalidCredentials: 'Adresse ou mot de passe incorrect.',
    emailRequired: 'Indiquez une adresse électronique.',
    emailInvalid: 'Cette adresse électronique n’est pas valide.',
    passwordTooShort: 'Le mot de passe doit contenir au moins 12 caractères.',
    passwordMismatch: 'Les deux mots de passe ne correspondent pas.',
    fullNameRequired: 'Indiquez votre nom.',
    emailAlreadyUsed:
      'Si cette adresse n’est pas déjà utilisée, un message de confirmation vient d’être envoyé.',
    organisationRequired: 'Choisissez une organisation ou indiquez le nom de celle à créer.',
    organisationNameTooShort: 'Le nom de l’organisation doit contenir au moins 2 caractères.',
    tooManyAttempts: 'Trop de tentatives. Merci de réessayer dans quelques minutes.',
    sessionExpired: 'Votre session a expiré. Reconnectez-vous.',
    unexpected: 'Une erreur inattendue s’est produite. Merci de réessayer.',
    emailNotConfirmed:
      'Votre adresse n’est pas encore confirmée. Ouvrez le message de confirmation reçu par courriel.',
    linkExpired:
      'Ce lien a expiré. Les liens envoyés par courriel ne sont valables qu’une heure et ne servent qu’une fois : demandez-en un nouveau ci-dessous.',
    linkInvalid:
      'Ce lien n’est plus valable. Il a peut-être déjà été utilisé, ou un lien plus récent l’a remplacé. Demandez-en un nouveau ci-dessous.',
    emailServiceUnavailable:
      'L’envoi de courriels est momentanément indisponible : votre demande n’a pas pu aboutir. Merci de réessayer dans quelques minutes, ou de contacter l’administrateur de la plateforme.',
  },

  /** Rendu public du formulaire. */
  survey: {
    start: 'Commencer',
    next: 'Suivant',
    back: 'Retour',
    submit: 'Envoyer ma réponse',
    sending: 'Envoi en cours…',
    progress: 'Progression',
    questionCounter: (current: number, total: number) => `${current} / ${total}`,
    required: 'obligatoire',
    optionalHint: 'facultatif',
    otherLabel: 'Autre',
    otherPlaceholder: 'Précisez',
    closed: 'Ce formulaire n’accepte plus de réponses.',
    full: 'Le nombre maximal de réponses a été atteint.',
    thankYouTitle: 'Merci pour votre réponse',
    thankYouMessage: 'Votre réponse a bien été enregistrée.',
    addToCalendar: 'Ajouter à mon agenda',
    directions: 'Itinéraire',
    consentTitle: 'Avant d’envoyer',
    consentIntro:
      'Voici comment vos réponses seront utilisées. Prenez le temps de les lire avant de valider.',
    privacyLink: 'Politique de confidentialité',
    /** Messages d'erreur de saisie, par code renvoyé par la validation. */
    errors: {
      required: 'Cette réponse est obligatoire.',
      not_a_string: 'Cette valeur n’est pas attendue ici.',
      too_long: 'Cette réponse est trop longue.',
      invalid_email: 'Cette adresse électronique n’est pas valide.',
      invalid_tel: 'Ce numéro de téléphone n’est pas valide.',
      not_a_number: 'Indiquez un nombre.',
      not_an_integer: 'Indiquez un nombre entier.',
      out_of_range: 'Cette valeur est en dehors des limites autorisées.',
      invalid_date: 'Cette date n’existe pas.',
      date_out_of_range: 'Cette date est en dehors de la période autorisée.',
      unknown_option: 'Ce choix n’est pas proposé.',
      not_a_list: 'Cette réponse n’a pas le format attendu.',
      too_few_selected: 'Vous n’avez pas coché assez de choix.',
      too_many_selected: 'Vous avez coché trop de choix.',
      duplicate_selection: 'Ce choix est sélectionné deux fois.',
      not_a_grid: 'Cette réponse n’a pas le format attendu.',
      unknown_grid_row: 'Cette ligne n’est pas proposée.',
      single_choice_per_row: 'Un seul choix par ligne est autorisé.',
      unknown_field: 'Cette question n’existe pas dans ce formulaire.',
      payload_not_object: 'Les données envoyées sont invalides.',
      payload_too_large: 'Votre réponse est trop volumineuse.',
      too_many_fields: 'Votre réponse contient trop de champs.',
    },
    /** Erreurs d'envoi, par code de l'API. */
    submitErrors: {
      invalid_input: 'Certaines réponses doivent être corrigées.',
      conflict: 'Une réponse a déjà été enregistrée pour cette personne.',
      closed: 'Ce formulaire n’accepte plus de réponses.',
      consent_required: 'Le consentement est nécessaire pour envoyer cette réponse.',
      payload_too_large: 'Votre réponse est trop volumineuse.',
      too_many_requests: 'Trop d’envois en peu de temps. Réessayez dans un instant.',
      not_found: 'Ce formulaire est introuvable.',
      server_error: 'L’envoi a échoué. Vos réponses sont conservées : réessayez.',
    },
  },

  common: {
    required: 'obligatoire',
    optional: 'facultatif',
    loading: 'Chargement…',
    back: 'Retour',
  },
} as const;

/** Codes d'erreur transmis dans l'URL, jamais de données personnelles. */
export type AuthErrorCode = keyof typeof fr.errors;

/** Message d'une erreur de saisie, avec ses éventuels paramètres. */
export function responseErrorMessage(
  code: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const messages: Readonly<Record<string, string>> = fr.survey.errors;
  const base = messages[code] ?? fr.errors.unexpected;

  if (params?.['max'] !== undefined && code === 'too_long') {
    return `${base} Maximum : ${params['max']} caractères.`;
  }
  if (code === 'out_of_range') {
    if (params?.['min'] !== undefined && params['max'] !== undefined) {
      return `${base} Entre ${params['min']} et ${params['max']}.`;
    }
    if (params?.['min'] !== undefined) return `${base} Minimum : ${params['min']}.`;
    if (params?.['max'] !== undefined) return `${base} Maximum : ${params['max']}.`;
  }
  if (code === 'too_few_selected' && params?.['min'] !== undefined) {
    return `${base} Minimum : ${params['min']}.`;
  }
  if (code === 'too_many_selected' && params?.['max'] !== undefined) {
    return `${base} Maximum : ${params['max']}.`;
  }

  return base;
}

/** Message d'un échec d'envoi, par code d'API. */
export function submitErrorMessage(code: string | undefined): string {
  const messages: Readonly<Record<string, string>> = fr.survey.submitErrors;
  return (code && messages[code]) || fr.errors.unexpected;
}

export function authErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return code in fr.errors ? fr.errors[code as AuthErrorCode] : fr.errors.unexpected;
}
