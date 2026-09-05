import { describe, expect, it } from 'vitest';
import {
  WIZARD_STEPS,
  WIZARD_TOTAL,
  creationUrl,
  guideUrl,
  previousCreationUrl,
  resolveCreationStep,
  stepLabel,
  stepNumber,
  templatesFor,
} from '@/lib/admin/wizard';
import { SURVEY_TEMPLATES } from '@/lib/event/templates';

/**
 * Navigation du parcours guidé.
 *
 * Ce qui compte ici n'est pas qu'un chemin heureux fonctionne, mais qu'aucune
 * URL bricolée n'amène sur un écran incapable d'aboutir : saisir un titre pour
 * un formulaire dont le type est inconnu se terminerait par un refus après le
 * travail de l'utilisateur.
 */

const SURVEY = { kind: 'survey' as const, templateKey: null };

describe('définition du parcours', () => {
  it('compte cinq écrans, chacun avec un libellé', () => {
    expect(WIZARD_TOTAL).toBe(5);
    for (const step of WIZARD_STEPS) {
      expect(step.label.length).toBeGreaterThan(3);
    }
  });

  it('numérote les étapes dans l’ordre déclaré', () => {
    expect(stepNumber('type')).toBe(1);
    expect(stepNumber('modele')).toBe(2);
    expect(stepNumber('titre')).toBe(3);
    expect(stepNumber('informations')).toBe(4);
    expect(stepNumber('pret')).toBe(5);
  });

  it('donne le libellé de l’étape courante', () => {
    expect(stepLabel('informations')).toBe('Informations aux répondants');
  });
});

describe('résolution d’un écran', () => {
  it('affiche le premier écran sans paramètre', () => {
    const result = resolveCreationStep({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.step).toBe('type');
  });

  it('accepte le choix du type', () => {
    const result = resolveCreationStep({ etape: 'modele', type: 'event' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.choices.kind).toBe('event');
  });

  it('renvoie au premier écran quand le type manque', () => {
    const result = resolveCreationStep({ etape: 'modele' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectTo).toContain('etape=type');
  });

  it.each(['sondages', 'SURVEY', '', 'autre'])(
    'renvoie au premier écran pour un type invalide (« %s »)',
    (type) => {
      const result = resolveCreationStep({ etape: 'titre', type, modele: 'vierge' });
      expect(result.ok).toBe(false);
    },
  );

  it('renvoie au choix du modèle quand celui-ci manque', () => {
    const result = resolveCreationStep({ etape: 'titre', type: 'survey' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectTo).toContain('etape=modele');
  });

  it('accepte le formulaire vierge', () => {
    const result = resolveCreationStep({ etape: 'titre', type: 'survey', modele: 'vierge' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.step).toBe('titre');
      expect(result.choices.templateKey).toBeNull();
    }
  });

  it('accepte un modèle existant', () => {
    const result = resolveCreationStep({
      etape: 'titre',
      type: 'survey',
      modele: 'satisfaction_survey',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.choices.templateKey).toBe('satisfaction_survey');
  });

  it('renvoie au choix du modèle pour une clé inconnue', () => {
    // Plutôt que de laisser saisir un titre pour une création qui échouera.
    const result = resolveCreationStep({
      etape: 'titre',
      type: 'survey',
      modele: 'modele_inexistant',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectTo).toContain('etape=modele');
  });

  it('corrige le type quand le modèle en impose un autre', () => {
    // « Inscription à un événement » est un modèle d'événement : demander un
    // sondage avec ce modèle est une incohérence, corrigée et non ignorée.
    const result = resolveCreationStep({
      etape: 'titre',
      type: 'survey',
      modele: 'event_registration',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.choices.kind).toBe('event');
  });

  it('ramène au début pour une étape inconnue', () => {
    const result = resolveCreationStep({ etape: 'etape_42', type: 'survey' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectTo).toContain('etape=type');
  });
});

describe('URL des écrans', () => {
  it('n’emporte le modèle que sur l’écran du titre', () => {
    expect(creationUrl('modele', SURVEY)).not.toContain('modele=');
    expect(creationUrl('titre', SURVEY)).toContain('modele=vierge');
  });

  it('emporte la clé du modèle choisi', () => {
    expect(creationUrl('titre', { kind: 'survey', templateKey: 'needs_survey' })).toContain(
      'modele=needs_survey',
    );
  });

  it('ne transporte que des valeurs issues de listes fermées', () => {
    // Aucune donnée personnelle ne circule dans l'URL : elle finirait dans les
    // journaux du proxy et dans l'historique du navigateur.
    const url = new URL(creationUrl('titre', SURVEY), 'https://exemple.test');
    expect([...url.searchParams.keys()].sort()).toEqual(['etape', 'modele', 'type']);
  });

  it('compose les URL du parcours postérieur à la création', () => {
    expect(guideUrl('abc', 'informations')).toBe('/admin/sondages/nouveau/abc/informations');
    expect(guideUrl('abc', 'pret')).toBe('/admin/sondages/nouveau/abc/pret');
  });
});

describe('retour en arrière', () => {
  it('n’en propose pas sur le premier écran', () => {
    expect(previousCreationUrl('type', SURVEY, null)).toBeNull();
  });

  it('remonte d’un écran dans la phase de création', () => {
    expect(previousCreationUrl('modele', SURVEY, null)).toContain('etape=type');
    expect(previousCreationUrl('titre', SURVEY, null)).toContain('etape=modele');
  });

  it('ne renvoie jamais à l’écran du titre après création', () => {
    // Y retourner créerait un SECOND brouillon. Le titre se corrige dans
    // l'éditeur, où il est déjà enregistré.
    const back = previousCreationUrl('informations', SURVEY, 'abc');
    expect(back).toBe('/admin/sondages/abc');
    expect(back).not.toContain('nouveau');
  });

  it('remonte des informations depuis le récapitulatif', () => {
    expect(previousCreationUrl('pret', SURVEY, 'abc')).toBe(
      '/admin/sondages/nouveau/abc/informations',
    );
  });
});

describe('modèles proposés', () => {
  it('ne propose que les modèles du type demandé', () => {
    const all = new Set(['core', 'event']);
    for (const template of templatesFor(SURVEY_TEMPLATES, 'event', all)) {
      expect(template.kind).toBe('event');
    }
  });

  it('écarte les modèles dont le module n’est pas autorisé', () => {
    // Proposer un modèle que le RLS refusera serait une promesse non tenue.
    const core = new Set(['core']);
    expect(templatesFor(SURVEY_TEMPLATES, 'event', core)).toEqual([]);
    expect(templatesFor(SURVEY_TEMPLATES, 'survey', core).length).toBeGreaterThan(0);
  });

  it('ne propose rien sans aucun module autorisé', () => {
    expect(templatesFor(SURVEY_TEMPLATES, 'survey', new Set())).toEqual([]);
  });
});
