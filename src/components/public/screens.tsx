'use client';

import { Alert } from '@/components/ui/Alert';
import { Invitation, type InvitationProps } from './Invitation';
import {
  EventActions,
  type CalendarActions,
  type DirectionsActions,
} from './EventActions';
import { fr } from '@/lib/i18n/fr';
import type { ConsentNotice } from '@/lib/survey/consent';

/** Ré-exportés : les écrans sont le point d'entrée de ces types. */
export type { CalendarActions, DirectionsActions };

/**
 * Écrans d'encadrement du formulaire : accueil, intro d'étape, consentement,
 * remerciement. Séparés du moteur de navigation pour rester testables seuls.
 */

export interface Branding {
  readonly organisationName: string;
  readonly logoUrl: string | null;
  readonly bannerUrl: string | null;
}

/**
 * Tout ce que l'écran d'accueil affiche, déjà FILTRÉ par les interrupteurs de
 * la page publique. L'écran n'arbitre rien : il montre ce qu'on lui donne.
 */
export type WelcomeContent = Omit<InvitationProps, 'onStart' | 'children'>;

/**
 * Accueil : l'invitation elle-même.
 *
 * L'écran ne fait qu'un aiguillage vers `Invitation`, et c'est volontaire —
 * l'invitation d'un événement et le formulaire qui la suit sont deux objets
 * différents, avec deux mises en page différentes. Les avoir mêlés reviendrait
 * à faire dépendre la présentation d'une soirée du moteur de questions.
 */
export function WelcomeScreen({
  content,
  onStart,
  children,
}: {
  content: WelcomeContent;
  onStart: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Invitation {...content} onStart={onStart}>
      {children}
    </Invitation>
  );
}

export function StepIntroScreen({
  title,
  intro,
  position,
}: {
  title?: string | undefined;
  intro?: string | undefined;
  position: string;
}) {
  return (
    <div className="sp-screen sp-screen--intro">
      <div className="sp-screen__body">
        <p className="sp-badge">{position}</p>
        {title ? <h2 className="sp-screen__title">{title}</h2> : null}
        {intro ? <p className="sp-screen__lead">{intro}</p> : null}
      </div>
    </div>
  );
}

/**
 * Écran de consentement.
 *
 * Le texte affiché est celui que le SERVEUR recomposera pour le stocker comme
 * preuve : les deux viennent de la même fonction. Le bouton d'envoi reste
 * désactivé tant que la case n'est pas cochée — et il est réellement
 * `disabled`, pas seulement grisé, sinon la navigation clavier permettrait de
 * l'activer quand même.
 */
export function ConsentScreen({
  notice,
  checkboxLabel,
  checked,
  onToggle,
  privacyHref,
}: {
  notice: ConsentNotice;
  checkboxLabel: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
  privacyHref: string;
}) {
  return (
    <div className="sp-screen sp-screen--consent">
      <div className="sp-screen__body">
        <h2 className="sp-screen__title">{fr.survey.consentTitle}</h2>
        <p className="sp-screen__lead">{fr.survey.consentIntro}</p>

        {notice.paragraphs.map((paragraph) => (
          <p key={paragraph} className="sp-muted">
            {paragraph}
          </p>
        ))}

        <dl className="sp-definition">
          {notice.sections.map((section) => (
            <div key={section.label}>
              <dt>{section.label}</dt>
              <dd>{section.value}</dd>
            </div>
          ))}
        </dl>

        <p>
          <a href={privacyHref} target="_blank" rel="noreferrer">
            {fr.survey.privacyLink}
          </a>
        </p>

        <label className="sp-choice">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onToggle(event.target.checked)}
            required
          />
          <span className="sp-choice__label">{checkboxLabel}</span>
        </label>
      </div>
    </div>
  );
}

export function ThankYouScreen({
  title,
  message,
  calendar,
  directions,
  eventSummary,
}: {
  title: string;
  message?: string | undefined;
  calendar?: CalendarActions | undefined;
  directions?: DirectionsActions | undefined;
  eventSummary?: readonly string[];
}) {
  return (
    <div className="sp-screen sp-screen--done">
      <div className="sp-screen__body">
        <p className="sp-done-mark" aria-hidden="true">
          ✓
        </p>
        <h2 className="sp-screen__title">{title}</h2>
        {message ? <p className="sp-screen__lead">{message}</p> : null}

        {eventSummary && eventSummary.length > 0 ? (
          <ul className="sp-meta">
            {eventSummary.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        ) : null}

        <EventActions calendar={calendar} directions={directions} />

      </div>
    </div>
  );
}

export function ClosedScreen({ reason }: { reason: string }) {
  return (
    <div className="sp-screen">
      <div className="sp-screen__body">
        <Alert tone="info">{reason}</Alert>
      </div>
    </div>
  );
}
