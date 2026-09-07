/**
 * Géométrie d'une courbe d'évolution.
 *
 * Elle vit ici, en fonction pure, et non dans le composant : un chemin SVG
 * composé à la volée dans du JSX ne se vérifie qu'à l'œil, alors qu'une erreur
 * d'échelle y est invisible — une courbe fausse ressemble à une courbe.
 *
 * Le repère est fixe (0 → `width`, `top` → `bottom`) et l'échelle verticale
 * part TOUJOURS de zéro : tronquer l'axe exagérerait la moindre variation, ce
 * qu'un tableau de bord ne doit pas faire.
 */

export interface SparkPoint {
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly label: string;
}

export interface Sparkline {
  readonly points: readonly SparkPoint[];
  /** Chemin de la courbe, `''` si aucun point. */
  readonly line: string;
  /** Même chemin refermé sur la ligne de base, pour l'aplat. */
  readonly area: string;
  /** Valeur haute du repère, jamais nulle : sinon la courbe serait plate à 0. */
  readonly ceiling: number;
}

export interface SparklineOptions {
  readonly width?: number;
  readonly top?: number;
  readonly bottom?: number;
  /** Marge latérale, pour qu'un point du bord ne soit pas coupé. */
  readonly inset?: number;
}

export function sparkline(
  series: readonly { readonly count: number; readonly label: string }[],
  options: SparklineOptions = {},
): Sparkline {
  const width = options.width ?? 320;
  const top = options.top ?? 8;
  const bottom = options.bottom ?? 92;
  const inset = options.inset ?? 10;

  if (series.length === 0) {
    return { points: [], line: '', area: '', ceiling: 1 };
  }

  const highest = series.reduce((max, entry) => Math.max(max, entry.count), 0);
  // Un plafond au-dessus du maximum laisse respirer le sommet ; `1` au minimum
  // évite une division par zéro quand aucune réponse n'est arrivée.
  const ceiling = Math.max(1, Math.ceil(highest * 1.15));
  const span = width - inset * 2;
  const height = bottom - top;

  const points: SparkPoint[] = series.map((entry, index) => ({
    x:
      series.length === 1
        ? width / 2
        : round(inset + (index / (series.length - 1)) * span),
    y: round(bottom - (entry.count / ceiling) * height),
    value: entry.count,
    label: entry.label,
  }));

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `${line} L${last.x} ${bottom} L${first.x} ${bottom} Z`;

  return { points, line, area, ceiling };
}

/** Un dixième de pixel suffit, et garde le chemin lisible dans le DOM. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
