/**
 * Jauge annulaire.
 *
 * Deux règles, les mêmes que pour `sp-bar` :
 *
 *  1. **L'anneau ne porte aucune information à lui seul.** Le pourcentage est
 *     écrit au centre et le rapport complet juste à côté ; l'arc n'est qu'un
 *     renfort, donc `aria-hidden`.
 *  2. **Aucune jauge sans dénominateur.** Le composant exige `total` : un
 *     anneau dont on ignore le tout ne veut rien dire, et l'inventer serait
 *     pire que de ne rien afficher.
 */

export interface DonutProps {
  value: number;
  total: number;
  /** Ce que le centre annonce sous le pourcentage, sur deux lignes au plus. */
  caption?: string;
  /** `light` : posé sur un fond sombre. */
  variant?: 'default' | 'light';
  /** Diamètre en pixels. Le tracé s'adapte. */
  size?: number;
}

export function Donut({ value, total, caption, variant = 'default', size = 96 }: DonutProps) {
  const share = total <= 0 ? 0 : Math.min(100, Math.round((value / total) * 100));
  const radius = size / 2 - size * 0.083;
  const circumference = 2 * Math.PI * radius;
  // Longueur de l'arc, bornée : au-delà de 100 %, l'anneau reste plein plutôt
  // que de repartir pour un second tour.
  const drawn = (Math.min(share, 100) / 100) * circumference;

  return (
    <div
      className={`sp-donut${variant === 'light' ? ' sp-donut--light' : ''}`}
      style={{ '--sp-donut-size': `${size}px` } as React.CSSProperties}
    >
      <svg aria-hidden="true" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle
          className="sp-donut__track"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeWidth={size * 0.094}
        />
        <circle
          className="sp-donut__arc"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeDasharray={`${drawn.toFixed(1)} ${circumference.toFixed(1)}`}
          strokeLinecap="round"
          strokeWidth={size * 0.094}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="sp-donut__text">
        <span className="sp-donut__value">{share}&nbsp;%</span>
        {caption ? <span className="sp-donut__caption">{caption}</span> : null}
      </span>
    </div>
  );
}
