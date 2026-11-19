import { describe, expect, it } from 'vitest';
import { arrivalReport, type ArrivalRow } from '@/lib/checkin/report';
import { arrivalSummary, SUMMARY_HEADINGS } from '@/lib/checkin/summary';
import { CSS_TOKEN_HEX } from '@/lib/design/tokens';
import { docxFileName, toDocx } from '@/lib/export/docx';
import { crc32 } from '@/lib/export/zip';

/**
 * Le document Word est écrit à la main : il faut donc le RELIRE.
 *
 * Ces tests ouvrent l'archive comme le ferait un traitement de texte, puis
 * lisent le corps du document. Un test qui se bornerait à compter les octets
 * passerait au vert sur un fichier que Word déclare corrompu — la pire façon
 * d'échouer, puisqu'elle ne dit pas pourquoi.
 */

const decoder = new TextDecoder();
const TZ = 'Europe/Paris';
const AT = new Date('2026-11-19T10:30:00.000Z');

function readZip(archive: Uint8Array): Map<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = archive.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  expect(end).toBeGreaterThanOrEqual(0);

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries = new Map<string, string>();

  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));

    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const start =
      offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = archive.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);

    entries.set(name, decoder.decode(data));
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return entries;
}

function row(partial: Partial<ArrivalRow> & { id: string }): ArrivalRow {
  return {
    expected: 'attending',
    announced: 1,
    arrivedAt: null,
    entered: 0,
    walkIn: false,
    gifts: 0,
    giftsWithoutArrival: 0,
    ...partial,
  };
}

const REPORT = arrivalReport(
  [
    row({ id: 'a', announced: 2, entered: 2, arrivedAt: '2026-11-06T18:02:00.000Z' }),
    row({ id: 'b', entered: 1, arrivedAt: '2026-11-06T18:21:00.000Z' }),
    row({ id: 'c' }),
  ],
  TZ,
);

const SUMMARY = arrivalSummary(REPORT, ['Un fait recalculable.'], { counting: true });

const META = {
  title: 'Gala des 180 ans',
  organisation: 'ACME & Cie',
  when: 'vendredi 6 novembre 2026 à 19:00',
  editedAt: '19 novembre 2026 à 11:30',
};

describe('document Word', () => {
  it('produit une archive dont chaque entrée se relit', () => {
    const entries = readZip(toDocx(SUMMARY, META, { at: AT }));
    expect([...entries.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
  });

  it('porte les trois sections de l’écran, dans l’ordre', () => {
    const document = readZip(toDocx(SUMMARY, META, { at: AT })).get('word/document.xml')!;
    const what = document.indexOf(SUMMARY_HEADINGS.what);
    const when = document.indexOf(SUMMARY_HEADINGS.when);
    const facts = document.indexOf(SUMMARY_HEADINGS.facts);

    expect(what).toBeGreaterThan(0);
    expect(when).toBeGreaterThan(what);
    expect(facts).toBeGreaterThan(when);
    expect(document).toContain('Un fait recalculable.');
  });

  it('écrit les mêmes chiffres que la synthèse, sans en recalculer', () => {
    const document = readZip(toDocx(SUMMARY, META, { at: AT })).get('word/document.xml')!;
    for (const figure of SUMMARY.figures) {
      expect(document).toContain(figure.label);
    }
    expect(document).toContain(SUMMARY.headline.detail);
    for (const slice of SUMMARY.pace.slices) {
      expect(document).toContain(slice.label);
    }
  });

  it('garde l’accent porté par le modèle', () => {
    // Le gras de l'affluence est une emphase, pas une décoration : elle doit
    // traverser jusqu'au document, sinon la phrase y perd son chiffre.
    const document = readZip(toDocx(SUMMARY, META, { at: AT })).get('word/document.xml')!;
    expect(document).toContain('<w:b/>');
  });

  it('peint aux couleurs de la charte, jamais à des valeurs recopiées', () => {
    const document = readZip(toDocx(SUMMARY, META, { at: AT })).get('word/document.xml')!;
    expect(document).toContain(CSS_TOKEN_HEX['--sp-marine']!.slice(1));
    expect(document).toContain(CSS_TOKEN_HEX['--sp-accent']!.slice(1));
  });

  it('échappe le XML plutôt que de produire un fichier illisible', () => {
    const document = readZip(
      toDocx(SUMMARY, { ...META, title: 'Gala <ACME & Cie>' }, { at: AT }),
    ).get('word/document.xml')!;
    expect(document).toContain('Gala &lt;ACME &amp; Cie&gt;');
  });

  it('ne lit jamais l’horloge : deux appels identiques donnent le même fichier', () => {
    const first = toDocx(SUMMARY, META, { at: AT });
    const second = toDocx(SUMMARY, META, { at: AT });
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('ne nomme PERSONNE : une synthèse ne porte que des chiffres', () => {
    // C'est ce qui permet de la transmettre là où la liste ne peut pas aller.
    const document = readZip(toDocx(SUMMARY, META, { at: AT })).get('word/document.xml')!;
    expect(document).not.toContain('Alice');
    expect(document).not.toContain('@');
  });

  it('dessine la COURBE, pas un tableau de substitution', () => {
    // Le document doit montrer ce que montre l'écran : un tableau de valeurs
    // aurait été défendable — « un graphique est un renfort » — mais ce n'est
    // pas la même page.
    const document = readZip(toDocx(SUMMARY, META, { at: AT })).get('word/document.xml')!;
    expect(document).toContain('<wpg:wgp>');
    expect(document).toContain('<a:custGeom>');
    // Un point par tranche, et l'étiquette de la première heure.
    expect(document).toContain('prst="ellipse"');
    expect(document).toContain(SUMMARY.pace.slices[0]!.label);
  });

  it('propose un nom de fichier ASCII et daté', () => {
    expect(docxFileName('gala-2026', AT)).toBe('gala-2026-synthese-2026-11-19.docx');
  });
});
