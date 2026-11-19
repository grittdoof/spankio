import { describe, expect, it } from 'vitest';
import { columnName, sheetTitle, toXlsx, xlsxFileName } from '@/lib/export/xlsx';
import { crc32 } from '@/lib/export/zip';

/**
 * Le classeur est écrit à la main : il faut donc le RELIRE, pas se contenter
 * de vérifier qu'une fonction a produit des octets.
 *
 * Ces tests ouvrent l'archive comme le ferait un tableur — signatures, table
 * centrale, sommes de contrôle — puis lisent le XML de la feuille. Un test qui
 * se bornerait à compter les octets passerait au vert sur une archive qu'Excel
 * déclare corrompue, ce qui est exactement la panne qu'on cherche à éviter.
 */

const decoder = new TextDecoder();

interface Entry {
  readonly name: string;
  readonly text: string;
  readonly crc: number;
  readonly stored: boolean;
}

/** Lecture d'une archive ZIP par sa TABLE CENTRALE, comme tout lecteur réel. */
function readZip(archive: Uint8Array): Map<string, Entry> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  let end = archive.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  expect(end).toBeGreaterThanOrEqual(0);

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries = new Map<string, Entry>();

  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));

    // L'en-tête local doit concorder : c'est lui que lit un dézippeur en
    // flux, et deux en-têtes divergents donnent une archive illisible.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    const start = offset + 30 + localNameLength + extraLength;
    const data = archive.subarray(start, start + size);

    expect(crc32(data)).toBe(crc);
    entries.set(name, { name, text: decoder.decode(data), crc, stored: method === 0 });
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }

  return entries;
}

const ROWS = [
  ['Nom', 'Présence'],
  ['Marie Dupont', 'Venu(e)'],
  ['Jean Martin', 'Non venu(e)'],
];

const AT = new Date('2026-11-19T10:30:00.000Z');

describe('classeur XLSX', () => {
  it('produit une archive dont chaque entrée se relit', () => {
    const entries = readZip(toXlsx(ROWS, { at: AT }));

    expect([...entries.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    for (const entry of entries.values()) {
      expect(entry.stored).toBe(true);
      expect(entry.text.startsWith('<?xml')).toBe(true);
    }
  });

  it('écrit les cellules à leur référence, en chaînes en ligne', () => {
    const sheet = readZip(toXlsx(ROWS, { at: AT })).get('xl/worksheets/sheet1.xml')!.text;

    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Nom</t></is></c>');
    expect(sheet).toContain('<c r="B2" s="0" t="inlineStr"><is><t xml:space="preserve">Venu(e)</t></is></c>');
    expect(sheet).toContain('<dimension ref="A1:B3"/>');
    // Volet figé et filtre : ce qu'on attend d'une liste qu'on va trier.
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:B3"/>');
  });

  it('échappe le XML plutôt que de produire un fichier illisible', () => {
    const sheet = readZip(
      toXlsx([['Société & Cie'], ['<script>']], { at: AT }),
    ).get('xl/worksheets/sheet1.xml')!.text;

    expect(sheet).toContain('Société &amp; Cie');
    expect(sheet).toContain('&lt;script&gt;');
    expect(sheet).not.toContain('<script>');
  });

  /*
   * Un tableur n'évalue PAS une chaîne en ligne : contrairement au CSV, un
   * `=cmd|...` reçu d'un répondant y reste du texte. On vérifie donc que la
   * neutralisation par apostrophe du CSV n'a pas été recopiée ici — elle
   * ajouterait un caractère visible dans une cellule qui ne risque rien.
   */
  it('n’ajoute aucune apostrophe de neutralisation', () => {
    const sheet = readZip(toXlsx([['=HYPERLINK("x")']], { at: AT })).get(
      'xl/worksheets/sheet1.xml',
    )!.text;

    expect(sheet).toContain('<t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>');
    expect(sheet).not.toContain("'=HYPERLINK");
  });

  it('retire les caractères qu’XML ne sait pas porter', () => {
    const sheet = readZip(
      toXlsx([[`Marie${String.fromCodePoint(0x01)}Dupont`]], { at: AT }),
    ).get('xl/worksheets/sheet1.xml')!.text;

    expect(sheet).toContain('MarieDupont');
  });

  it('ne lit jamais l’horloge : deux appels identiques donnent le même fichier', () => {
    const first = toXlsx(ROWS, { at: AT, sheetName: 'Présence' });
    const second = toXlsx(ROWS, { at: AT, sheetName: 'Présence' });
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('assainit le nom d’onglet, qu’un tableur refuserait', () => {
    expect(sheetTitle('Gala [2026] / soirée')).toBe('Gala 2026 soirée');
    expect(sheetTitle('   ')).toBe('Feuille 1');
    expect(sheetTitle('x'.repeat(40))).toHaveLength(31);
  });

  it('nomme les colonnes comme un tableur', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
  });

  it('calcule la somme de contrôle attendue', () => {
    // Valeur de référence du CRC-32 de « 123456789 », celle que publient les
    // spécifications : si notre table dérivait d'un bit, l'archive serait
    // refusée sans que rien d'autre ne le dise.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('propose un nom de fichier ASCII et daté', () => {
    expect(xlsxFileName('gala-2026', AT, '-presence')).toBe('gala-2026-presence-2026-11-19.xlsx');
  });
});
