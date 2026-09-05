import { describe, expect, it } from 'vitest';
import { isPublishable, missingForPublication } from '@/lib/survey/publication';
import { validateDraftSchema, type SurveySchema } from '@/lib/survey/schema';
import { templateByKey } from '@/lib/event/templates';

function schemaOf(key: string): SurveySchema {
  const template = templateByKey(key);
  if (!template) throw new Error(`Modèle « ${key} » introuvable.`);
  return template.schema;
}

const EMPTY: SurveySchema = (() => {
  const parsed = validateDraftSchema({ version: 1, steps: [] });
  if (!parsed.ok) throw new Error('Schéma vide invalide');
  return parsed.schema;
})();

const COMPLETE = {
  kind: 'survey' as const,
  schema: schemaOf('needs_survey'),
  purpose: 'Recenser un besoin',
  legalBasis: 'consent',
  retentionDays: 365,
  eventStartsAt: null,
};

describe('exigences de publication', () => {
  it('ne signale rien sur un formulaire complet', () => {
    expect(missingForPublication(COMPLETE)).toEqual([]);
    expect(isPublishable(COMPLETE)).toBe(true);
  });

  it('signale un formulaire sans question', () => {
    const missing = missingForPublication({ ...COMPLETE, schema: EMPTY });
    expect(missing.map((entry) => entry.key)).toEqual(['schema']);
  });

  it.each([
    ['purpose', { purpose: null }],
    ['legalBasis', { legalBasis: null }],
    ['retentionDays', { retentionDays: null }],
  ])('signale l’absence de %s', (key, patch) => {
    const missing = missingForPublication({ ...COMPLETE, ...patch });
    expect(missing.map((entry) => entry.key)).toContain(key);
  });

  it('traite une finalité vide comme absente', () => {
    // Un champ rempli d'espaces satisferait un contrôle de présence naïf, et
    // la mention affichée aux répondants serait vide.
    const missing = missingForPublication({ ...COMPLETE, purpose: '   ' });
    expect(missing.map((entry) => entry.key)).toContain('purpose');
  });

  it('exige une date pour un événement, jamais pour un sondage', () => {
    const event = { ...COMPLETE, kind: 'event' as const };
    expect(missingForPublication(event).map((entry) => entry.key)).toContain('eventStartsAt');
    expect(
      missingForPublication({ ...event, eventStartsAt: '2027-06-01T10:00:00Z' }),
    ).toEqual([]);
    expect(missingForPublication({ ...COMPLETE, eventStartsAt: null })).toEqual([]);
  });

  it('énumère TOUTES les exigences manquantes, pas seulement la première', () => {
    // Un écran qui n'annonce qu'un défaut à la fois se corrige en autant
    // d'aller-retours qu'il y a de défauts.
    const missing = missingForPublication({
      kind: 'event',
      schema: EMPTY,
      purpose: null,
      legalBasis: null,
      retentionDays: null,
      eventStartsAt: null,
    });
    expect(missing).toHaveLength(5);
  });

  it('dit toujours où corriger', () => {
    for (const entry of missingForPublication({
      kind: 'event',
      schema: EMPTY,
      purpose: null,
      legalBasis: null,
      retentionDays: null,
      eventStartsAt: null,
    })) {
      expect(entry.where.length).toBeGreaterThan(8);
      expect(entry.label.length).toBeGreaterThan(8);
    }
  });
});
