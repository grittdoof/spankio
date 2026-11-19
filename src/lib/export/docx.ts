import type { ArrivalSummary, RichSpan } from '@/lib/checkin/summary';
import { SUMMARY_HEADINGS } from '@/lib/checkin/summary';
import { sparkline, TICK_ANGLE } from '@/lib/design/sparkline';
import { CSS_TOKEN_HEX } from '@/lib/design/tokens';
import { sparkDrawing } from './drawing';
import { zip } from './zip';

/**
 * La synthèse des arrivées en document Word, sans aucune dépendance.
 *
 * Même raisonnement que le classeur : un `.docx` est une archive ZIP de
 * quelques fichiers XML, l'archive est déjà écrite (`zip.ts`), et une
 * bibliothèque de traitement de texte tirerait des dizaines de paquets
 * transitifs dans un projet qui en compte sept à l'exécution.
 *
 * **Ce qui change par rapport au PDF, et c'est assumé** : le document Word
 * n'emporte pas la courbe. Ce n'est pas une perte d'information — « un
 * graphique est un renfort, jamais un porteur d'information » est une règle du
 * projet, et chaque valeur de la courbe est déjà écrite à côté d'elle. Les
 * tranches deviennent donc un TABLEAU, avec une barre proportionnelle dessinée
 * en cellules ombrées : le même renfort visuel, obtenu avec ce que Word sait
 * faire nativement, donc toujours modifiable par celui qui reçoit le fichier.
 * Le PDF, lui, garde la page telle qu'elle s'affiche.
 *
 * Les couleurs viennent de `CSS_TOKEN_HEX`, la source de vérité de la charte :
 * un document qui les recopierait dériverait au premier ajustement, et le
 * fichier envoyé au client ne serait plus à ses couleurs.
 */

const encoder = new TextEncoder();

/** Largeur utile d'une page A4 moins ses marges, en vingtièmes de point. */
const CONTENT_WIDTH = 9638;

/** Tuiles de chiffres par rangée, comme la grille de l'écran sur une page. */
const FIGURE_COLUMNS = 3;

/** Marge intérieure d'une carte, de chaque côté. */
const CARD_PADDING = 170;

const COLORS = {
  marine: CSS_TOKEN_HEX['--sp-marine']!.slice(1),
  accent: CSS_TOKEN_HEX['--sp-accent']!.slice(1),
  text: CSS_TOKEN_HEX['--sp-text']!.slice(1),
  muted: CSS_TOKEN_HEX['--sp-text-muted']!.slice(1),
  border: CSS_TOKEN_HEX['--sp-border']!.slice(1),
  surface: CSS_TOKEN_HEX['--sp-surface']!.slice(1),
  surfaceMuted: CSS_TOKEN_HEX['--sp-surface-muted']!.slice(1),
  bg: CSS_TOKEN_HEX['--sp-bg']!.slice(1),
} as const;

/**
 * Caractères qu'XML 1.0 ne sait pas porter, retirés avant échappement.
 *
 * Les valeurs affichées ici sont composées par l'application, jamais reçues
 * du public ; ce filet existe pour qu'aucun chemin futur ne puisse produire un
 * document que Word refuse d'ouvrir — un fichier illisible est la pire façon
 * d'échouer, puisqu'elle ne dit pas pourquoi.
 */
function escapeXml(value: string): string {
  let safe = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 0x09 ||
      code === 0x0a ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
    ) {
      safe += character;
    }
  }
  return safe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface RunStyle {
  /** Taille en POINTS ; Word la veut en demi-points, la conversion est ici. */
  readonly size?: number;
  readonly color?: string;
  readonly bold?: boolean;
  readonly caps?: boolean;
}

function run(text: string, style: RunStyle = {}): string {
  const properties = [
    style.bold ? '<w:b/>' : '',
    style.caps ? '<w:caps/>' : '',
    style.color ? `<w:color w:val="${style.color}"/>` : '',
    style.size ? `<w:sz w:val="${style.size * 2}"/><w:szCs w:val="${style.size * 2}"/>` : '',
  ].join('');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

interface ParagraphStyle extends RunStyle {
  readonly align?: 'left' | 'right' | 'center';
  /** Blanc après le paragraphe, en vingtièmes de point. */
  readonly after?: number;
  readonly before?: number;
  /** Retrait pendant d'une puce : le texte d'une ligne suivante s'aligne. */
  readonly hanging?: number;
}

function paragraph(runs: string, style: ParagraphStyle = {}): string {
  const properties = [
    style.align ? `<w:jc w:val="${style.align}"/>` : '',
    style.after !== undefined || style.before !== undefined
      ? `<w:spacing${style.before !== undefined ? ` w:before="${style.before}"` : ''}${
          style.after !== undefined ? ` w:after="${style.after}"` : ''
        }/>`
      : '',
    style.hanging
      ? `<w:ind w:left="${style.hanging}" w:hanging="${style.hanging}"/>`
      : '',
  ].join('');
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${runs}</w:p>`;
}

function text(value: string, style: ParagraphStyle = {}): string {
  return paragraph(run(value, style), style);
}

/** Une suite de fragments dont certains portent l'accent. */
function rich(spans: readonly RichSpan[], style: RunStyle = {}): string {
  return paragraph(
    spans.map((span) => run(span.text, { ...style, bold: span.strong })).join(''),
  );
}

interface CellStyle {
  readonly width: number;
  readonly fill?: string;
  /** Nombre de colonnes fusionnées : un titre traverse toute la carte. */
  readonly span?: number;
  /** Aligne le contenu sur le HAUT de la cellule, et non en son milieu. */
  readonly top?: boolean;
}

function cell(content: string, style: CellStyle): string {
  // Une cellule DOIT se terminer par un paragraphe : sans lui, Word déclare le
  // document corrompu plutôt que d'afficher une cellule vide.
  const body = content === '' ? '<w:p/>' : content;
  return `<w:tc><w:tcPr><w:tcW w:w="${style.width}" w:type="dxa"/>${
    style.span && style.span > 1 ? `<w:gridSpan w:val="${style.span}"/>` : ''
  }${
    style.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${style.fill}"/>` : ''
  }<w:vAlign w:val="${style.top ? 'top' : 'center'}"/></w:tcPr>${body}</w:tc>`;
}

function row(cells: string): string {
  return `<w:tr>${cells}</w:tr>`;
}

interface TableStyle {
  readonly columns: readonly number[];
  readonly borders?: boolean;
  readonly fill?: string;
  /** Occupe toute la largeur utile, quelle que soit la page du destinataire. */
  readonly full?: boolean;
  /** Blanc entre les cellules : le seul moyen d'écarter deux tuiles. */
  readonly spacing?: number;
}

function table(rows: string, style: TableStyle): string {
  /*
   * Le cadre d'une carte est EXTÉRIEUR : les traits intérieurs sont retirés
   * explicitement, sinon le tableau en dessine entre chaque tuile et sous le
   * titre — ce que l'écran ne fait pas, et ce qui transforme une grille de
   * chiffres en grille de tableur.
   */
  const outer = ['top', 'left', 'bottom', 'right'];
  const inside = ['insideH', 'insideV'];
  const none = (side: string) => `<w:${side} w:val="none" w:sz="0" w:space="0"/>`;
  const drawn = (side: string) =>
    `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="${COLORS.border}"/>`;

  const borders = `<w:tblBorders>${
    (style.borders ? outer.map(drawn) : outer.map(none)).join('') +
    inside.map(none).join('')
  }</w:tblBorders>`;

  /*
   * Largeur FIXE, et déclarée en pourcentage pour les cartes.
   *
   * Sans `tblLayout`, un traitement de texte est libre de recalculer les
   * colonnes d'après leur contenu : la barre d'affluence, qui ne contient
   * rien d'autre qu'une couleur, s'écraserait alors à zéro. Et une carte
   * déclarée en vingtièmes de point se retrouve étroite sur une page au
   * format Lettre, qui est plus large que l'A4 de ses marges.
   */
  const width = style.full
    ? '<w:tblW w:w="5000" w:type="pct"/>'
    : `<w:tblW w:w="${style.columns.reduce((total, column) => total + column, 0)}" w:type="dxa"/>`;

  return `<w:tbl><w:tblPr>${width}<w:tblLayout w:type="fixed"/>${
    style.spacing ? `<w:tblCellSpacing w:w="${style.spacing}" w:type="dxa"/>` : ''
  }${borders}${
    style.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${style.fill}"/>` : ''
  }<w:tblCellMar><w:top w:w="110" w:type="dxa"/><w:left w:w="170" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/><w:right w:w="170" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${style.columns
    .map((width) => `<w:gridCol w:w="${width}"/>`)
    .join('')}</w:tblGrid>${rows}</w:tbl>`;
}

/**
 * Une carte : le bloc encadré de l'écran, rendu avec ce que Word sait faire.
 *
 * **Un seul tableau par carte, jamais de tableau imbriqué.** Première version
 * écrite ainsi — une carte, et la grille des chiffres dedans — et le rendu
 * l'a refusée : le lecteur mettait les tuiles les unes sous les autres, sans
 * leur fond. Les colonnes de la grille appartiennent donc au tableau de la
 * carte, et le titre traverse ses colonnes par une fusion. C'est la mise en
 * page la plus simple qui existe en traitement de texte, donc celle qui a le
 * plus de chances d'être rendue partout de la même façon.
 *
 * Les coins arrondis de `sp-card` n'existent pas en tableau : le cadre, le
 * fond et les marges intérieures, si. On s'arrête là plutôt que de simuler un
 * arrondi avec une image, qui ne serait plus modifiable — et qu'il faudrait
 * rastériser.
 */
function card(title: string, rows: string, columns: readonly number[]): string {
  const heading = row(
    cell(text(title, { size: 13, bold: true, color: COLORS.marine, after: 120 }), {
      width: columns.reduce((total, column) => total + column, 0),
      span: columns.length,
      top: true,
    }),
  );

  return (
    table(heading + rows, { columns, borders: true, full: true }) +
    // Deux tableaux qui se suivent fusionnent : ce paragraphe les sépare, et
    // fait le blanc entre deux cartes.
    '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'
  );
}

export interface DocxMeta {
  readonly title: string;
  readonly organisation: string | null;
  /** Date de l'événement, déjà mise en forme dans SON fuseau. */
  readonly when: string | null;
  /** Date d'édition, déjà mise en forme : ce module ne lit pas l'horloge. */
  readonly editedAt: string;
}

function body(summary: ArrivalSummary, meta: DocxMeta): string {
  const inner = CONTENT_WIDTH - CARD_PADDING * 2;
  const tile = Math.floor(inner / FIGURE_COLUMNS);
  const columns = Array.from({ length: FIGURE_COLUMNS }, () => tile);
  const full = tile * FIGURE_COLUMNS;

  /*
   * Les chiffres, en GRILLE comme à l'écran : une tuile par chiffre, son
   * intitulé au-dessus et sa valeur dessous. Trois par rangée, ce que donne
   * aussi `repeat(auto-fit, minmax(11rem, 1fr))` sur la largeur d'une page.
   */
  const tiles: string[] = [];
  for (let index = 0; index < summary.figures.length; index += FIGURE_COLUMNS) {
    const group = summary.figures.slice(index, index + FIGURE_COLUMNS);
    tiles.push(
      row(
        group
          .map((figure) =>
            cell(
              text(figure.label, { size: 9, color: COLORS.muted, after: 20 }) +
                text(String(figure.value), {
                  size: 14,
                  bold: true,
                  color: COLORS.marine,
                  after: 0,
                }),
              { width: tile, fill: COLORS.surfaceMuted, top: true },
            ),
          )
          .join('') +
          // Les tuiles manquantes de la dernière rangée restent VIDES et sans
          // fond : une tuile peinte sans chiffre ferait croire à un zéro.
          Array.from({ length: FIGURE_COLUMNS - group.length }, () =>
            cell('', { width: tile }),
          ).join(''),
      ),
    );
  }

  const headline = row(
    cell(
      paragraph(
        run(String(summary.headline.value), { size: 24, bold: true, color: COLORS.accent }) +
          run(`  ${summary.headline.detail}`, { size: 11, color: COLORS.text }),
        { after: 160 },
      ),
      { width: full, span: FIGURE_COLUMNS, top: true },
    ),
  );

  // La COURBE, pas un tableau de substitution : le document doit montrer ce
  // que montre l'écran. Elle est dessinée depuis la même géométrie pure, donc
  // les deux ne peuvent pas diverger.
  const chart = sparkDrawing(sparkline(summary.pace.slices, { tickAngle: TICK_ANGLE }));

  const facts = summary.facts
    .map((fact) => text(`•  ${fact}`, { size: 10, color: COLORS.text, hanging: 227 }))
    .join('');

  return [
    meta.organisation
      ? text(meta.organisation, { size: 10, bold: true, color: COLORS.muted, after: 40 })
      : '',
    text(`Synthèse des arrivées — ${meta.title}`, {
      size: 20,
      bold: true,
      color: COLORS.marine,
      after: 60,
    }),
    meta.when ? text(meta.when, { size: 10, color: COLORS.muted, after: 240 }) : '',

    card(SUMMARY_HEADINGS.what, headline + tiles.join(''), columns),

    card(
      SUMMARY_HEADINGS.when,
      row(
        cell(rich(summary.pace.lead, { size: 10 }) + chart, {
          width: full,
          span: FIGURE_COLUMNS,
          top: true,
        }),
      ),
      columns,
    ),

    summary.facts.length > 0
      ? card(
          SUMMARY_HEADINGS.facts,
          row(cell(facts, { width: full, span: FIGURE_COLUMNS, top: true })),
          columns,
        )
      : '',

    text(
      `${meta.organisation ? `${meta.organisation} — ` : ''}${meta.title} · Synthèse éditée le ${meta.editedAt}`,
      { size: 8, color: COLORS.muted, before: 240 },
    ),
  ].join('');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * Montserrat est la police de la charte ; Word la remplace proprement quand
 * elle n'est pas installée, ce qu'une image de texte n'aurait pas permis.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Montserrat" w:hAnsi="Montserrat" w:cs="Montserrat"/><w:color w:val="${COLORS.text}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;

/** Document d'une seule section, au format A4 avec des marges de 2 cm. */
export function toDocx(
  summary: ArrivalSummary,
  meta: DocxMeta,
  options: { readonly at?: Date } = {},
): Uint8Array<ArrayBuffer> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="wps wpg">
<w:body>${body(summary, meta)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

  return zip(
    [
      { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
      { name: 'word/document.xml', data: encoder.encode(document) },
      { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOCUMENT_RELS) },
      { name: 'word/styles.xml', data: encoder.encode(STYLES) },
    ],
    options.at ?? new Date(Date.UTC(1980, 0, 1)),
  );
}

/** Nom de fichier proposé : ASCII, daté, sans espace. */
export function docxFileName(slug: string, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  const base = slug.replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'synthese';
  return `${base}-synthese-${date}.docx`;
}
