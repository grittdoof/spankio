import { describe, expect, it } from 'vitest';
import type { AttendanceSettings } from '@/lib/survey/attendance';
import {
  acceptsNameCase,
  applyNameCase,
  composeName,
  nameCaseOf,
  DEFAULT_NAME_CASE,
} from '@/lib/survey/name-case';
import { validateSurveySchema, type SurveyField, type SurveySchema } from '@/lib/survey/schema';

/**
 * Casse des noms affichés par le poste d'accueil.
 *
 * Ces tests fixent trois refus plutôt qu'un rendu : ne rien DEVINER (c'est la
 * question qui porte la casse, pas son rang), ne pas appliquer une casse à ce
 * qui n'en supporte pas (une adresse électronique mise en capitales d'initiale
 * est une adresse fausse), et ne jamais toucher à la donnée enregistrée.
 */

const schema: SurveySchema = (() => {
  const result = validateSurveySchema({
    version: 1,
    steps: [
      {
        id: 'etape_1',
        fields: [
          { id: 'nom', type: 'text', label: 'Nom' },
          { id: 'prenom', type: 'text', label: 'Prénom' },
          { id: 'email', type: 'email', label: 'Adresse électronique' },
          { id: 'tel', type: 'tel', label: 'Téléphone' },
          {
            id: 'societe',
            type: 'select',
            label: 'Société',
            options: [{ value: 'option_1', label: 'spie batignolles' }],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
})();

function field(id: string): SurveyField {
  const found = schema.steps[0]?.fields.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`question ${id} absente du schéma de test`);
  return found;
}

const nom = field('nom');
const prenom = field('prenom');
const email = field('email');

describe('applyNameCase', () => {
  it('met un nom de famille en capitales', () => {
    expect(applyNameCase('dupont', 'upper')).toBe('DUPONT');
    expect(applyNameCase('Dupont', 'upper')).toBe('DUPONT');
  });

  it('met une initiale en majuscule et le reste en minuscules', () => {
    expect(applyNameCase('MARIE', 'capital')).toBe('Marie');
    expect(applyNameCase('marie', 'capital')).toBe('Marie');
    expect(applyNameCase('mArIe', 'capital')).toBe('Marie');
  });

  it('majuscule APRÈS un trait d’union et une apostrophe, pas seulement en tête', () => {
    expect(applyNameCase('JEAN-PIERRE', 'capital')).toBe('Jean-Pierre');
    expect(applyNameCase("o'brien", 'capital')).toBe("O'Brien");
    // L'apostrophe typographique du clavier d'un téléphone compte autant.
    expect(applyNameCase('d’artagnan', 'capital')).toBe('D’Artagnan');
  });

  it('majuscule chaque mot d’un nom composé', () => {
    expect(applyNameCase('marie claire dupont', 'capital')).toBe('Marie Claire Dupont');
  });

  it('respecte les accents, en bas comme en haut de casse', () => {
    expect(applyNameCase('élodie', 'capital')).toBe('Élodie');
    expect(applyNameCase('Élodie', 'upper')).toBe('ÉLODIE');
    expect(applyNameCase('ÉLODIE', 'capital')).toBe('Élodie');
  });

  it('résorbe les espaces en trop, pour que deux rangées identiques s’alignent', () => {
    expect(applyNameCase('  jean   dupont ', 'capital')).toBe('Jean Dupont');
    expect(applyNameCase('  jean   dupont ', 'upper')).toBe('JEAN DUPONT');
  });

  it('ne touche à RIEN en « tel que saisi »', () => {
    expect(applyNameCase('  SNCF  réseau ', 'raw')).toBe('  SNCF  réseau ');
  });

  it('ne lève pas sur une chaîne vide', () => {
    expect(applyNameCase('', 'capital')).toBe('');
    expect(applyNameCase('   ', 'upper')).toBe('');
  });
});

describe('acceptsNameCase', () => {
  it('n’accepte qu’une saisie libre : une adresse mise en casse serait fausse', () => {
    expect(acceptsNameCase(nom)).toBe(true);
    expect(acceptsNameCase(email)).toBe(false);
    expect(acceptsNameCase(field('tel'))).toBe(false);
    expect(acceptsNameCase(field('societe'))).toBe(false);
    expect(acceptsNameCase(undefined)).toBe(false);
  });
});

describe('nameCaseOf', () => {
  it('applique « initiale majuscule » sans désignation : la liste est uniforme sans réglage', () => {
    expect(nameCaseOf({}, nom)).toBe(DEFAULT_NAME_CASE);
    expect(DEFAULT_NAME_CASE).toBe('capital');
  });

  it('lit la désignation de CETTE question, pas celle d’une autre', () => {
    const settings: AttendanceSettings = { nameCase: { nom: 'upper' } };
    expect(nameCaseOf(settings, nom)).toBe('upper');
    expect(nameCaseOf(settings, prenom)).toBe('capital');
  });

  it('IGNORE une désignation posée sur une question qui ne peut pas la porter', () => {
    // Refaire ses questions suffit à laisser « majuscules » sur ce qui est
    // devenu une adresse électronique : muet plutôt que faux.
    expect(nameCaseOf({ nameCase: { email: 'upper' } }, email)).toBe('raw');
  });

  it('rend telle quelle une question absente du schéma', () => {
    expect(nameCaseOf({ nameCase: { nom: 'upper' } }, undefined)).toBe('raw');
  });
});

describe('composeName', () => {
  const settings: AttendanceSettings = { nameCase: { nom: 'upper' } };

  it('compose dans l’ORDRE donné, chaque question avec SA casse', () => {
    const data = { nom: 'dupont', prenom: 'MARIE' };
    expect(composeName([nom, prenom], data, settings)).toBe('DUPONT Marie');
    // L'ordre décide de ce qu'on lit en premier ; il ne change pas les casses.
    expect(composeName([prenom, nom], data, settings)).toBe('Marie DUPONT');
  });

  it('uniformise quatre saisies différentes en une seule forme', () => {
    const saisies = [
      { nom: 'dupont', prenom: 'marie' },
      { nom: 'DUPONT', prenom: 'MARIE' },
      { nom: 'Dupont', prenom: 'Marie' },
      { nom: ' duPONT ', prenom: ' mArie ' },
    ];
    const rendus = saisies.map((data) => composeName([nom, prenom], data, settings));
    expect(new Set(rendus)).toEqual(new Set(['DUPONT Marie']));
  });

  it('SAUTE une réponse vide au lieu de la rendre par un blanc', () => {
    expect(composeName([nom, prenom], { nom: 'dupont' }, settings)).toBe('DUPONT');
    expect(composeName([nom, prenom], { prenom: 'marie' }, settings)).toBe('Marie');
  });

  it('rend null quand aucune question désignée n’a de réponse', () => {
    expect(composeName([nom, prenom], {}, settings)).toBeNull();
    expect(composeName([], { nom: 'dupont' }, settings)).toBeNull();
  });

  it('laisse une adresse électronique intacte', () => {
    expect(composeName([email], { email: 'Jean.Dupont@exemple.fr' }, settings)).toBe(
      'Jean.Dupont@exemple.fr',
    );
  });

  it('ne RÉÉCRIT pas la réponse : c’est un affichage', () => {
    const data = { nom: 'dupont', prenom: 'MARIE' };
    composeName([nom, prenom], data, settings);
    expect(data).toEqual({ nom: 'dupont', prenom: 'MARIE' });
  });
});
