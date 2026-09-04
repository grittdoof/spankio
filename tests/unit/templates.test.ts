import { describe, expect, it } from 'vitest';
import {
  SURVEY_TEMPLATES,
  templateByKey,
  templatesFor,
} from '@/lib/event/templates';
import { allFields, validateSurveySchema } from '@/lib/survey/schema';
import { validateSurveySettings } from '@/lib/survey/settings';
import { validateResponse } from '@/lib/survey/validate-response';

describe('modèles de sondages et d’événements', () => {
  it('propose les quatre modèles annoncés', () => {
    expect(SURVEY_TEMPLATES.map((template) => template.key)).toEqual([
      'event_registration',
      'event_slots',
      'needs_survey',
      'satisfaction_survey',
    ]);
  });

  it.each(SURVEY_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s : le schéma passe la validation appliquée à toute entrée externe',
    (_key, template) => {
      // Un modèle est validé par le MÊME code qu'un schéma reçu par l'API :
      // c'est la raison d'être du TypeScript plutôt que d'un seed SQL.
      expect(validateSurveySchema(template.schema).ok).toBe(true);
    },
  );

  it.each(SURVEY_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s : les réglages passent la validation',
    (_key, template) => {
      expect(validateSurveySettings(template.settings).ok).toBe(true);
    },
  );

  it.each(SURVEY_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s : le champ anti-doublon proposé existe vraiment dans le schéma',
    (_key, template) => {
      if (template.suggestedDedupField === null) return;
      const ids = allFields(template.schema).map((field) => field.id);
      expect(ids).toContain(template.suggestedDedupField);
    },
  );

  it.each(SURVEY_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s : le module déclaré est cohérent avec le type',
    (_key, template) => {
      expect(template.moduleKey).toBe(template.kind === 'event' ? 'event' : 'core');
    },
  );

  it('n’emploie aucun vocabulaire sectoriel dans les libellés affichés', () => {
    const interdits = /mairie|municipal|commune|citoyen|administré|élu|collectivité/i;
    for (const template of SURVEY_TEMPLATES) {
      const affiche = [
        template.name,
        template.description,
        JSON.stringify(template.settings),
        JSON.stringify(template.schema),
      ].join(' ');
      expect(affiche, template.key).not.toMatch(interdits);
    }
  });

  it('retrouve un modèle par sa clé', () => {
    expect(templateByKey('needs_survey')?.name).toBe('Recensement de besoins');
    expect(templateByKey('inexistant')).toBeUndefined();
  });

  it('ne propose que les modèles des modules autorisés', () => {
    expect(templatesFor(['core']).map((template) => template.key)).toEqual([
      'needs_survey',
      'satisfaction_survey',
    ]);
    expect(templatesFor(['core', 'event'])).toHaveLength(4);
    expect(templatesFor([])).toEqual([]);
  });
});

describe('un modèle est immédiatement utilisable', () => {
  it('accepte une réponse plausible au modèle d’inscription', () => {
    const template = templateByKey('event_registration')!;
    const result = validateResponse(template.schema, {
      presence: 'oui',
      accompagnants: 2,
      nom: 'Camille Martin',
      email: 'camille@exemple.test',
      remarque: 'Accès en fauteuil roulant.',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data['accompagnants']).toBe(2);
    }
  });

  it('masque le nombre d’accompagnants quand la personne ne vient pas', () => {
    const template = templateByKey('event_registration')!;
    const result = validateResponse(template.schema, {
      presence: 'non',
      accompagnants: 4,
      nom: 'Camille Martin',
      email: 'camille@exemple.test',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data['accompagnants']).toBeUndefined();
      expect(result.value.dropped).toContain('accompagnants');
    }
  });

  it('exige les champs requis du modèle de créneaux', () => {
    const template = templateByKey('event_slots')!;
    const result = validateResponse(template.schema, { nom: 'Camille', email: 'c@exemple.test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.field)).toContain('disponibilites');
    }
  });

  it('accepte une grille de créneaux valide', () => {
    const template = templateByKey('event_slots')!;
    const result = validateResponse(template.schema, {
      disponibilites: { jour_1: ['matin'], jour_2: ['soir', 'matin'] },
      nom: 'Camille Martin',
      email: 'camille@exemple.test',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data['disponibilites']).toEqual({
        jour_1: ['matin'],
        jour_2: ['matin', 'soir'],
      });
    }
  });

  it('n’affiche le motif d’insatisfaction que si la recommandation est négative', () => {
    const template = templateByKey('satisfaction_survey')!;
    const garde = validateResponse(template.schema, {
      satisfaction: 5,
      recommandation: 'oui',
      motif_insatisfaction: 'ignoré',
    });
    expect(garde.ok).toBe(true);
    if (garde.ok) expect(garde.value.dropped).toContain('motif_insatisfaction');

    const retenu = validateResponse(template.schema, {
      satisfaction: 1,
      recommandation: 'non',
      motif_insatisfaction: 'Attente trop longue.',
    });
    expect(retenu.ok).toBe(true);
    if (retenu.ok) {
      expect(retenu.value.data['motif_insatisfaction']).toBe('Attente trop longue.');
    }
  });
});
