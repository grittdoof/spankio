import {
  SPARK_FRAME,
  TICK_BASELINE,
  type Sparkline,
} from '@/lib/design/sparkline';
import { CSS_TOKEN_HEX } from '@/lib/design/tokens';

/**
 * La courbe d'affluence, dessinée en vectoriel NATIF Word.
 *
 * Premier réflexe écarté : remplacer la courbe par un tableau de valeurs dans
 * le document Word. C'était défendable — « un graphique est un renfort, jamais
 * un porteur d'information » — mais ce n'était pas ce qui avait été demandé :
 * le document doit montrer la MÊME chose que l'écran. Deuxième écarté : une
 * image. Il aurait fallu un rastériseur, donc une dépendance, pour un résultat
 * qui ne se redimensionne pas et que personne ne peut retoucher.
 *
 * Reste le dessin vectoriel, que Word comprend depuis toujours : des chemins,
 * des ellipses et des zones de texte, groupés en un seul objet. Le document
 * garde donc une courbe nette à l'impression, et modifiable par celui qui le
 * reçoit.
 *
 * **La géométrie n'est PAS recalculée ici** : elle vient de `sparkline`, la
 * même fonction pure qui alimente le SVG de l'écran. Ce module ne fait que la
 * traduire — unités du repère vers unités Word, chemins SVG vers chemins
 * DrawingML. Deux géométries auraient divergé, et le document aurait fini par
 * montrer une autre soirée que l'écran.
 */

/** Un point typographique en unités Word (EMU). */
const EMU_PER_POINT = 12700;

/**
 * Points par unité du repère.
 *
 * Choisi pour que la courbe occupe la largeur utile d'une carte sans la
 * toucher : 360 unités × 1,2 = 432 points, contre 465 de largeur intérieure.
 */
const SCALE = 1.2;

/** Rayon d'un point de la courbe, en unités du repère, comme à l'écran. */
const DOT_RADIUS = 3.4;

/** Hauteurs de police, en unités du repère : celles de la feuille de style. */
const VALUE_SIZE = 10;
const TICK_SIZE = 9;

/** Largeur moyenne d'un caractère, pour dimensionner une zone de texte. */
const CHAR_WIDTH = 5.4;

const COLORS = {
  marine: CSS_TOKEN_HEX['--sp-marine']!.slice(1),
  accent: CSS_TOKEN_HEX['--sp-accent']!.slice(1),
  muted: CSS_TOKEN_HEX['--sp-text-muted']!.slice(1),
  border: CSS_TOKEN_HEX['--sp-border']!.slice(1),
  surface: CSS_TOKEN_HEX['--sp-surface']!.slice(1),
} as const;

/** Unité du repère → EMU. Entier : Word n'accepte pas de décimale ici. */
function emu(units: number): number {
  return Math.round(units * SCALE * EMU_PER_POINT);
}

/** Abscisse du repère → abscisse du dessin : le cadre déborde à gauche. */
function px(x: number): number {
  return emu(x + SPARK_FRAME.gutter);
}

const WIDTH = emu(SPARK_FRAME.plotWidth + SPARK_FRAME.gutter * 2);
const HEIGHT = emu(SPARK_FRAME.height);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Boîte d'une forme, exprimée dans le repère du groupe. */
function frame(rotation = 0): string {
  return `<a:xfrm${rotation ? ` rot="${rotation}"` : ''}><a:off x="0" y="0"/><a:ext cx="${WIDTH}" cy="${HEIGHT}"/></a:xfrm>`;
}

function shape(id: number, name: string, properties: string, body = '<wps:bodyPr/>'): string {
  return `<wps:wsp><wps:cNvPr id="${id}" name="${escapeXml(name)}"/><wps:cNvSpPr/><wps:spPr>${properties}</wps:spPr>${body}</wps:wsp>`;
}

/** Un chemin plein ou tracé, aux coordonnées du repère. */
function path(
  id: number,
  name: string,
  points: readonly (readonly [number, number])[],
  options: { readonly close?: boolean; readonly fill?: string; readonly alpha?: number; readonly stroke?: string; readonly width?: number },
): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  const segments =
    `<a:moveTo><a:pt x="${px(first![0])}" y="${emu(first![1])}"/></a:moveTo>` +
    rest
      .map(([x, y]) => `<a:lnTo><a:pt x="${px(x)}" y="${emu(y)}"/></a:lnTo>`)
      .join('') +
    (options.close ? '<a:close/>' : '');

  const fill = options.fill
    ? `<a:solidFill><a:srgbClr val="${options.fill}">${
        // L'opacité de DrawingML se compte en MILLIÈMES DE POURCENT : 14 %
        // s'écrit 14000. Écrit en millièmes, l'aplat sortait à 0,14 % —
        // c'est-à-dire invisible, et rien ne le signalait.
        options.alpha === undefined
          ? ''
          : `<a:alpha val="${Math.round(options.alpha * 100_000)}"/>`
      }</a:srgbClr></a:solidFill>`
    : '<a:noFill/>';
  const line = options.stroke
    ? `<a:ln w="${emu(options.width ?? 1)}" cap="rnd"><a:solidFill><a:srgbClr val="${options.stroke}"/></a:solidFill><a:round/></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';

  return shape(
    id,
    name,
    `${frame()}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${WIDTH}" h="${HEIGHT}"${
      options.close ? '' : ' fill="none"'
    }>${segments}</a:path></a:pathLst></a:custGeom>${fill}${line}`,
  );
}

/** Le point posé sur la courbe : blanc cerclé d'azur, comme à l'écran. */
function dot(id: number, x: number, y: number): string {
  const radius = emu(DOT_RADIUS);
  return shape(
    id,
    `point-${id}`,
    `<a:xfrm><a:off x="${px(x) - radius}" y="${emu(y) - radius}"/><a:ext cx="${radius * 2}" cy="${radius * 2}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${COLORS.surface}"/></a:solidFill><a:ln w="${emu(2)}"><a:solidFill><a:srgbClr val="${COLORS.accent}"/></a:solidFill></a:ln>`,
  );
}

interface LabelOptions {
  readonly size: number;
  readonly color: string;
  readonly bold?: boolean;
  /** Rotation en degrés, dans le sens inverse des aiguilles (comme le SVG). */
  readonly rotate?: number;
}

/**
 * Une étiquette, centrée sur un point — ou, si elle est penchée, dont la FIN
 * tombe sur ce point.
 *
 * Word fait tourner une forme autour de son CENTRE, alors que le SVG la fait
 * tourner autour de son ancre. Le décalage est donc calculé : sans lui, les
 * heures penchées partiraient toutes à côté de leur colonne.
 */
function label(id: number, value: string, at: readonly [number, number], options: LabelOptions): string {
  const width = value.length * CHAR_WIDTH + 4;
  const height = options.size * 1.6;
  const angle = ((options.rotate ?? 0) * Math.PI) / 180;

  // Point que l'on veut voir tomber sur `at` : le centre à plat, le milieu du
  // bord droit lorsque l'étiquette est penchée.
  const offset = options.rotate ? width / 2 : 0;
  const centre: [number, number] = [
    at[0] - offset * Math.cos(angle),
    at[1] + offset * Math.sin(angle),
  ];

  const rotation = options.rotate ? Math.round((360 - options.rotate) * 60000) : 0;

  return shape(
    id,
    `etiquette-${id}`,
    `<a:xfrm${rotation ? ` rot="${rotation}"` : ''}><a:off x="${px(centre[0]) - emu(width / 2)}" y="${
      emu(centre[1]) - emu(height / 2)
    }"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>`,
    `<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Montserrat" w:hAnsi="Montserrat" w:cs="Montserrat"/>${
      options.bold ? '<w:b/>' : ''
    }<w:color w:val="${options.color}"/><w:sz w:val="${Math.round(
      options.size * SCALE * 2,
    )}"/><w:szCs w:val="${Math.round(options.size * SCALE * 2)}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      value,
    )}</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1"><a:noAutofit/></wps:bodyPr>`,
  );
}

/**
 * La courbe entière, prête à être insérée dans un document.
 *
 * Un seul objet groupé : on le déplace, on le redimensionne, ou on le
 * supprime d'un geste, au lieu de cinquante formes à sélectionner une par une.
 */
export function sparkDrawing(chart: Sparkline, startId = 100): string {
  let id = startId;
  const next = (): number => (id += 1);

  const rules = SPARK_FRAME.rules
    .map((y) =>
      path(
        next(),
        `regle-${y}`,
        [
          [0, y],
          [SPARK_FRAME.plotWidth, y],
        ],
        { stroke: COLORS.border, width: 1 },
      ),
    )
    .join('');

  const points = chart.points.map((point) => [point.x, point.y] as const);
  const baseline = SPARK_FRAME.rules[SPARK_FRAME.rules.length - 1] ?? 0;
  const area =
    points.length > 1
      ? path(
          next(),
          'aplat',
          [
            ...points,
            // L'aplat se referme sur la ligne de base, comme le chemin SVG.
            [points[points.length - 1]![0], baseline],
            [points[0]![0], baseline],
          ],
          { close: true, fill: COLORS.accent, alpha: 0.14 },
        )
      : '';
  const line =
    points.length > 1
      ? path(next(), 'courbe', points, { stroke: COLORS.accent, width: 2.4 })
      : '';

  const marks = chart.points
    .map((point) => {
      const parts = [dot(next(), point.x, point.y)];
      if (point.value !== 0) {
        parts.push(
          label(next(), String(point.value), [point.x, Math.max(9, point.y - 8)], {
            size: VALUE_SIZE,
            color: COLORS.marine,
            bold: true,
          }),
        );
      }
      if (point.tick) {
        parts.push(
          label(next(), point.tick, [point.x, TICK_BASELINE], {
            size: TICK_SIZE,
            color: COLORS.muted,
            rotate: chart.tickAngle,
          }),
        );
      }
      return parts.join('');
    })
    .join('');

  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${WIDTH}" cy="${HEIGHT}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${startId}" name="Courbe des arrivées"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${WIDTH}" cy="${HEIGHT}"/><a:chOff x="0" y="0"/><a:chExt cx="${WIDTH}" cy="${HEIGHT}"/></a:xfrm></wpg:grpSpPr>${rules}${area}${line}${marks}</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
