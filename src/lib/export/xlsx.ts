/**
 * Écriture d'un classeur XLSX, sans aucune dépendance.
 *
 * Pourquoi écrire ce format à la main plutôt qu'ajouter une bibliothèque :
 * un classeur est une archive ZIP de quelques fichiers XML, et les parties
 * réellement nécessaires tiennent en deux cents lignes. En face, la moindre
 * bibliothèque de tableur tire des dizaines de paquets transitifs dans un
 * projet qui en compte sept à l'exécution — et R17 a déjà réduit la portée de
 * l'audit de dépendances. Ce module n'a pas de surface réseau, pas d'horloge,
 * pas d'aléa : c'est une fonction pure, donc un test peut figer l'octet près
 * ce qu'elle produit.
 *
 * Ce qu'il fait, et seulement cela :
 *
 *  * **Des chaînes en ligne** (`inlineStr`), jamais une table de chaînes
 *    partagées. Une cellule porte son texte, et le fichier se relit sans
 *    seconde indirection.
 *  * **Aucune formule, jamais.** Une cellule écrite en `inlineStr` n'est pas
 *    évaluée par le tableur : contrairement au CSV, un `=cmd|...` reçu d'un
 *    répondant y reste du texte. C'est la raison pour laquelle ce module ne
 *    reprend PAS la neutralisation par apostrophe du CSV — elle ajouterait un
 *    caractère visible dans une cellule qui ne risque rien.
 *  * **Une mise en forme minimale** : en-tête en gras, volet figé sur la
 *    première ligne, filtre automatique, largeurs de colonne calculées. Un
 *    tableur qu'il faut reformater à la main n'est pas un export — c'est
 *    exactement l'argument qui a fait choisir le point-virgule en CSV.
 *
 * Les entrées de l'archive sont STOCKÉES, sans compression : la seule
 * alternative sans dépendance serait d'écrire un compresseur, et un classeur
 * de quelques centaines de rangées pèse quelques dizaines de kilo-octets.
 */

import { zip } from './zip';

const encoder = new TextEncoder();

/**
 * Caractères qu'XML 1.0 ne sait pas représenter, même échappés.
 *
 * Exprimés en points de code numériques : un source contenant de vrais
 * caractères de contrôle est illisible et se corrompt au copier-coller. Les
 * valeurs reçues du public sont déjà nettoyées à la saisie ; ce filet n'est là
 * que pour qu'aucun chemin — une reprise de données, un libellé composé
 * ailleurs — ne puisse produire un fichier que le tableur refuse d'ouvrir.
 */
function stripIllegal(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const legal =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000;
    if (legal) result += character;
  }
  return result;
}

function escapeXml(value: string): string {
  return stripIllegal(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `A`, `B`, … `Z`, `AA`. Les colonnes d'un tableur ne sont pas des nombres. */
export function columnName(index: number): string {
  let name = '';
  let rest = index;
  while (rest >= 0) {
    name = String.fromCharCode(65 + (rest % 26)) + name;
    rest = Math.floor(rest / 26) - 1;
  }
  return name;
}

/**
 * Nom d'onglet accepté par le tableur : 31 caractères, et six signes refusés.
 *
 * Un nom invalide ne produit pas un onglet mal nommé — il produit un fichier
 * que le tableur déclare corrompu, ce qui est la pire façon d'échouer.
 */
export function sheetTitle(raw: string): string {
  const cleaned = stripIllegal(raw).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? 'Feuille 1' : [...cleaned].slice(0, 31).join('');
}

/** Largeur d'une colonne, en largeurs de caractère, bornée des deux côtés. */
function widthFor(rows: readonly (readonly string[])[], column: number): number {
  let longest = 0;
  for (const row of rows) {
    const cell = row[column];
    if (cell !== undefined && cell.length > longest) longest = cell.length;
  }
  // Un plancher pour que l'en-tête reste lisible, un plafond pour qu'une
  // réponse longue ne pousse pas les colonnes suivantes hors de l'écran.
  return Math.min(48, Math.max(10, longest + 2));
}

export interface XlsxOptions {
  /** Nom de l'onglet. Assaini, puisqu'il vient souvent d'un titre saisi. */
  readonly sheetName?: string;
  /**
   * Horodatage porté par les entrées de l'archive. Fourni par l'appelant —
   * ce module ne lit JAMAIS l'horloge, sans quoi deux exports identiques
   * produiraient deux fichiers différents et aucun test ne pourrait les figer.
   */
  readonly at?: Date;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * Deux styles, et c'est tout : le normal et le gras de l'en-tête.
 *
 * Les deux remplissages sont exigés par le format — le second, `gray125`, est
 * une convention qu'Excel attend à cette place ; un classeur qui n'en
 * déclarerait qu'un seul s'ouvre en signalant une erreur.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function workbookXml(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function sheetXml(rows: readonly (readonly string[])[]): string {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const lastColumn = columnName(Math.max(0, columns - 1));
  const dimension = `A1:${lastColumn}${Math.max(1, rows.length)}`;

  const cols =
    columns === 0
      ? ''
      : `<cols>${Array.from({ length: columns }, (_, index) => {
          const width = widthFor(rows, index);
          return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
        }).join('')}</cols>`;

  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          if (value === '') return '';
          const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
          // L'en-tête porte le style gras ; les cellules de corps gardent le
          // retour à la ligne automatique, qui vaut mieux qu'une adresse
          // tronquée par la colonne suivante.
          const style = rowIndex === 0 ? ' s="1"' : ' s="0"';
          return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  // Volet figé sous l'en-tête : une feuille de présence se parcourt sur
  // plusieurs écrans, et des colonnes sans titre ne se lisent pas.
  const panes =
    rows.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '';

  const filter =
    rows.length > 1 && columns > 0 ? `<autoFilter ref="${dimension}"/>` : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>${panes}${cols}<sheetData>${body}</sheetData>${filter}
</worksheet>`;
}

/**
 * Classeur d'une seule feuille, depuis un tableau de chaînes.
 *
 * La première rangée est l'en-tête : c'est la même convention que
 * `responseRows`, et elle permet à un même tableau de partir en CSV ou en
 * XLSX sans être recomposé deux fois.
 */
export function toXlsx(
  rows: readonly (readonly string[])[],
  options: XlsxOptions = {},
): Uint8Array<ArrayBuffer> {
  const name = sheetTitle(options.sheetName ?? 'Feuille 1');
  const at = options.at ?? new Date(Date.UTC(1980, 0, 1));

  return zip(
    [
      { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(name)) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: encoder.encode(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml(rows)) },
    ],
    at,
  );
}

/** Nom de fichier proposé : ASCII, daté, sans espace. */
export function xlsxFileName(slug: string, at: Date, suffix = ''): string {
  const date = at.toISOString().slice(0, 10);
  const base = slug.replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'export';
  return `${base}${suffix}-${date}.xlsx`;
}
