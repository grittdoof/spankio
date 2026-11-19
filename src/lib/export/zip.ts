/**
 * Écriture d'une archive ZIP, sans aucune dépendance.
 *
 * Elle sert aux deux formats bureautiques que la plateforme produit — le
 * classeur XLSX et le document Word — qui sont l'un et l'autre un ZIP de
 * quelques fichiers XML. Écrire l'archive une seule fois évite d'avoir deux
 * implémentations dont une seule serait corrigée le jour où l'une se révèle
 * fautive.
 *
 * Les entrées sont STOCKÉES, sans compression : la seule alternative sans
 * dépendance serait d'écrire un compresseur, pour quelques dizaines de
 * kilo-octets. Fonction pure — elle ne lit pas l'horloge, l'horodatage des
 * entrées est fourni par l'appelant, sans quoi deux exports identiques
 * donneraient deux fichiers différents et aucun test ne pourrait les figer.
 */

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Date et heure au format MS-DOS, que le format ZIP n'a jamais quitté.
 *
 * La seconde est codée sur cinq bits : elle avance donc par pas de deux, et
 * rien n'existe avant 1980. Une date antérieure est ramenée à cette borne
 * plutôt que de produire un champ négatif qu'aucun outil ne saurait lire.
 */
function dosStamp(at: Date): { readonly date: number; readonly time: number } {
  const year = at.getUTCFullYear();
  if (year < 1980) return { date: (1 << 5) | 1, time: 0 };
  return {
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time:
      (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
  };
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

// `Uint8Array<ArrayBuffer>` et non `Uint8Array` : le corps d'une réponse
// HTTP n'accepte pas une vue qui pourrait reposer sur un `SharedArrayBuffer`,
// et l'archive est toujours allouée pour elle-même.
export function zip(entries: readonly ZipEntry[], at: Date): Uint8Array<ArrayBuffer> {
  const stamp = dosStamp(at);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    // Bit 11 : les noms d'entrée sont en UTF-8. Aucun ne sort de l'ASCII ici,
    // mais l'annoncer coûte un bit et évite toute lecture en page de code.
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}

