import type { ReactNode } from 'react';

/**
 * Champ de formulaire accessible.
 *
 * Le libellé est TOUJOURS un vrai `<label for>` — jamais un placeholder, qui
 * disparaît à la saisie et n'est pas lu comme une étiquette. L'aide et
 * l'erreur sont reliées au champ par `aria-describedby`, et l'erreur porte
 * `aria-invalid`, faute de quoi un lecteur d'écran annonce un champ valide.
 */

export interface FieldProps {
  id: string;
  label: string;
  children: (attributes: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
  }) => ReactNode;
  hint?: string;
  error?: string | null;
  required?: boolean;
}

export function Field({ id, label, children, hint, error, required }: FieldProps) {
  const hintId = hint ? `${id}-aide` : undefined;
  const errorId = error ? `${id}-erreur` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="sp-field">
      <label className="sp-label" htmlFor={id}>
        {label}
        {required ? (
          <>
            {' '}
            <span aria-hidden="true">*</span>
            <span className="sp-visually-hidden"> (obligatoire)</span>
          </>
        ) : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <span className="sp-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="sp-error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
