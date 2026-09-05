'use client';

import { Alert } from '@/components/ui/Alert';
import { BannerFrame } from '@/components/ui/BannerFrame';
import { fr } from '@/lib/i18n/fr';
import type { ConsentNotice } from '@/lib/survey/consent';

/**
 * Écrans d'encadrement du formulaire : accueil, intro d'étape, consentement,
 * remerciement. Séparés du moteur de navigation pour rester testables seuls.
 */

export interface Branding {
  readonly organisationName: string;
  readonly logoUrl: string | null;
  readonly bannerUrl: string | null;
}

export function WelcomeScreen({
  branding,
  badge,
  title,
  description,
  meta,
  ctaLabel,
  onStart,
  children,
}: {
  branding: Branding;
  badge?: string | undefined;
  title: string;
  description?: string | undefined;
  meta?: readonly string[];
  ctaLabel: string;
  onStart: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="sp-screen sp-screen--welcome">
      {/* Même cadre que l'aperçu de l'éditeur et que la miniature de la liste
          (`BannerFrame`) : l'organisation voit exactement ce que verra le
          répondant. Le rapport de forme est réservé en CSS, donc la page ne
          saute pas quand l'image arrive.

          `next/image` est écarté : il ferait transiter la bannière de CHAQUE
          organisation par l'optimiseur de Vercel, facturé à l'usage — sur une
          plateforme revendable, le coût croît avec le nombre de clients. Les
          bannières sont servies par le CDN de Storage et bornées à l'envoi. */}
      {branding.bannerUrl ? <BannerFrame url={branding.bannerUrl} lazy /> : null}

      <div className="sp-screen__body">
        <div className="sp-brandline">
          {branding.logoUrl ? (
            // Même raison que pour la bannière : un logo par organisation.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="sp-brandline__logo"
              src={branding.logoUrl}
              alt={branding.organisationName}
              width={120}
              height={40}
              decoding="async"
            />
          ) : (
            <span className="sp-brandline__name">{branding.organisationName}</span>
          )}
        </div>

        {badge ? <p className="sp-badge sp-badge--accent">{badge}</p> : null}
        <h1 className="sp-screen__title">{title}</h1>
        {description ? <p className="sp-screen__lead">{description}</p> : null}

        {meta && meta.length > 0 ? (
          <ul className="sp-meta">
            {meta.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        ) : null}

        {children}

        <button className="sp-btn sp-btn--lg" type="button" onClick={onStart}>
          {ctaLabel}
        </button>
      </div>
    </div>
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

export interface CalendarActions {
  readonly google: string;
  readonly outlook: string;
  readonly ics: string;
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
  directions?: { google: string; openStreetMap: string; apple: string } | undefined;
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

        {calendar ? (
          <section className="sp-actions-block">
            <h3>{fr.survey.addToCalendar}</h3>
            <div className="sp-actions">
              <a className="sp-btn sp-btn--outline sp-btn--sm" href={calendar.ics}>
                Fichier .ics
              </a>
              <a
                className="sp-btn sp-btn--outline sp-btn--sm"
                href={calendar.google}
                target="_blank"
                rel="noreferrer"
              >
                Google Agenda
              </a>
              <a
                className="sp-btn sp-btn--outline sp-btn--sm"
                href={calendar.outlook}
                target="_blank"
                rel="noreferrer"
              >
                Outlook
              </a>
            </div>
          </section>
        ) : null}

        {directions ? (
          <section className="sp-actions-block">
            <h3>{fr.survey.directions}</h3>
            <div className="sp-actions">
              <a
                className="sp-btn sp-btn--outline sp-btn--sm"
                href={directions.openStreetMap}
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>
              <a
                className="sp-btn sp-btn--outline sp-btn--sm"
                href={directions.google}
                target="_blank"
                rel="noreferrer"
              >
                Google Maps
              </a>
              <a
                className="sp-btn sp-btn--outline sp-btn--sm"
                href={directions.apple}
                target="_blank"
                rel="noreferrer"
              >
                Plans
              </a>
            </div>
          </section>
        ) : null}
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
