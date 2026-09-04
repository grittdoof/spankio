import { describe, expect, it } from 'vitest';
import {
  UTF8_BOM,
  csvFileName,
  escapeCsvCell,
  exportColumns,
  responsesToCsv,
  toCsv,
} from '@/lib/export/csv';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';

const TAB = String.fromCodePoint(0x09);
const CR = String.fromCodePoint(0x0d);

function build(fields: unknown[]): SurveySchema {
  const result = validateSurveySchema({ version: 1, steps: [{ id: 'etape_1', fields }] });
  if (!result.ok) throw new Error(`Schéma de test invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
}

describe('échappement des cellules', () => {
  it('laisse une valeur simple telle quelle', () => {
    expect(escapeCsvCell('Camille', ';')).toBe('Camille');
  });

  it('entoure de guillemets ce qui contient le séparateur ou un saut de ligne', () => {
    expect(escapeCsvCell('a;b', ';')).toBe('"a;b"');
    expect(escapeCsvCell('ligne 1\nligne 2', ';')).toBe('"ligne 1\nligne 2"');
    expect(escapeCsvCell('a,b', ';')).toBe('a,b');
    expect(escapeCsvCell('a,b', ',')).toBe('"a,b"');
  });

  it('double les guillemets internes', () => {
    expect(escapeCsvCell('dit "oui"', ';')).toBe('"dit ""oui"""');
  });

  it('protège les espaces de bord, qu’un tableur mangerait sinon', () => {
    expect(escapeCsvCell(' marge ', ';')).toBe('" marge "');
  });
});

describe('neutralisation des formules', () => {
  it('préfixe les amorces de formule d’une apostrophe', () => {
    // `=HYPERLINK(...)` ou `=cmd|...` dans un export ouvert par un tableur est
    // une exécution de code, pas un problème d'affichage.
    expect(escapeCsvCell('=1+1', ';')).toBe("'=1+1");
    expect(escapeCsvCell('+33612345678', ';')).toBe("'+33612345678");
    expect(escapeCsvCell('-5', ';')).toBe("'-5");
    expect(escapeCsvCell('@SUM(A1)', ';')).toBe("'@SUM(A1)");
    expect(escapeCsvCell(`${TAB}=1+1`, ';')).toBe(`"'${TAB}=1+1"`);
    expect(escapeCsvCell(`${CR}=1+1`, ';')).toBe(`"'${CR}=1+1"`);
  });

  it('place l’apostrophe À L’INTÉRIEUR des guillemets', () => {
    // L'ordre inverse casserait l'échappement CSV.
    expect(escapeCsvCell('=HYPERLINK("http://x");1', ';')).toBe(
      '"\'=HYPERLINK(""http://x"");1"',
    );
  });

  it('ne touche pas une valeur qui contient un signe sans commencer par lui', () => {
    expect(escapeCsvCell('1+1', ';')).toBe('1+1');
    expect(escapeCsvCell('camille@exemple.test', ';')).toBe('camille@exemple.test');
  });
});

describe('assemblage du fichier', () => {
  it('ajoute la marque d’ordre des octets par défaut', () => {
    const csv = toCsv([['a', 'b']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    // Sans BOM, Excel lit l'UTF-8 comme du Latin-1.
    expect(toCsv([['a']], { bom: false }).startsWith(UTF8_BOM)).toBe(false);
  });

  it('sépare les lignes par CRLF et termine le fichier', () => {
    expect(toCsv([['a'], ['b']], { bom: false })).toBe('a\r\nb\r\n');
  });

  it('respecte le séparateur demandé', () => {
    expect(toCsv([['a', 'b']], { bom: false })).toBe('a;b\r\n');
    expect(toCsv([['a', 'b']], { bom: false, separator: ',' })).toBe('a,b\r\n');
  });

  it('produit un fichier vide sans ligne fantôme', () => {
    expect(toCsv([], { bom: false })).toBe('');
  });
});

describe('colonnes déduites du schéma', () => {
  const schema = build([
    { id: 'nom', type: 'text', label: 'Votre nom' },
    {
      id: 'venue',
      type: 'radio',
      label: 'Venez-vous ?',
      options: [
        { value: 'oui', label: 'Oui' },
        { value: 'non', label: 'Non' },
      ],
      allowOther: true,
    },
    {
      id: 'dispos',
      type: 'checkbox_grid',
      label: 'Disponibilités',
      rows: [
        { value: 'lundi', label: 'Lundi' },
        { value: 'mardi', label: 'Mardi' },
      ],
      columns: [
        { value: 'matin', label: 'Matin' },
        { value: 'apres_midi', label: 'Après-midi' },
      ],
    },
  ]);

  it('commence par les métadonnées, puis suit l’ordre du schéma', () => {
    expect(exportColumns(schema).map((column) => column.header)).toEqual([
      'Date de réponse',
      'Consentement',
      'Texte du consentement affiché',
      'Votre nom',
      'Venez-vous ?',
      'Venez-vous ? (autre)',
      'Disponibilités — Lundi',
      'Disponibilités — Mardi',
    ]);
  });

  it('crée une colonne par ligne de grille', () => {
    const grid = exportColumns(schema).filter((column) => column.gridRow !== undefined);
    expect(grid.map((column) => column.gridRow)).toEqual(['lundi', 'mardi']);
  });

  it('produit les mêmes colonnes qu’il y ait des réponses ou non', () => {
    // Des colonnes qui dépendent des données casseraient tout traitement en
    // aval d'un export à l'autre.
    const vide = responsesToCsv(schema, []);
    const rempli = responsesToCsv(schema, [
      {
        submitted_at: '2027-06-15T18:30:00.000Z',
        consent_given: true,
        consent_text: 'Texte affiché',
        data: { nom: 'Camille' },
      },
    ]);
    expect(vide.split('\r\n')[0]).toBe(rempli.split('\r\n')[0]);
  });
});

describe('rendu des réponses', () => {
  const schema = build([
    { id: 'nom', type: 'text', label: 'Nom' },
    { id: 'note', type: 'scale', label: 'Note', min: 1, max: 5 },
    {
      id: 'jours',
      type: 'checkbox',
      label: 'Jours',
      options: [
        { value: 'lundi', label: 'Lundi' },
        { value: 'mardi', label: 'Mardi' },
      ],
    },
    {
      id: 'venue',
      type: 'radio',
      label: 'Venue',
      options: [{ value: 'oui', label: 'Oui' }],
      allowOther: true,
    },
    {
      id: 'dispos',
      type: 'checkbox_grid',
      label: 'Dispos',
      rows: [{ value: 'lundi', label: 'Lundi' }],
      columns: [
        { value: 'matin', label: 'Matin' },
        { value: 'apres_midi', label: 'Après-midi' },
      ],
    },
  ]);

  const response = {
    submitted_at: '2027-06-15T18:30:00.000Z',
    consent_given: true,
    consent_text: 'Texte du consentement',
    data: {
      nom: 'Camille',
      note: 4,
      jours: ['lundi', 'mardi'],
      venue: 'other',
      venue__other: 'Sous réserve',
      dispos: { lundi: ['matin', 'apres_midi'] },
    },
  };

  function dataRow(): string[] {
    const csv = responsesToCsv(schema, [response], { bom: false });
    return csv.split('\r\n')[1]!.split(';');
  }

  it('exporte les LIBELLÉS des options, pas leurs valeurs techniques', () => {
    const row = dataRow();
    expect(row).toContain('Lundi | Mardi');
    expect(row).toContain('Autre');
  });

  it('exporte les métadonnées et la preuve de consentement', () => {
    const row = dataRow();
    expect(row[0]).toBe('2027-06-15T18:30:00.000Z');
    expect(row[1]).toBe('Oui');
    expect(row[2]).toBe('Texte du consentement');
  });

  it('exporte la saisie libre dans sa propre colonne', () => {
    expect(dataRow()).toContain('Sous réserve');
  });

  it('éclate la grille sur la colonne de sa ligne', () => {
    expect(dataRow()).toContain('Matin | Après-midi');
  });

  it('laisse vide une réponse absente', () => {
    const csv = responsesToCsv(
      schema,
      [{ submitted_at: '2027-01-01T00:00:00.000Z', consent_given: false, consent_text: null, data: {} }],
      { bom: false },
    );
    const row = csv.split('\r\n')[1]!.split(';');
    expect(row[1]).toBe('Non');
    expect(row.slice(2).every((cell) => cell === '')).toBe(true);
  });

  it('neutralise une formule contenue dans une réponse', () => {
    const csv = responsesToCsv(
      schema,
      [
        {
          submitted_at: '2027-01-01T00:00:00.000Z',
          consent_given: false,
          consent_text: null,
          data: { nom: '=1+1' },
        },
      ],
      { bom: false },
    );
    expect(csv).toContain("'=1+1");
  });
});

describe('nom de fichier', () => {
  it('associe l’identifiant du sondage et la date', () => {
    expect(csvFileName('reunion-publique', new Date('2027-06-15T10:00:00.000Z'))).toBe(
      'reunion-publique-2027-06-15.csv',
    );
  });

  it('retombe sur un nom générique si l’identifiant est inexploitable', () => {
    expect(csvFileName('!!!', new Date('2027-06-15T10:00:00.000Z'))).toBe(
      'reponses-2027-06-15.csv',
    );
  });
});
