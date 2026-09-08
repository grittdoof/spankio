'use client';

import { useEffect, useState } from 'react';
import { BannerFrame } from '@/components/ui/BannerFrame';
import type { CtaPalette } from '@/lib/design/cta';
import type { CountdownParts } from '@/lib/event/countdown';
import { fr } from '@/lib/i18n/fr';
import type {
  PublicDetail,
  PublicMoment,
  PublicQuestion,
} from '@/lib/survey/public-page';
import { Countdown } from './Countdown';
import { EventMap } from './EventMap';
import {
  EventActions,
  type CalendarActions,
  type DirectionsActions,
} from './EventActions';

/**
 * Invitation publique d'un événement.
 *
 * C'est la page que reçoit un invité, et elle n'a qu'un but : qu'il sache
 * quand, où, pourquoi — puis qu'il réponde. Tout ce qui est ici sert l'un des
 * deux.
 *
 * **Chaque bloc est optionnel, et l'organisation décide de sa présence.** Ce
 * composant ne connaît pas les interrupteurs : il reçoit ce qui doit être
 * affiché, déjà filtré (`src/lib/survey/public-page.ts`). Un bloc absent des
 * propriétés ne laisse aucun titre orphelin derrière lui — c'est la raison
 * pour laquelle le filtrage vit en amont et non dans une cascade de
 * conditions ici.
 *
 * **Aucune carte n'est chargée.** L'itinéraire est fait de LIENS : rien ne
 * part vers un tiers avant le clic. Afficher une carte à tuiles sur une page
 * publique enverrait l'adresse IP de chaque invité au serveur de tuiles, à un
 * volume que la politique d'usage d'OpenStreetMap ne prévoit pas.
 */

export interface InvitationBranding {
  readonly organisationName: string;
  /** Déjà filtré : `null` si le bloc « logo » est masqué. */
  readonly logoUrl: string | null;
  /** Déjà filtré : `null` si le bloc « visuel » est masqué. */
  readonly bannerUrl: string | null;
}

export interface InvitationProps {
  branding: InvitationBranding;
  /** Pastille du visuel (« Inscriptions ouvertes »). */
  status?: string | null;
  badge?: string | undefined;
  title: string;
  description?: string | undefined;
  /** Date de l'événement, déjà mise en forme dans SON fuseau. */
  when?: string | null;
  /** Fin, ou précision d'horaire, sous la date. */
  whenNote?: string | null;
  place?: { readonly label: string | null; readonly address: string | null } | null;
  countdown?: { readonly startsAt: string; readonly initial: CountdownParts } | null;
  /** Nombre d'inscriptions déjà reçues. */
  responseCount?: number | null;
  /** Date limite de réponse, déjà mise en forme. */
  deadline?: string | null;
  details?: readonly PublicDetail[];
  organiserWord?:
    | {
        readonly author?: string | undefined;
        readonly role?: string | undefined;
        readonly text: string;
      }
    | null;
  programme?: readonly PublicMoment[];
  calendar?: CalendarActions | null;
  directions?: DirectionsActions | null;
  travelNote?: string | null;
  /**
   * Coordonnées du lieu, quand le bloc « carte » est ouvert. `null` sinon —
   * c'est la page qui décide, pas ce composant.
   */
  mapPoint?: { readonly latitude: number; readonly longitude: number } | null;
  faq?: readonly PublicQuestion[];
  /** Adresse de la page, à copier. `null` si le bloc est masqué. */
  shareUrl?: string | null;
  privacyNote?: string | null;
  ctaLabel: string;
  /**
   * Couleur du bouton d'inscription, DÉJÀ validée et mesurée. `null` : la
   * charte s'applique. Le composant ne calcule rien ici — recevoir une palette
   * toute faite est ce qui garantit qu'aucune couleur illisible ne peut
   * atteindre le rendu.
   */
  ctaPalette?: CtaPalette | null;
  onStart: () => void;
  /** Contenu inséré avant l'appel à l'action (message d'erreur d'envoi…). */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Icônes
// ---------------------------------------------------------------------------

/**
 * Jeu d'icônes minimal, dessiné en ligne.
 *
 * En ligne et non en fichiers : une icône est une origine de moins à autoriser
 * dans la politique de sécurité de contenu, et ces cinq traits ne justifient
 * pas une requête réseau. Toutes sont `aria-hidden` — chacune accompagne un
 * texte qui dit la même chose.
 */
function Icon({ name }: { name: 'calendar' | 'pin' | 'info' | 'clock' | 'link' }) {
  const paths: Readonly<Record<typeof name, React.ReactNode>> = {
    calendar: (
      <>
        <rect height="16" rx="3" width="18" x="3" y="5" />
        <path d="M8 3v4M16 3v4M3 11h18" />
      </>
    ),
    pin: (
      <>
        <path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.6" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5M12 8.2v.2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8v5l3 2" />
      </>
    ),
    link: (
      <>
        <path d="M9 15l6-6" />
        <path d="M11 6.5l1.5-1.5a3.5 3.5 0 015 5L15 12" />
        <path d="M13 17.5L11.5 19a3.5 3.5 0 01-5-5L9 12" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="sp-invite__icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Partage
// ---------------------------------------------------------------------------

/**
 * Partage du lien.
 *
 * L'adresse est ÉCRITE, toujours : c'est le seul partage qui fonctionne
 * partout, y compris sans JavaScript et dans un navigateur sans presse-papier.
 * Le bouton de copie n'apparaît qu'après le montage et seulement si l'API
 * existe — un bouton qui ne fait rien vaut moins que pas de bouton.
 */
function Share({ url }: { url: string }) {
  const [copyable, setCopyable] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopyable(typeof navigator !== 'undefined' && Boolean(navigator.clipboard));
  }, []);

  return (
    <section className="sp-card sp-invite__share">
      <h2 className="sp-invite__legend">
        <Icon name="link" />
        Partager cette invitation
      </h2>
      <p className="sp-invite__url">{url}</p>
      {copyable ? (
        <p>
          <button
            className="sp-btn sp-btn--outline sp-btn--sm"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
            type="button"
          >
            {copied ? 'Lien copié' : 'Copier le lien'}
          </button>
        </p>
      ) : null}
      {/* L'annonce n'est faite qu'après une action de l'utilisateur : une zone
          live vide au chargement reste silencieuse. */}
      <p aria-live="polite" className="sp-visually-hidden">
        {copied ? 'Lien copié dans le presse-papier.' : ''}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Invitation
// ---------------------------------------------------------------------------

export function Invitation({
  branding,
  status,
  badge,
  title,
  description,
  when,
  whenNote,
  place,
  countdown,
  responseCount,
  deadline,
  details,
  organiserWord,
  programme,
  calendar,
  directions,
  travelNote,
  mapPoint,
  faq,
  shareUrl,
  privacyNote,
  ctaLabel,
  ctaPalette,
  onStart,
  children,
}: InvitationProps) {
  const hasPractical =
    Boolean(when) || Boolean(place?.label ?? place?.address) || (details?.length ?? 0) > 0;

  return (
    <div className="sp-invite">
      {/* --- Héro : visuel, marque, titre ------------------------------- */}
      <header className="sp-invite__hero">
        {/* Même cadre que l'aperçu de l'éditeur et que la miniature de la
            liste (`BannerFrame`) : l'organisation voit exactement ce que verra
            l'invité. Le rapport de forme est réservé en CSS, donc la page ne
            saute pas quand l'image arrive.

            `next/image` est écarté : il ferait transiter la bannière de CHAQUE
            organisation par l'optimiseur de Vercel, facturé à l'usage — sur
            une plateforme revendable, le coût croît avec le nombre de
            clients. */}
        {branding.bannerUrl ? (
          <div className="sp-welcome__visual">
            <BannerFrame url={branding.bannerUrl} />
          </div>
        ) : null}

        <div className="sp-invite__title">
          <p className="sp-brandline">
            {branding.logoUrl ? (
              // Même raison que pour la bannière : un logo par organisation.
              //
              // `width`/`height` ne dimensionnent pas — le CSS borne la
              // hauteur et la largeur suit le rapport de forme réel de
              // l'image. Ils déclarent ce rapport pour que le navigateur
              // réserve la place avant le chargement, et sont donc mis à
              // l'échelle avec la taille rendue.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={branding.organisationName}
                className="sp-brandline__logo"
                decoding="async"
                height={80}
                src={branding.logoUrl}
                width={240}
              />
            ) : (
              <span className="sp-brandline__name">{branding.organisationName}</span>
            )}
          </p>

          <p className="sp-invite__badges">
            {status ? (
              <span className="sp-invite__status">
                <span aria-hidden="true" className="sp-invite__dot" />
                {status}
              </span>
            ) : null}
            {badge ? <span className="sp-badge sp-badge--accent">{badge}</span> : null}
          </p>

          <h1 className="sp-invite__heading">{title}</h1>
          {description ? <p className="sp-screen__lead">{description}</p> : null}
        </div>
      </header>

      {/* Le compte à rebours vient JUSTE après le héro dans le DOM : sur une
          colonne unique c'est là qu'on le cherche, et il ne contient aucun
          élément focalisable — l'avancer ne dérange donc pas l'ordre de
          tabulation, ce qu'un `order` CSS aurait fait. Au-delà de 64rem, la
          grille le place en haut de la colonne de droite. */}
      {countdown ? (
        <Countdown initial={countdown.initial} startsAt={countdown.startsAt} />
      ) : null}

      {/* --- Colonne de lecture ---------------------------------------- */}
      <div className="sp-invite__main">
        {hasPractical ? (
          <section className="sp-card sp-invite__facts">
            <h2 className="sp-visually-hidden">Informations pratiques</h2>
            <ul>
              {when ? (
                <li className="sp-fact">
                  <span className="sp-fact__mark sp-fact__mark--accent">
                    <Icon name="calendar" />
                  </span>
                  <span>
                    <strong className="sp-fact__title">{when}</strong>
                    {whenNote ? <span className="sp-fact__note">{whenNote}</span> : null}
                  </span>
                </li>
              ) : null}
              {place?.label ?? place?.address ? (
                <li className="sp-fact">
                  <span className="sp-fact__mark sp-fact__mark--accent">
                    <Icon name="pin" />
                  </span>
                  <span>
                    <strong className="sp-fact__title">
                      {place?.label ?? place?.address}
                    </strong>
                    {place?.label && place.address ? (
                      <span className="sp-fact__note">{place.address}</span>
                    ) : null}
                  </span>
                </li>
              ) : null}
              {(details ?? []).map((detail) => (
                <li className="sp-fact" key={`${detail.label}-${detail.value ?? ''}`}>
                  <span className="sp-fact__mark">
                    <Icon name="info" />
                  </span>
                  <span>
                    <strong className="sp-fact__title">{detail.label}</strong>
                    {detail.value ? <span className="sp-fact__note">{detail.value}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {organiserWord ? (
          <section className="sp-card sp-invite__word">
            <p className="sp-invite__signature">
              <span aria-hidden="true" className="sp-invite__avatar">
                {initials(organiserWord.author ?? branding.organisationName)}
              </span>
              <span>
                <strong className="sp-fact__title">
                  {organiserWord.author ?? branding.organisationName}
                </strong>
                {organiserWord.role ? (
                  <span className="sp-fact__note">{organiserWord.role}</span>
                ) : null}
              </span>
            </p>
            {/* Le texte est rendu ENTIER, jamais tronqué derrière un « lire la
                suite » : un paragraphe d'invitation fait quelques phrases, et
                un dépliant de plus est un geste de plus avant l'essentiel. */}
            {organiserWord.text.split(/\n{2,}/).map((paragraph) => (
              <p className="sp-invite__prose" key={paragraph}>
                {paragraph}
              </p>
            ))}
          </section>
        ) : null}

        {(programme?.length ?? 0) > 0 ? (
          <section className="sp-card">
            <h2 className="sp-invite__legend">
              <Icon name="clock" />
              Déroulé
            </h2>
            <ol className="sp-timeline">
              {(programme ?? []).map((moment) => (
                <li className="sp-timeline__item" key={`${moment.time ?? ''}-${moment.title}`}>
                  {moment.time ? (
                    <span className="sp-timeline__time">{moment.time}</span>
                  ) : null}
                  <span className="sp-timeline__body">
                    <strong className="sp-fact__title">{moment.title}</strong>
                    {moment.note ? <span className="sp-fact__note">{moment.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {directions || travelNote || mapPoint ? (
          <section className="sp-card">
            <h2 className="sp-invite__legend">
              <Icon name="pin" />
              S’y rendre
            </h2>
            {mapPoint ? (
              <EventMap
                label={place?.label ?? place?.address ?? null}
                latitude={mapPoint.latitude}
                longitude={mapPoint.longitude}
              />
            ) : null}
            {travelNote ? <p className="sp-invite__prose">{travelNote}</p> : null}
            {directions ? (
              <EventActions directions={directions} headingLevel={3} />
            ) : null}
          </section>
        ) : null}

        {/* L'agenda RESTE dans la colonne de lecture, contrairement au compte
            à rebours : il contient des liens, et les déplacer dans une colonne
            de droite ferait sauter le focus d'un bord à l'autre de l'écran. */}
        {calendar ? (
          <section className="sp-card">
            <EventActions calendar={calendar} headingLevel={2} />
          </section>
        ) : null}

        {(faq?.length ?? 0) > 0 ? (
          <section className="sp-card sp-invite__faq">
            <h2 className="sp-invite__legend">
              <Icon name="info" />
              Questions fréquentes
            </h2>
            {/* De vrais `details` natifs : ouvrables au clavier, fonctionnels
                sans JavaScript, et déjà annoncés correctement par les lecteurs
                d'écran. Une accordéon maison redirait tout cela moins bien. */}
            {(faq ?? []).map((entry) => (
              <details key={entry.question}>
                <summary>{entry.question}</summary>
                <p className="sp-invite__prose">{entry.answer}</p>
              </details>
            ))}
          </section>
        ) : null}

        {shareUrl ? <Share url={shareUrl} /> : null}

        {privacyNote ? <p className="sp-invite__note">{privacyNote}</p> : null}
      </div>

      {/* --- Appel à l'action, collant ---------------------------------- */}
      <div className="sp-invite__cta">
        <div className="sp-invite__cta-text">
          {/* Formulation courte à dessein : « Réponse attendue avant le … »
              repliait la barre collante sur trois lignes à 375 px, mesurée à
              143 pixels de haut, soit près d'un cinquième de l'écran. */}
          {deadline ? (
            <strong className="sp-fact__title">Réponse avant le {deadline}</strong>
          ) : (
            <strong className="sp-fact__title">{fr.survey.start}</strong>
          )}
          {typeof responseCount === 'number' && responseCount > 0 ? (
            <span className="sp-fact__note">
              {responseCount} inscription{responseCount > 1 ? 's' : ''} déjà enregistrée
              {responseCount > 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
        {/* La couleur passe par les variables internes de `sp-btn`
            (`--_bg`, `--_bg-hover`, `--_fg`) : le composant garde ses tailles,
            ses transitions et son anneau de focus, seule la peinture change.
            L'anneau de focus reste celui de la charte, décalé de 2 px — il se
            détache donc du FOND DE PAGE, dont le contraste est déjà vérifié,
            et non du bouton. */}
        <button
          className="sp-btn sp-btn--lg"
          onClick={onStart}
          style={
            ctaPalette
              ? ({
                  '--_bg': ctaPalette.background,
                  '--_bg-hover': ctaPalette.hover,
                  '--_fg': ctaPalette.ink,
                } as React.CSSProperties)
              : undefined
          }
          type="button"
        >
          {ctaLabel}
        </button>
      </div>

      {children}
    </div>
  );
}

/** Initiales de l'auteur, pour la pastille de signature. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word[0] ?? ''))
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase('fr-FR');
}
