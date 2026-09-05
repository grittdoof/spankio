/**
 * Avancement dans un parcours guidé.
 *
 * La position est TOUJOURS écrite (« Étape 2 sur 5 ») : la barre n'est qu'un
 * renfort visuel, et une information portée par une seule longueur serait
 * perdue pour qui ne la voit pas. `role="progressbar"` porte les mêmes valeurs
 * pour les technologies d'assistance.
 */
export interface StepsProps {
  current: number;
  total: number;
  /** Nom de l'étape courante, annoncé après la position. */
  label?: string;
}

export function Steps({ current, total, label }: StepsProps) {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(Math.max(1, current), safeTotal);
  const percent = Math.round((safeCurrent / safeTotal) * 100);
  const text = `Étape ${safeCurrent} sur ${safeTotal}${label ? ` — ${label}` : ''}`;

  return (
    <div className="sp-steps">
      <div
        aria-label={text}
        aria-valuemax={safeTotal}
        aria-valuemin={1}
        aria-valuenow={safeCurrent}
        aria-valuetext={text}
        className="sp-steps__track"
        role="progressbar"
      >
        <span className="sp-steps__fill" style={{ width: `${percent}%` }} />
      </div>
      <span aria-hidden="true" className="sp-steps__label">
        {safeCurrent} / {safeTotal}
      </span>
    </div>
  );
}
