import { describe, expect, it } from 'vitest';
import { computeStatistics, otherAnswers } from '@/lib/survey/statistics';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';

function build(fields: unknown[]): SurveySchema {
  const result = validateSurveySchema({ version: 1, steps: [{ id: 'etape_1', fields }] });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
}

const rows = (...data: Record<string, unknown>[]) => data.map((entry) => ({ data: entry }));

describe('agrégat des choix', () => {
  const schema = build([
    {
      id: 'venue',
      type: 'radio',
      label: 'Venez-vous ?',
      allowOther: true,
      options: [
        { value: 'oui', label: 'Oui' },
        { value: 'non', label: 'Non' },
      ],
    },
  ]);

  it('compte chaque option et sa part', () => {
    const stats = computeStatistics(
      schema,
      rows({ venue: 'oui' }, { venue: 'oui' }, { venue: 'non' }, { venue: 'oui' }),
    );
    const field = stats.fields[0]!;
    expect(field.type).toBe('choice');
    if (field.type !== 'choice') return;

    expect(field.answered).toBe(4);
    expect(field.options.find((option) => option.value === 'oui')).toMatchObject({
      count: 3,
      share: 75,
    });
    expect(field.options.find((option) => option.value === 'non')).toMatchObject({
      count: 1,
      share: 25,
    });
  });

  it('compte les non-réponses séparément', () => {
    const stats = computeStatistics(schema, rows({ venue: 'oui' }, {}, { venue: '' }));
    expect(stats.fields[0]).toMatchObject({ answered: 1, skipped: 2 });
  });

  it('compte les choix libres sans en exposer le contenu', () => {
    const stats = computeStatistics(
      schema,
      rows(
        { venue: 'other', venue__other: 'Sous réserve' },
        { venue: 'other', venue__other: 'Peut-être' },
      ),
    );
    const field = stats.fields[0]!;
    if (field.type !== 'choice') throw new Error('type inattendu');

    expect(field.otherCount).toBe(2);
    // Aucune saisie libre dans l'agrégat : le tableau de bord n'est pas un
    // écran de lecture de données personnelles.
    expect(JSON.stringify(field)).not.toContain('Sous réserve');
  });

  it('expose les saisies libres seulement à la demande explicite', () => {
    const responses = rows(
      { venue: 'other', venue__other: 'Sous réserve' },
      { venue: 'oui' },
      { venue: 'other', venue__other: '   ' },
    );
    expect(otherAnswers(schema.steps[0]!.fields[0]!, responses)).toEqual(['Sous réserve']);
  });

  it('compte chaque case d’un choix multiple', () => {
    const multi = build([
      {
        id: 'jours',
        type: 'checkbox',
        label: 'Jours',
        options: [
          { value: 'lundi', label: 'Lundi' },
          { value: 'mardi', label: 'Mardi' },
        ],
      },
    ]);
    const stats = computeStatistics(
      multi,
      rows({ jours: ['lundi', 'mardi'] }, { jours: ['lundi'] }),
    );
    const field = stats.fields[0]!;
    if (field.type !== 'choice') throw new Error('type inattendu');

    expect(field.multiple).toBe(true);
    expect(field.options.map((option) => option.count)).toEqual([2, 1]);
    // Les parts d'un choix multiple peuvent dépasser 100 % au total : c'est
    // arithmétiquement correct, chaque part se rapporte aux répondants.
    expect(field.options[0]!.share).toBe(100);
  });
});

describe('agrégat des échelles et des nombres', () => {
  const schema = build([
    { id: 'note', type: 'scale', label: 'Note', min: 1, max: 5 },
    { id: 'quantite', type: 'number', label: 'Quantité' },
  ]);

  it('calcule moyenne, médiane et répartition complète', () => {
    const stats = computeStatistics(
      schema,
      rows({ note: 5 }, { note: 3 }, { note: 5 }, { note: 1 }),
    );
    const field = stats.fields[0]!;
    if (field.type !== 'scale') throw new Error('type inattendu');

    expect(field.average).toBe(3.5);
    expect(field.median).toBe(4);
    // Toute l'échelle est représentée, y compris les valeurs sans réponse :
    // un histogramme à trous serait trompeur.
    expect(field.distribution).toEqual([
      { value: 1, count: 1 },
      { value: 2, count: 0 },
      { value: 3, count: 1 },
      { value: 4, count: 0 },
      { value: 5, count: 2 },
    ]);
  });

  it('renvoie null plutôt que zéro quand il n’y a aucune réponse', () => {
    // Une moyenne de 0 sur une échelle de 1 à 5 serait une valeur inventée.
    const stats = computeStatistics(schema, rows({}, {}));
    expect(stats.fields[0]).toMatchObject({ average: null, median: null });
    expect(stats.fields[1]).toMatchObject({ average: null, lowest: null, highest: null });
  });

  it('résume un champ numérique', () => {
    const stats = computeStatistics(
      schema,
      rows({ quantite: 2 }, { quantite: 8 }, { quantite: 5 }),
    );
    expect(stats.fields[1]).toMatchObject({
      average: 5,
      median: 5,
      lowest: 2,
      highest: 8,
      sum: 15,
    });
  });

  it('arrondit la moyenne à deux décimales', () => {
    const stats = computeStatistics(schema, rows({ note: 1 }, { note: 2 }, { note: 2 }));
    expect(stats.fields[0]).toMatchObject({ average: 1.67 });
  });
});

describe('agrégat des dates et des grilles', () => {
  it('donne les bornes et la répartition mensuelle', () => {
    const schema = build([{ id: 'jour', type: 'date', label: 'Jour' }]);
    const stats = computeStatistics(
      schema,
      rows({ jour: '2027-06-15' }, { jour: '2027-05-02' }, { jour: '2027-06-20' }),
    );
    const field = stats.fields[0]!;
    if (field.type !== 'date') throw new Error('type inattendu');

    expect(field.earliest).toBe('2027-05-02');
    expect(field.latest).toBe('2027-06-20');
    expect(field.byMonth).toEqual([
      { month: '2027-05', count: 1 },
      { month: '2027-06', count: 2 },
    ]);
  });

  it('croise lignes et colonnes d’une grille', () => {
    const schema = build([
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
          { value: 'soir', label: 'Soir' },
        ],
      },
    ]);
    const stats = computeStatistics(
      schema,
      rows(
        { dispos: { lundi: ['matin'], mardi: ['soir'] } },
        { dispos: { lundi: ['matin', 'soir'] } },
      ),
    );
    const field = stats.fields[0]!;
    if (field.type !== 'grid') throw new Error('type inattendu');

    expect(field.rows[0]!.columns.map((column) => column.count)).toEqual([2, 1]);
    expect(field.rows[1]!.columns.map((column) => column.count)).toEqual([0, 1]);
  });
});

describe('champs libres', () => {
  it('ne produit qu’un compteur, jamais de contenu', () => {
    const schema = build([
      { id: 'avis', type: 'textarea', label: 'Votre avis' },
      { id: 'email', type: 'email', label: 'Adresse' },
    ]);
    const stats = computeStatistics(
      schema,
      rows(
        { avis: 'Beaucoup de choses à dire', email: 'camille@exemple.test' },
        { avis: '' },
      ),
    );

    expect(stats.fields[0]).toEqual({
      type: 'text',
      fieldId: 'avis',
      label: 'Votre avis',
      answered: 1,
      skipped: 1,
    });
    // Ni verbatim, ni adresse : le tableau de bord ne doit pas devenir un
    // écran de lecture de données personnelles.
    const serialised = JSON.stringify(stats);
    expect(serialised).not.toContain('Beaucoup de choses');
    expect(serialised).not.toContain('camille@exemple.test');
  });
});

describe('vue d’ensemble', () => {
  it('suit l’ordre du schéma et compte les réponses', () => {
    const schema = build([
      { id: 'a', type: 'text', label: 'A' },
      { id: 'b', type: 'text', label: 'B' },
    ]);
    const stats = computeStatistics(schema, rows({ a: 'x' }, { b: 'y' }));
    expect(stats.responseCount).toBe(2);
    expect(stats.fields.map((field) => field.fieldId)).toEqual(['a', 'b']);
  });

  it('ne compte que ce qu’on lui donne', () => {
    // Les suppressions logiques sont exclues en amont : la fonction n'a aucun
    // moyen de recompter une ligne qu'elle n'a pas reçue.
    const schema = build([{ id: 'a', type: 'text', label: 'A' }]);
    expect(computeStatistics(schema, []).responseCount).toBe(0);
    expect(computeStatistics(schema, [])).toMatchObject({
      fields: [{ answered: 0, skipped: 0 }],
    });
  });
});
