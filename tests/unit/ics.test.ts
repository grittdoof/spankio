import { describe, expect, it } from 'vitest';
import {
  IcsError,
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  formatIcsDateTime,
  icsFileName,
} from '@/lib/event/ics';

/** Horodatage figé : la sortie doit être déterministe pour être testable. */
const STAMP = new Date('2026-09-04T12:00:00.000Z');

const base = {
  uid: 'sondage-1@exemple.test',
  title: 'Réunion d’information',
  start: new Date('2027-06-15T18:30:00.000Z'),
  stamp: STAMP,
};

function lines(ics: string): string[] {
  return ics.split('\r\n');
}

/** Déplie les lignes pour vérifier le contenu logique. */
function unfold(ics: string): string[] {
  const result: string[] = [];
  for (const line of lines(ics)) {
    if (line.startsWith(' ') && result.length > 0) {
      result[result.length - 1] += line.slice(1);
    } else if (line !== '') {
      result.push(line);
    }
  }
  return result;
}

describe('échappement du texte (RFC 5545 §3.3.11)', () => {
  it('échappe la barre oblique inverse en premier', () => {
    // Si `\` était traité après `;`, on produirait `\;` au lieu de `\\;`.
    expect(escapeIcsText('a\\b;c')).toBe('a\\\\b\;c');
  });

  it('échappe point-virgule, virgule et sauts de ligne', () => {
    expect(escapeIcsText('Salle A; bâtiment B, 2e étage')).toBe(
      'Salle A\; bâtiment B\\, 2e étage',
    );
    expect(escapeIcsText('ligne 1\nligne 2')).toBe('ligne 1\\nligne 2');
    expect(escapeIcsText('ligne 1\r\nligne 2')).toBe('ligne 1\\nligne 2');
  });

  it('laisse les deux-points et les apostrophes intacts', () => {
    expect(escapeIcsText("Réunion : l'essentiel")).toBe("Réunion : l'essentiel");
  });
});

describe('pliage des lignes', () => {
  it('ne touche pas une ligne courte', () => {
    expect(foldIcsLine('SUMMARY:court')).toBe('SUMMARY:court');
  });

  it('plie à 75 octets et non à 75 caractères', () => {
    // 80 « é » = 160 octets : un pliage au caractère produirait des lignes
    // de 150 octets, refusées par les clients stricts.
    const folded = foldIcsLine(`SUMMARY:${'é'.repeat(80)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('préfixe chaque continuation d’une espace', () => {
    const folded = foldIcsLine(`DESCRIPTION:${'a'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((line) => line.startsWith(' '))).toBe(true);
  });

  it('ne coupe jamais un caractère multi-octets en deux', () => {
    const folded = foldIcsLine(`SUMMARY:${'😀'.repeat(40)}`);
    // Un découpage au milieu d'un emoji produirait un caractère de
    // remplacement au réassemblage.
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'😀'.repeat(40)}`);
    expect(folded).not.toContain('�');
  });

  it('se déplie exactement en la ligne d’origine', () => {
    const original = `DESCRIPTION:${'Texte à replier. '.repeat(20)}`;
    expect(foldIcsLine(original).replace(/\r\n /g, '')).toBe(original);
  });
});

describe('formats de date', () => {
  it('formate une date en UTC', () => {
    expect(formatIcsDate(new Date('2027-06-15T22:30:00.000Z'))).toBe('20270615');
    expect(formatIcsDateTime(new Date('2027-06-15T18:30:05.000Z'))).toBe('20270615T183005Z');
  });

  it('complète les composantes sur deux chiffres', () => {
    expect(formatIcsDateTime(new Date('2027-01-02T03:04:05.000Z'))).toBe('20270102T030405Z');
  });
});

describe('structure du fichier', () => {
  it('produit un calendrier valide et complet', () => {
    const ics = unfold(buildIcs(base));
    expect(ics[0]).toBe('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:sondage-1@exemple.test');
    expect(ics).toContain('DTSTAMP:20260904T120000Z');
    expect(ics).toContain('DTSTART:20270615T183000Z');
    expect(ics).toContain('SUMMARY:Réunion d’information');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('END:VEVENT');
    expect(ics.at(-1)).toBe('END:VCALENDAR');
  });

  it('termine chaque ligne par CRLF, y compris la dernière', () => {
    const ics = buildIcs(base);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // Aucun saut de ligne isolé.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('n’invente pas d’heure de fin quand elle n’est pas fournie', () => {
    // Supposer « une heure » ferait dire au fichier ce que l'organisateur
    // n'a pas écrit.
    expect(unfold(buildIcs(base)).some((line) => line.startsWith('DTEND'))).toBe(false);
  });

  it('inclut la fin quand elle est fournie', () => {
    const ics = unfold(buildIcs({ ...base, end: new Date('2027-06-15T20:00:00.000Z') }));
    expect(ics).toContain('DTEND:20270615T200000Z');
  });

  it('rend exclusive la fin d’un événement sur la journée entière', () => {
    const ics = unfold(buildIcs({ ...base, allDay: true }));
    expect(ics).toContain('DTSTART;VALUE=DATE:20270615');
    // Un événement d'une journée se termine le lendemain.
    expect(ics).toContain('DTEND;VALUE=DATE:20270616');
  });

  it('ajoute lieu, description, coordonnées et URL', () => {
    const ics = unfold(
      buildIcs({
        ...base,
        location: 'Salle des fêtes; 12 rue de l’Église',
        description: 'Ordre du jour :\n- point 1\n- point 2',
        latitude: 48.8566,
        longitude: 2.3522,
        url: 'https://exemple.test/s/org/evenement',
      }),
    );
    expect(ics).toContain('LOCATION:Salle des fêtes\; 12 rue de l’Église');
    expect(ics).toContain('DESCRIPTION:Ordre du jour :\\n- point 1\\n- point 2');
    expect(ics).toContain('GEO:48.8566;2.3522');
    // Une URI n'est pas une valeur TEXT : elle n'est pas échappée.
    expect(ics).toContain('URL:https://exemple.test/s/org/evenement');
  });

  it('omet ORGANIZER sans adresse plutôt que d’écrire une propriété invalide', () => {
    const sansAdresse = unfold(buildIcs({ ...base, organiser: { name: 'Service culturel' } }));
    expect(sansAdresse.some((line) => line.startsWith('ORGANIZER'))).toBe(false);

    const avecAdresse = unfold(
      buildIcs({ ...base, organiser: { name: 'Service culturel', email: 'contact@exemple.test' } }),
    );
    expect(avecAdresse).toContain('ORGANIZER;CN=Service culturel:mailto:contact@exemple.test');
  });

  it('omet les propriétés vides au lieu d’émettre une valeur nulle', () => {
    const ics = unfold(buildIcs({ ...base, description: '   ', location: null }));
    expect(ics.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
    expect(ics.some((line) => line.startsWith('LOCATION'))).toBe(false);
  });

  it('marque un événement annulé', () => {
    expect(unfold(buildIcs({ ...base, cancelled: true, sequence: 2 }))).toContain(
      'STATUS:CANCELLED',
    );
    expect(unfold(buildIcs({ ...base, sequence: 2 }))).toContain('SEQUENCE:2');
  });

  it('échappe un UID contenant un caractère spécial', () => {
    expect(unfold(buildIcs({ ...base, uid: 'a;b,c' }))).toContain('UID:a\;b\\,c');
  });
});

describe('refus des données incohérentes', () => {
  it('refuse un UID ou un intitulé vide', () => {
    expect(() => buildIcs({ ...base, uid: '  ' })).toThrow(IcsError);
    expect(() => buildIcs({ ...base, title: '' })).toThrow(IcsError);
  });

  it('refuse une date invalide', () => {
    expect(() => buildIcs({ ...base, start: new Date('pas une date') })).toThrow(IcsError);
    expect(() => buildIcs({ ...base, end: new Date('pas une date') })).toThrow(IcsError);
  });

  it('refuse une fin antérieure au début', () => {
    expect(() => buildIcs({ ...base, end: new Date('2027-06-15T17:00:00.000Z') })).toThrow(
      IcsError,
    );
  });
});

describe('nom de fichier', () => {
  it('réduit à l’ASCII et supprime la ponctuation', () => {
    expect(icsFileName('Réunion d’information — Été 2027')).toBe(
      'reunion-d-information-ete-2027.ics',
    );
  });

  it('retombe sur un nom générique quand rien n’est exploitable', () => {
    expect(icsFileName('!!!')).toBe('evenement.ics');
    expect(icsFileName('')).toBe('evenement.ics');
  });

  it('borne la longueur sans laisser de tiret final', () => {
    const name = icsFileName('a'.repeat(200));
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.endsWith('-.ics')).toBe(false);
  });
});
