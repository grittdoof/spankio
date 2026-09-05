import { describe, expect, it } from 'vitest';
import {
  EDITOR_STEPS,
  EDITOR_TOTAL,
  checkEditorStep,
  editorStep,
  editorStepNumber,
  nextEditorStep,
  previousEditorStep,
  stepForRequirement,
  type EditorStepValues,
} from '@/lib/survey/editor-steps';
import { missingForPublication } from '@/lib/survey/publication';
import { validateDraftSchema } from '@/lib/survey/schema';

/**
 * Blocage du passage à l'étape suivante.
 *
 * L'enjeu : ne bloquer QUE sur ce qui empêchera d'enregistrer ou de publier.
 * Bloquer sur un champ facultatif transformerait un guide en obstacle, et la
 * première réaction serait de remplir n'importe quoi pour passer.
 */

const VALID: EditorStepValues = {
  title: 'Assemblée générale 2027',
  slug: 'assemblee-generale-2027',
  purpose: 'Compter les présents et prévoir les repas',
  legalBasis: 'consent',
  retentionDays: 365,
};

describe('définition des étapes', () => {
  it('compte quatre étapes, chacune avec une question et un chapeau', () => {
    expect(EDITOR_TOTAL).toBe(4);
    for (const step of EDITOR_STEPS) {
      expect(step.question.endsWith('?')).toBe(true);
      expect(step.lead.length).toBeGreaterThan(30);
    }
  });

  it('numérote et retrouve les étapes', () => {
    expect(editorStepNumber('identite')).toBe(1);
    expect(editorStepNumber('publication')).toBe(4);
    expect(editorStep('questions').label).toBe('Questions');
  });

  it('chaîne les étapes dans les deux sens, sans déborder', () => {
    expect(previousEditorStep('identite')).toBeNull();
    expect(nextEditorStep('identite')).toBe('questions');
    expect(nextEditorStep('publication')).toBeNull();
    expect(previousEditorStep('publication')).toBe('informations');
  });
});

describe('étape « Identité »', () => {
  it('laisse passer un titre valide', () => {
    expect(checkEditorStep('identite', VALID).ok).toBe(true);
  });

  it.each(['', ' ', 'a'])('bloque sur un titre inutilisable (« %s »)', (title) => {
    const result = checkEditorStep('identite', { ...VALID, title });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.block.firstField).toBe('titre');
      expect(result.block.errors['titre']).toBeDefined();
    }
  });

  it('bloque sur un titre démesuré', () => {
    const result = checkEditorStep('identite', { ...VALID, title: 'a'.repeat(201) });
    expect(result.ok).toBe(false);
  });

  it('accepte une adresse vide : elle est dérivée du titre', () => {
    expect(checkEditorStep('identite', { ...VALID, slug: '' }).ok).toBe(true);
  });

  it('bloque sur une adresse dont il ne reste rien d’utilisable', () => {
    const result = checkEditorStep('identite', { ...VALID, slug: '???' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.block.errors['slug']).toBeDefined();
  });

  it('ne regarde pas les mentions légales à cette étape', () => {
    // Sinon la première étape exigerait des informations demandées à la
    // troisième, et l'utilisateur ne pourrait plus avancer.
    expect(
      checkEditorStep('identite', {
        ...VALID,
        purpose: null,
        legalBasis: null,
        retentionDays: null,
      }).ok,
    ).toBe(true);
  });
});

describe('étape « Questions »', () => {
  it('ne bloque jamais : un formulaire se construit en plusieurs fois', () => {
    // L'absence de question empêche de PUBLIER, pas d'avancer dans l'éditeur.
    // C'est l'écran de publication qui le dit.
    expect(
      checkEditorStep('questions', {
        title: '',
        slug: '',
        purpose: null,
        legalBasis: null,
        retentionDays: null,
      }).ok,
    ).toBe(true);
  });
});

describe('étape « Informations »', () => {
  it('laisse passer des mentions complètes', () => {
    expect(checkEditorStep('informations', VALID).ok).toBe(true);
  });

  it.each([
    ['purpose', { purpose: null }],
    ['purpose', { purpose: 'bref' }],
    ['legalBasis', { legalBasis: null }],
    ['retentionDays', { retentionDays: null }],
    ['retentionDays', { retentionDays: 0 }],
    ['retentionDays', { retentionDays: 4000 }],
    ['retentionDays', { retentionDays: 12.5 }],
  ])('bloque et désigne %s', (field, patch) => {
    const result = checkEditorStep('informations', { ...VALID, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.block.errors[field]).toBeDefined();
  });

  it('désigne le PREMIER champ en défaut, pour y poser le focus', () => {
    const result = checkEditorStep('informations', {
      ...VALID,
      purpose: null,
      legalBasis: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.block.firstField).toBe('purpose');
      // Tous les défauts sont signalés, pas seulement le premier : les
      // corriger un par un demanderait autant d'aller-retours.
      expect(Object.keys(result.block.errors)).toHaveLength(2);
    }
  });
});

describe('renvoi d’une exigence vers son étape', () => {
  const empty = (() => {
    const parsed = validateDraftSchema({ version: 1, steps: [] });
    if (!parsed.ok) throw new Error('Schéma vide invalide');
    return parsed.schema;
  })();

  it('associe chaque exigence à l’endroit où la corriger', () => {
    const requirements = missingForPublication({
      kind: 'event',
      schema: empty,
      purpose: null,
      legalBasis: null,
      retentionDays: null,
      eventStartsAt: null,
    });

    const byKey = new Map(requirements.map((entry) => [entry.key, stepForRequirement(entry)]));
    expect(byKey.get('schema')).toBe('questions');
    expect(byKey.get('purpose')).toBe('informations');
    expect(byKey.get('legalBasis')).toBe('informations');
    expect(byKey.get('retentionDays')).toBe('informations');
    // La date d'un événement se règle hors de l'éditeur : pas d'étape interne.
    expect(byKey.get('eventStartsAt')).toBeNull();
  });

  it('couvre toutes les exigences produites, sans trou', () => {
    for (const requirement of missingForPublication({
      kind: 'event',
      schema: empty,
      purpose: null,
      legalBasis: null,
      retentionDays: null,
      eventStartsAt: null,
    })) {
      // `undefined` signalerait une exigence oubliée ; `null` est un choix.
      expect(stepForRequirement(requirement)).not.toBeUndefined();
    }
  });
});
