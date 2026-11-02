'use client';

import { useEffect, useState } from 'react';

/**
 * Un texte à transmettre, écrit en clair, avec un bouton de copie quand le
 * navigateur sait copier.
 *
 * Même discipline que le partage de l'invitation publique, et pour la même
 * raison : le texte est TOUJOURS écrit. C'est le seul partage qui fonctionne
 * partout — sans JavaScript, dans un navigateur sans presse-papier, et sur le
 * téléphone d'où l'on recopie à la main. Le bouton n'apparaît qu'après le
 * montage et seulement si l'API existe : un bouton qui ne fait rien vaut moins
 * que pas de bouton.
 *
 * L'annonce du succès n'est faite qu'APRÈS un clic — une zone live vide au
 * chargement reste silencieuse, et ne vient donc pas interrompre la lecture.
 */
export interface CopyBoxProps {
  /** Le texte exact qui sera copié, et celui qui est affiché. */
  value: string;
  label: string;
  /** Rendu sur plusieurs lignes : un message, par opposition à une adresse. */
  multiline?: boolean;
}

export function CopyBox({ value, label, multiline = false }: CopyBoxProps) {
  const [copyable, setCopyable] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopyable(typeof navigator !== 'undefined' && Boolean(navigator.clipboard));
  }, []);

  return (
    <div className="sp-copybox">
      <div className="sp-copybox__head">
        <span className="sp-copybox__label">{label}</span>
        {copyable ? (
          <button
            className="sp-btn sp-btn--outline sp-btn--sm"
            onClick={() => {
              void navigator.clipboard.writeText(value).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
            type="button"
          >
            {copied ? 'Copié' : 'Copier'}
          </button>
        ) : null}
      </div>
      {multiline ? (
        <pre className="sp-copybox__text">{value}</pre>
      ) : (
        <p className="sp-copybox__text sp-copybox__text--one">{value}</p>
      )}
      <p aria-live="polite" className="sp-visually-hidden">
        {copied ? `${label} copié.` : ''}
      </p>
    </div>
  );
}
