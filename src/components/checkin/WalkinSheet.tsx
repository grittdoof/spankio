'use client';

import { useEffect, useRef, useState } from 'react';
import type { WalkinField } from '@/lib/checkin/walkin';

/**
 * Le formulaire de l'invité de dernière minute.
 *
 * Il s'ouvre DANS la barre du bas, au-dessus de la recherche : là où est le
 * pouce, et là où était le bouton qui l'a ouvert. Ce n'est pas une fenêtre
 * modale — rien ne bloque le reste de l'écran, et un `aria-modal` promettrait
 * un piège à focus qu'on ne fournit pas. C'est un panneau dévoilé : le bouton
 * (+) porte `aria-expanded`, Échap le referme, et le focus revient au bouton.
 *
 * Les questions sont celles de l'organisation (`walkinFields`), avec leurs
 * intitulés : rien n'est écrit ici en dur.
 */

export type WalkinStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'error'; readonly message: string };

export interface WalkinSheetProps {
  readonly id: string;
  readonly fields: readonly WalkinField[];
  readonly status: WalkinStatus;
  readonly rehearsal: boolean;
  readonly onSubmit: (values: Readonly<Record<string, string>>) => Promise<boolean>;
  readonly onCancel: () => void;
}

export function WalkinSheet({ id, fields, status, rehearsal, onSubmit, onCancel }: WalkinSheetProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const first = useRef<HTMLInputElement>(null);
  const sending = status.kind === 'sending';

  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="sp-desk__sheet"
      id={id}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h2 className="sp-desk__sheet-title" id={`${id}-title`}>
        Invité de dernière minute
      </h2>

      {fields.length === 0 ? (
        <>
          <p className="sp-desk__sheet-note">
            Aucune question ne nomme les invités de cet événement : la personne
            ne pourrait pas être retrouvée dans la liste. L’organisateur peut la
            désigner dans l’écran de préparation. En attendant, notez-la sur la
            liste papier.
          </p>
          <div className="sp-desk__sheet-actions">
            <button className="sp-btn sp-btn--ghost" onClick={onCancel} type="button">
              Fermer
            </button>
          </div>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (sending) return;
            void onSubmit(values).then((ok) => {
              if (ok) setValues({});
            });
          }}
        >
          <p className="sp-desk__sheet-note">
            {rehearsal
              ? 'Essai à blanc : la personne n’apparaîtra que sur cet écran, jusqu’au prochain rechargement.'
              : 'La personne est ajoutée à la liste et pointée arrivée. Le rapport la comptera parmi les personnes venues sans s’être inscrites.'}
          </p>
          <div className="sp-desk__sheet-fields">
            {fields.map((field, index) => (
              <div className="sp-field" key={field.id}>
                <label className="sp-label" htmlFor={`${id}-${field.id}`}>
                  {field.label}
                </label>
                <input
                  autoCapitalize={field.type === 'text' ? 'words' : 'off'}
                  // Le téléphone est celui de l'hôtesse : lui proposer SES
                  // propres coordonnées pour remplir celles d'un invité serait
                  // une erreur qu'on ferait au doigt, sans la voir.
                  autoComplete="off"
                  className="sp-input"
                  disabled={sending}
                  id={`${id}-${field.id}`}
                  inputMode={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text'}
                  maxLength={200}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.id]: event.target.value }))
                  }
                  ref={index === 0 ? first : undefined}
                  type={field.type}
                  value={values[field.id] ?? ''}
                />
              </div>
            ))}
          </div>

          {status.kind === 'error' ? (
            <p className="sp-desk__sheet-error">{status.message}</p>
          ) : null}

          <div className="sp-desk__sheet-actions">
            <button className="sp-btn sp-btn--ghost" onClick={onCancel} type="button">
              Annuler
            </button>
            <button className="sp-btn" disabled={sending} type="submit">
              {sending ? 'Ajout en cours…' : 'Ajouter et pointer'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
