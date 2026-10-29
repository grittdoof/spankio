import { renderEmail, type EmailBranding } from './layout';
import type { RenderedEmail } from './membership';

/**
 * Le courriel qui porte une invitation au poste d'accueil.
 *
 * Il est chargé de dire trois choses, et de les dire dans cet ordre, parce
 * qu'elles ne sont pas évidentes pour quelqu'un qui n'a jamais vu le produit :
 *
 *  1. **ce que ce lien ouvre**, et rien d'autre — la liste des invités d'UN
 *     événement, pour y pointer les arrivées ;
 *  2. **qu'il faut un compte**, et que le lien ne le crée pas. C'est la
 *     conséquence directe de ne pas employer le `service role`, et la taire
 *     ferait croire à un lien cassé au premier clic ;
 *  3. **que le lien ne vaut qu'une fois, et qu'il périme.**
 *
 * L'adresse n'est pas répétée dans le corps : le destinataire la connaît, et
 * l'écrire n'aiderait qu'un lecteur à qui le message aurait été transféré.
 */

export interface CheckinInvitationContext {
  branding: EmailBranding;
  siteUrl: string;
  legalLinks?: readonly { label: string; url: string }[];
}

export function checkinInvitationEmail(
  input: {
    organisationName: string;
    eventTitle: string;
    link: string;
    /** Date limite du LIEN, déjà mise en forme pour un lecteur. */
    expiresOn: string;
    invitedBy?: string | null;
  },
  context: CheckinInvitationContext,
): RenderedEmail {
  const who = input.invitedBy?.trim();

  const { html, text } = renderEmail({
    title: 'Vous tenez l’accueil',
    preheader: `${input.organisationName} vous confie l’accueil de « ${input.eventTitle} ».`,
    branding: context.branding,
    ...(context.legalLinks ? { legalLinks: context.legalLinks } : {}),
    blocks: [
      {
        paragraph: who
          ? `${who} (${input.organisationName}) vous confie l’accueil de « ${input.eventTitle} ».`
          : `${input.organisationName} vous confie l’accueil de « ${input.eventTitle} ».`,
      },
      {
        paragraph:
          'Le lien ci-dessous vous donne accès à la liste des invités de cet événement, et à elle seule, pour y pointer les arrivées. Vous n’aurez accès à aucune autre donnée de l’organisation.',
      },
      {
        bullets: [
          'Ce lien ne crée pas de compte : si vous n’en avez pas encore, créez-le d’abord, puis revenez sur ce lien.',
          'Créez-le avec l’adresse à laquelle ce message vous est parvenu, sans quoi le lien sera refusé.',
          `Il ne vaut qu’une fois, et expire le ${input.expiresOn}.`,
        ],
      },
      {
        action: {
          label: 'Accéder à l’accueil',
          url: input.link,
        },
      },
      {
        paragraph:
          'Si vous n’attendiez pas ce message, ignorez-le : sans compte créé à cette adresse, le lien n’ouvre rien.',
      },
    ],
  });

  return {
    subject: `Accueil de « ${input.eventTitle} »`,
    html,
    text,
  };
}
