'use client';

import { useId, useRef, useState } from 'react';

/**
 * Aide contextuelle.
 *
 * Bâtie sur un vrai bouton et une région révélée, pas sur l'attribut `title` :
 * `title` ne s'ouvre ni au clavier ni au toucher, son délai d'apparition n'est
 * pas réglable, et sa restitution par les lecteurs d'écran varie d'un couple
 * navigateur/lecteur à l'autre. Ce n'est pas une info-bulle, c'est un pari.
 *
 * Le motif retenu est un « disclosure » : `aria-expanded` sur le bouton,
 * `aria-controls` vers la bulle. Il fonctionne au clavier, au toucher et à la
 * souris, et l'état est annoncé.
 *
 * Deux ouvertures INDÉPENDANTES cohabitent — le survol et l'épinglage (clic ou
 * focus clavier) — parce qu'une seule ne suffit pas :
 *
 *  * si le survol fermait la bulle épinglée, elle disparaîtrait dès que le
 *    pointeur s'écarte pour lire ;
 *  * si le focus ouvrait dans tous les cas, un clic à la souris ouvrirait au
 *    focus puis refermerait au clic — le bouton paraîtrait inerte. D'où le
 *    repérage du `pointerdown` : quand le focus vient d'un pointeur, on laisse
 *    le clic décider.
 *
 * Fermeture par Échap sans déplacer le pointeur ni le focus : WCAG 1.4.13.
 */

export interface TooltipProps {
  /** Ce que l'aide décrit, pour l'annonce : « Aide : durée de conservation ». */
  label: string;
  children: React.ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pointerFocus = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const open = hovered || pinned;

  return (
    <span
      className="sp-tip"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setHovered(false);
          setPinned(false);
          buttonRef.current?.focus();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        aria-controls={`${id}-bulle`}
        aria-expanded={open}
        aria-label={`Aide : ${label}`}
        className="sp-tip__button"
        onBlur={() => setPinned(false)}
        onClick={() => setPinned((previous) => !previous)}
        onFocus={() => {
          if (pointerFocus.current) {
            pointerFocus.current = false;
            return;
          }
          setPinned(true);
        }}
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        ref={buttonRef}
        type="button"
      >
        <span aria-hidden="true">?</span>
      </button>
      <span className="sp-tip__bubble" hidden={!open} id={`${id}-bulle`} role="note">
        {children}
      </span>
    </span>
  );
}
