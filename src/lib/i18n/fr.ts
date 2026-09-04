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

export function authErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return code in fr.errors ? fr.errors[code as AuthErrorCode] : fr.errors.unexpected;
}
