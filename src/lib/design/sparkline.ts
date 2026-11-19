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

/**
 * Le cadre du graphique, partagé par les deux courbes de l'application.
 *
 * Il DÉBORDE à gauche et à droite du repère (0 → 320) : une étiquette penchée
 * descend en biais depuis le point qu'elle nomme, et celle du premier point
 * sortirait sinon du cadre — un `viewBox` clippe ce qui en sort, et le repère
 * perdrait justement son origine. La hauteur, elle, laisse la place à cette
 * descente sous la ligne de base.
 *
 * Il vit ici, avec la géométrie, parce que deux composants qui le
 * recopieraient finiraient par pencher leur texte dans un cadre qui n'a plus
 * la place de l'accueillir.
 */
export const SPARK_FRAME = {
  /** Le repère utile : la courbe et les règles vont de 0 à cette largeur. */
  plotWidth: 320,
  /** Débord de part et d'autre, pour les étiquettes penchées. */
  gutter: 20,
  height: 128,
  /** Ordonnées des trois règles horizontales. */
  rules: [8, 50, 92],
} as const;

export const SPARK_VIEWBOX = `${-SPARK_FRAME.gutter} 0 ${
  SPARK_FRAME.plotWidth + SPARK_FRAME.gutter * 2
} ${SPARK_FRAME.height}`;

/** Ligne de base des étiquettes : les penchées descendent EN DESSOUS. */
export const TICK_BASELINE = 100;

/**
 * Inclinaison des étiquettes d'axe : 45°, pour les deux courbes.
 *
 * C'est l'angle qui se lit encore sans tourner la tête, et il divise par
 * presque deux la place horizontale qu'une heure réclame — assez pour que les
 * dix-sept tranches d'une soirée tiennent toutes, là où le texte à plat en
 * faisait taire une sur deux.
 */
export const TICK_ANGLE = 45;

export interface SparkPoint {
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly label: string;
  /**
   * Étiquette à écrire SOUS le point, ou `null` quand il faut la taire.
   *
   * Défaut réel : les dix-sept tranches d'une soirée écrivaient leurs
   * dix-sept horaires sous une courbe large de 300 unités, soit moins de
   * 19 unités par étiquette là où « 18:40 » en demande vingt-cinq. Les heures
   * se touchaient — « 18:4018:5019:00 » — et l'axe devenait illisible au
   * moment précis où il sert à lire l'affluence.
   *
   * La première réponse est l'INCLINAISON (`tickAngle`), pas le silence :
   * deux étiquettes penchées sont parallèles, donc elles ne se gênent plus
   * par leur longueur mais seulement par leur hauteur de ligne — et toutes
   * les heures restent lisibles. L'espacement ne reprend la main que lorsque
   * même cela ne suffit plus, c'est-à-dire sur les séries très denses (trente
   * jours de rythme d'inscription). Taire une étiquette est le dernier
   * recours, jamais le premier.
   *
   * La décision se prend ICI et non dans le composant, pour la même raison
   * que la géométrie : un espacement calculé à la volée dans du JSX ne se
   * vérifie qu'à l'œil, et une étiquette tue par erreur ne se voit pas. Les
   * VALEURS, elles, ne sont jamais tues — elles sont l'information, l'axe
   * n'est qu'un repère.
   */
  readonly tick: string | null;
}

export interface Sparkline {
  readonly points: readonly SparkPoint[];
  /** Chemin de la courbe, `''` si aucun point. */
  readonly line: string;
  /** Même chemin refermé sur la ligne de base, pour l'aplat. */
  readonly area: string;
  /** Valeur haute du repère, jamais nulle : sinon la courbe serait plate à 0. */
  readonly ceiling: number;
  /** Inclinaison retenue, que le composant applique telle quelle. */
  readonly tickAngle: number;
}

export interface SparklineOptions {
  readonly width?: number;
  readonly top?: number;
  readonly bottom?: number;
  /** Marge latérale, pour qu'un point du bord ne soit pas coupé. */
  readonly inset?: number;
  /**
   * Largeur d'un caractère d'étiquette, en unités du repère. Par défaut celle
   * de la charte à 9px, mesurée dans un navigateur ; un appelant qui écrirait
   * ses étiquettes autrement la redonne plutôt que de laisser deviner.
   */
  readonly charWidth?: number;
  /**
   * Inclinaison des étiquettes, en degrés (0 = à plat). Elle appartient au
   * calcul et non au seul rendu : c'est elle qui décide combien d'étiquettes
   * tiennent, et un composant qui pencherait son texte sans le dire ici
   * ferait taire des repères qui avaient la place de s'afficher.
   */
  readonly tickAngle?: number;
}

export function sparkline(
  series: readonly { readonly count: number; readonly label: string }[],
  options: SparklineOptions = {},
): Sparkline {
  const width = options.width ?? 320;
  const top = options.top ?? 8;
  const bottom = options.bottom ?? 92;
  const inset = options.inset ?? 10;
  const charWidth = options.charWidth ?? CHAR_WIDTH;
  // Bornée à l'angle droit : au-delà, le texte repart à l'envers.
  const tickAngle = Math.min(90, Math.max(0, options.tickAngle ?? 0));

  if (series.length === 0) {
    return { points: [], line: '', area: '', ceiling: 1, tickAngle };
  }

  const highest = series.reduce((max, entry) => Math.max(max, entry.count), 0);
  // Un plafond au-dessus du maximum laisse respirer le sommet ; `1` au minimum
  // évite une division par zéro quand aucune réponse n'est arrivée.
  const ceiling = Math.max(1, Math.ceil(highest * 1.15));
  const span = width - inset * 2;
  const height = bottom - top;

  /*
   * Place qu'il faut à une étiquette, selon qu'elle est à plat ou penchée.
   *
   * À PLAT, c'est sa longueur qui commande, et on mesure la PLUS LONGUE : une
   * seule étiquette trop large suffit à faire se toucher deux colonnes, et
   * retenir la moyenne laisserait justement passer ce cas-là.
   *
   * PENCHÉES, les étiquettes sont PARALLÈLES : leur longueur ne les fait plus
   * se rencontrer, seule leur hauteur de ligne compte. Deux voisines distantes
   * de `gap` sur l'axe sont séparées de `gap × sin(angle)` perpendiculairement
   * — il suffit que cela dépasse une hauteur de ligne. C'est ce qui permet
   * d'afficher les dix-sept horaires d'une soirée là où le texte à plat n'en
   * laissait passer qu'un sur deux.
   *
   * Dans les deux cas l'estimation est volontairement large : se tromper par
   * excès retire une étiquette, se tromper par défaut les fait se chevaucher,
   * et seul le second défaut se voit comme un bogue.
   */
  const longest = series.reduce((max, entry) => Math.max(max, entry.label.length), 0);
  const needed =
    tickAngle === 0
      ? longest * charWidth + LABEL_GUTTER
      : (LINE_HEIGHT + ROTATED_GUTTER) / Math.sin((tickAngle * Math.PI) / 180);
  const gap = series.length > 1 ? span / (series.length - 1) : span;
  // Le pas part de la PREMIÈRE tranche : c'est le début de la série, et un axe
  // dont le premier repère manque ne se raccroche à rien.
  const step = Math.max(1, Math.ceil(needed / Math.max(gap, 0.01)));

  const points: SparkPoint[] = series.map((entry, index) => ({
    x:
      series.length === 1
        ? width / 2
        : round(inset + (index / (series.length - 1)) * span),
    y: round(bottom - (entry.count / ceiling) * height),
    value: entry.count,
    label: entry.label,
    tick: index % step === 0 ? entry.label : null,
  }));

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `${line} L${last.x} ${bottom} L${first.x} ${bottom} Z`;

  return { points, line, area, ceiling, tickAngle };
}

/**
 * Largeur moyenne d'un caractère d'étiquette, en unités du repère.
 *
 * Montserrat à 9px dans un repère de 320 unités : un chiffre mesure environ
 * 5,4 unités, un deux-points moins. On retient la valeur du chiffre, qui
 * majore — voir le commentaire de `tick`.
 */
const CHAR_WIDTH = 5.4;

/** Blanc minimal entre deux étiquettes voisines : sans lui, elles se frôlent. */
const LABEL_GUTTER = 6;

/** Hauteur d'une ligne d'étiquette, en unités du repère : la taille de police. */
const LINE_HEIGHT = 9;

/** Blanc entre deux étiquettes penchées, mesuré perpendiculairement. */
const ROTATED_GUTTER = 1.5;

/** Un dixième de pixel suffit, et garde le chemin lisible dans le DOM. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
