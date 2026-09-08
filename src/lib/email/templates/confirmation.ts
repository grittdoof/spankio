import { BANNER_HEIGHT, BANNER_WIDTH } from '@/lib/event/banner';
import type { CalendarLinks, DirectionsLinks } from '@/lib/event/calendar-links';
import { renderEmail, type EmailBranding } from './layout';
import type { RenderedEmail } from './membership';

/**
 * Courriel de confirmation d'inscription, envoyé au répondant.
 *
 * Trois règles, et la première est celle qui gouverne tout ce fichier :
 *
 *  1. **Rien n'est inventé.** Pas de visuel si l'organisation n'en a pas
 *     déposé, pas de ligne « Accès » si le champ est vide, pas de bloc agenda
 *     si l'événement n'a pas de date. Un courriel de confirmation qui annonce
 *     « Lieu : non renseigné » est pire qu'un courriel plus court.
 *  2. **Le visuel est DÉCORATIF** (`alt` vide) : son contenu est répété par
 *     les faits qui le suivent, et beaucoup de clients mail bloquent les
 *     images — un `alt` bavard laisserait un pavé de texte à sa place.
 *  3. **Tout ce qui vient de l'organisation est échappé** par le gabarit, y
 *     compris son texte personnalisé et sa couleur d'accent : un courriel est
 *     un document HTML servi à un tiers, donc une surface d'injection.
 */

export interface ConfirmationContext {
  branding: EmailBranding;
  /** Titre du formulaire, tel que le répondant l'a vu. */
  surveyTitle: string;
  /** Visuel de l'événement, déjà en URL absolue. */
  bannerUrl?: string | null;
  /** Texte rédigé par l'organisation, qui remplace la phrase par défaut. */
  customText?: string | null;
  /** Date de l'événement, déjà mise en forme dans SON fuseau. */
  when?: string | null;
  /** Heure de fin ou précision, sous la date. */
  whenNote?: string | null;
  /** Lieu : intitulé et adresse, déjà composés. */
  place?: string | null;
  /** Accès : le texte saisi dans « Accès » des réglages de la page publique. */
  access?: string | null;
  directions?: DirectionsLinks | null;
  calendar?: CalendarLinks | null;
  /**
   * Ce que le répondant a saisi, pour qu'il le vérifie. Vide, le bloc
   * n'apparaît pas — un titre « Vos réponses » suivi de rien serait pire.
   */
  recap?: readonly { readonly label: string; readonly value: string }[];
  /** Adresse de l'invitation, pour la revoir. */
  publicUrl: string;
  legalLinks?: readonly { label: string; url: string }[];
}

export function registrationConfirmationEmail(
  context: ConfirmationContext,
): RenderedEmail {
  const facts: { label: string; value: string }[] = [];
  if (context.when) {
    facts.push({
      label: 'Date',
      value: context.whenNote ? `${context.when} — ${context.whenNote}` : context.when,
    });
  }
  if (context.place) facts.push({ label: 'Lieu', value: context.place });
  if (context.access) facts.push({ label: 'Accès', value: context.access });

  const intro =
    context.customText?.trim() ||
    `Votre inscription à « ${context.surveyTitle} » est enregistrée.`;

  const blocks: Parameters<typeof renderEmail>[0]['blocks'] = [
    ...(context.bannerUrl
      ? [{ image: { url: context.bannerUrl, width: BANNER_WIDTH, height: BANNER_HEIGHT } }]
      : []),
    { paragraph: intro },
    ...(facts.length > 0 ? [{ facts }] : []),
    ...(context.calendar
      ? [
          {
            paragraph: 'Ajouter à mon agenda',
            links: [
              { label: 'Google Agenda', url: context.calendar.google },
              { label: 'Outlook', url: context.calendar.outlook },
              { label: 'Autre agenda (.ics)', url: context.calendar.ics },
            ],
          },
        ]
      : []),
    ...((context.recap?.length ?? 0) > 0
      ? [
          { paragraph: 'Vos réponses' },
          { facts: context.recap ?? [] },
        ]
      : []),
    ...(context.directions
      ? [
          {
            paragraph: 'S’y rendre',
            links: [
              { label: 'Google Maps', url: context.directions.google },
              { label: 'Plans', url: context.directions.apple },
              { label: 'OpenStreetMap', url: context.directions.openStreetMap },
            ],
          },
        ]
      : []),
    { action: { label: 'Revoir l’invitation', url: context.publicUrl } },
  ];

  const { html, text } = renderEmail({
    title: 'Votre inscription est enregistrée',
    preheader: context.when
      ? `${context.surveyTitle} — ${context.when}`
      : context.surveyTitle,
    branding: context.branding,
    ...(context.legalLinks ? { legalLinks: context.legalLinks } : {}),
    blocks,
  });

  return {
    subject: `Inscription confirmée — ${context.surveyTitle}`,
    html,
    text,
  };
}
