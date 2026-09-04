import { renderEmail, type EmailBranding } from './layout';

/**
 * Emails du parcours de rattachement.
 *
 * Ils sont chartés avec le logo et les coordonnées de l'ORGANISATION concernée
 * quand elle est connue (approbation, refus), et avec ceux de la plateforme
 * pour la notification interne au super_admin.
 *
 * Aucun vocabulaire sectoriel : « organisation », « demande de rattachement »,
 * jamais « collectivité », « mairie » ou « entreprise ».
 */

export interface MembershipMailContext {
  branding: EmailBranding;
  /** URL publique du service, pour construire les liens. */
  siteUrl: string;
  legalLinks?: readonly { label: string; url: string }[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  admin: 'administrateur de l’organisation',
  editor: 'éditeur',
  viewer: 'lecteur',
  super_admin: 'super administrateur',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Notification au super administrateur : une demande attend une décision. */
export function membershipRequestReceivedEmail(
  input: {
    requesterName: string | null;
    requesterEmail: string;
    organisationLabel: string;
    requestedRole: string;
    message?: string | null;
  },
  context: MembershipMailContext,
): RenderedEmail {
  const who = input.requesterName?.trim() || input.requesterEmail;
  const { html, text } = renderEmail({
    title: 'Nouvelle demande de rattachement',
    preheader: `${who} demande à rejoindre ${input.organisationLabel}.`,
    branding: context.branding,
    ...(context.legalLinks ? { legalLinks: context.legalLinks } : {}),
    blocks: [
      {
        paragraph:
          'Une demande de rattachement attend votre décision. Vous choisirez le rôle et les modules autorisés au moment de la validation.',
      },
      {
        bullets: [
          `Demandeur : ${who}`,
          `Adresse : ${input.requesterEmail}`,
          `Organisation : ${input.organisationLabel}`,
          `Rôle demandé : ${roleLabel(input.requestedRole)}`,
        ],
      },
      ...(input.message?.trim() ? [{ quote: input.message.trim() }] : []),
      {
        action: {
          label: 'Examiner la demande',
          url: `${context.siteUrl.replace(/\/$/, '')}/super-admin/demandes`,
        },
      },
    ],
  });

  return { subject: `Demande de rattachement — ${input.organisationLabel}`, html, text };
}

/** Décision favorable, chartée aux couleurs de l'organisation d'accueil. */
export function membershipApprovedEmail(
  input: {
    recipientName: string | null;
    organisationName: string;
    role: string;
    moduleNames: readonly string[];
    note?: string | null;
  },
  context: MembershipMailContext,
): RenderedEmail {
  const greeting = input.recipientName?.trim()
    ? `Bonjour ${input.recipientName.trim()},`
    : 'Bonjour,';

  const { html, text } = renderEmail({
    title: 'Votre demande de rattachement est acceptée',
    preheader: `Vous êtes rattaché à ${input.organisationName} en tant que ${roleLabel(input.role)}.`,
    branding: context.branding,
    ...(context.legalLinks ? { legalLinks: context.legalLinks } : {}),
    blocks: [
      { paragraph: greeting },
      {
        paragraph: `Votre compte est désormais rattaché à ${input.organisationName}, avec le rôle de ${roleLabel(
          input.role,
        )}.`,
      },
      {
        bullets:
          input.moduleNames.length > 0
            ? [`Modules autorisés : ${input.moduleNames.join(', ')}`]
            : ['Modules autorisés : sondages (module de base)'],
      },
      ...(input.note?.trim() ? [{ quote: input.note.trim() }] : []),
      {
        action: {
          label: 'Accéder à mon espace',
          url: `${context.siteUrl.replace(/\/$/, '')}/admin`,
        },
      },
    ],
  });

  return {
    subject: `Accès accordé — ${input.organisationName}`,
    html,
    text,
  };
}

/** Décision défavorable : motivée, et sans impasse. */
export function membershipRejectedEmail(
  input: {
    recipientName: string | null;
    organisationLabel: string;
    note?: string | null;
    contactEmail?: string | null;
  },
  context: MembershipMailContext,
): RenderedEmail {
  const greeting = input.recipientName?.trim()
    ? `Bonjour ${input.recipientName.trim()},`
    : 'Bonjour,';

  const { html, text } = renderEmail({
    title: 'Votre demande de rattachement n’a pas été retenue',
    preheader: `Décision concernant votre demande pour ${input.organisationLabel}.`,
    branding: context.branding,
    ...(context.legalLinks ? { legalLinks: context.legalLinks } : {}),
    blocks: [
      { paragraph: greeting },
      {
        paragraph: `Votre demande de rattachement à ${input.organisationLabel} n’a pas été acceptée. Votre compte reste actif, sans accès aux espaces d’administration.`,
      },
      ...(input.note?.trim() ? [{ quote: input.note.trim() }] : []),
      {
        paragraph: input.contactEmail
          ? `Si cette décision vous semble erronée, écrivez à ${input.contactEmail}.`
          : 'Vous pouvez déposer une nouvelle demande si votre situation change.',
      },
    ],
  });

  return { subject: `Demande de rattachement — ${input.organisationLabel}`, html, text };
}
