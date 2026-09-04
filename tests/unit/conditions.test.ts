import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  isAnswered,
  visibleFields,
  visibleSteps,
} from '@/lib/survey/conditions';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import { normaliseDedupValue, sanitizeText } from '@/lib/security/sanitize';

const ZERO_WIDTH = String.fromCodePoint(0x200b);
const RLO = String.fromCodePoint(0x202e);
const NUL = String.fromCodePoint(0x00);
const NBSP = String.fromCodePoint(0xa0);

describe('réponse fournie ou non', () => {
  it('reconnaît une absence de réponse', () => {
    for (const value of [undefined, null, '', '   ', [], {}]) {
      expect(isAnswered(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('reconnaît une réponse, y compris zéro et faux', () => {
    // Zéro sur une échéance de 0 à 10 est une réponse, pas un vide.
    for (const value of [0, false, 'x', ['a'], { a: ['b'] }]) {
      expect(isAnswered(value), JSON.stringify(value)).toBe(true);
    }
  });

  it('ne considère pas NaN comme une réponse', () => {
    expect(isAnswered(Number.NaN)).toBe(false);
  });
});

describe('évaluation des conditions', () => {
  const answers = {
    venue: 'oui',
    jours: ['lundi', 'mardi'],
    note: 4,
    dispos: { lundi: ['matin'] },
  };

  it('compare une valeur unique', () => {
    expect(evaluateCondition({ field: 'venue', op: 'equals', value: 'oui' }, answers)).toBe(true);
    expect(evaluateCondition({ field: 'venue', op: 'equals', value: 'non' }, answers)).toBe(false);
    expect(evaluateCondition({ field: 'venue', op: 'not_equals', value: 'non' }, answers)).toBe(
      true,
    );
  });

  it('n’égale jamais une liste à plusieurs valeurs', () => {
    // « egale lundi » est faux si l'utilisateur a coché lundi ET mardi : c'est
    // `includes` qui répond à cette question.
    expect(evaluateCondition({ field: 'jours', op: 'equals', value: 'lundi' }, answers)).toBe(
      false,
    );
    expect(evaluateCondition({ field: 'jours', op: 'includes', value: 'lundi' }, answers)).toBe(
      true,
    );
    expect(evaluateCondition({ field: 'jours', op: 'not_includes', value: 'jeudi' }, answers)).toBe(
      true,
    );
  });

  it('compare un nombre par sa représentation textuelle', () => {
    expect(evaluateCondition({ field: 'note', op: 'equals', value: '4' }, answers)).toBe(true);
  });

  it('regarde l’union des colonnes cochées d’une grille', () => {
    expect(evaluateCondition({ field: 'dispos', op: 'includes', value: 'matin' }, answers)).toBe(
      true,
    );
    expect(evaluateCondition({ field: 'dispos', op: 'includes', value: 'soir' }, answers)).toBe(
      false,
    );
  });

  it('teste la présence d’une réponse', () => {
    expect(evaluateCondition({ field: 'venue', op: 'answered' }, answers)).toBe(true);
    expect(evaluateCondition({ field: 'absent', op: 'answered' }, answers)).toBe(false);
    expect(evaluateCondition({ field: 'absent', op: 'not_answered' }, answers)).toBe(true);
  });

  it('combine par ET et par OU', () => {
    expect(
      evaluateCondition(
        {
          all: [
            { field: 'venue', op: 'equals', value: 'oui' },
            { field: 'jours', op: 'includes', value: 'lundi' },
          ],
        },
        answers,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          any: [
            { field: 'venue', op: 'equals', value: 'non' },
            { field: 'note', op: 'answered' },
          ],
        },
        answers,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          all: [
            { field: 'venue', op: 'equals', value: 'oui' },
            { any: [{ field: 'jours', op: 'includes', value: 'jeudi' }] },
          ],
        },
        answers,
      ),
    ).toBe(false);
  });

  it('traite une condition sur un champ inconnu comme non satisfaite', () => {
    expect(evaluateCondition({ field: 'fantome', op: 'equals', value: 'x' }, {})).toBe(false);
  });
});

describe('champs et étapes applicables', () => {
  const schema: SurveySchema = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [
            {
              id: 'venue',
              type: 'radio',
              label: 'Venez-vous ?',
              options: [
                { value: 'oui', label: 'Oui' },
                { value: 'non', label: 'Non' },
              ],
            },
            {
              id: 'accompagnants',
              type: 'number',
              label: 'Combien ?',
              condition: { field: 'venue', op: 'equals', value: 'oui' },
            },
          ],
        },
        {
          id: 'etape_2',
          condition: { field: 'venue', op: 'equals', value: 'oui' },
          fields: [{ id: 'remarque', type: 'textarea', label: 'Remarque' }],
        },
      ],
    });
    if (!result.ok) throw new Error('schéma de test invalide');
    return result.schema;
  })();

  it('masque un champ dont la condition n’est pas remplie', () => {
    expect(visibleFields(schema, { venue: 'non' }).map(({ field }) => field.id)).toEqual(['venue']);
    expect(visibleFields(schema, { venue: 'oui' }).map(({ field }) => field.id)).toEqual([
      'venue',
      'accompagnants',
      'remarque',
    ]);
  });

  it('masque tous les champs d’une étape masquée', () => {
    // Même si la condition propre du champ est satisfaite, une étape masquée
    // emporte son contenu.
    expect(visibleSteps(schema, { venue: 'non' }).map((step) => step.id)).toEqual(['etape_1']);
    expect(visibleSteps(schema, { venue: 'oui' }).map((step) => step.id)).toEqual([
      'etape_1',
      'etape_2',
    ]);
  });

  it('ne montre que la première étape quand rien n’est encore répondu', () => {
    expect(visibleSteps(schema, {}).map((step) => step.id)).toEqual(['etape_1']);
  });
});

describe('assainissement des valeurs', () => {
  it('normalise les espaces et coupe les bords', () => {
    expect(sanitizeText('  Camille   Martin  ')).toBe('Camille Martin');
    expect(sanitizeText(`Camille${NBSP}${NBSP}Martin`)).toBe('Camille Martin');
  });

  it('retire les caractères de contrôle et invisibles', () => {
    expect(sanitizeText(`Cami${NUL}lle`)).toBe('Camille');
    expect(sanitizeText(`Camille${ZERO_WIDTH}Martin`)).toBe('CamilleMartin');
    expect(sanitizeText(`${RLO}exe.png`)).toBe('exe.png');
  });

  it('unifie les formes Unicode équivalentes', () => {
    // Sans normalisation, ces deux chaînes identiques à l'œil produiraient
    // deux réponses distinctes et échapperaient à l'anti-doublon.
    const compose = 'e' + String.fromCodePoint(0x0301);
    expect(sanitizeText(compose)).toBe('é');
    expect(sanitizeText(compose)).toBe(sanitizeText('é'));
  });

  it('replie les sauts de ligne selon le mode', () => {
    expect(sanitizeText('a\nb')).toBe('a b');
    expect(sanitizeText('a\nb', { multiline: true })).toBe('a\nb');
    expect(sanitizeText('a\r\n\r\n\r\n\r\nb', { multiline: true })).toBe('a\n\nb');
  });

  it('coupe par point de code, sans casser un emoji', () => {
    expect(sanitizeText('😀😀😀', { maxLength: 2 })).toBe('😀😀');
    expect(sanitizeText('😀😀😀', { maxLength: 2 })).not.toContain('�');
  });

  it('normalise une clé anti-doublon en ignorant casse et espaces', () => {
    expect(normaliseDedupValue('  Jean@Exemple.TEST ')).toBe('jean@exemple.test');
  });
});
