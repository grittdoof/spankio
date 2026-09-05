'use client';

import { useFormStatus } from 'react-dom';

/**
 * Bouton d'envoi d'un formulaire serveur, avec retour visuel pendant l'envoi.
 *
 * `useFormStatus` lit l'état du `<form>` parent : le retour arrive DANS le
 * bouton, là où le clic a eu lieu, plutôt que dans un coin de l'écran. Le
 * bouton se désactive aussi pendant l'envoi, ce qui règle au passage le double
 * clic — un second envoi créerait un second brouillon.
 *
 * Dégradation : sans JavaScript, `useFormStatus` reste à `pending: false` et le
 * bouton se comporte comme un `<button type="submit">` ordinaire. Le
 * formulaire, lui, part quand même : c'est une action serveur.
 */

export interface SubmitButtonProps {
  children: React.ReactNode;
  /** Libellé pendant l'envoi. Un verbe en cours, pas un point d'attente. */
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}

export function SubmitButton({
  children,
  pendingLabel = 'Envoi en cours…',
  className = 'sp-btn',
  disabled,
  name,
  value,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={pending || disabled}
      type="submit"
      {...(name ? { name } : {})}
      {...(value !== undefined ? { value } : {})}
    >
      {pending ? (
        <>
          <span aria-hidden="true" className="sp-spinner" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
