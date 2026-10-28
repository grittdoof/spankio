import { describe, expect, it } from 'vitest';
import { z } from '@/lib/config/zod';
import { SURVEY_TEMPLATES } from '@/lib/event/templates';
import { updateSurveySchema } from '@/lib/services/surveys';
import { validateSurveySchema } from '@/lib/survey/schema';
import { validateSurveySettings } from '@/lib/survey/settings';

/**
 * Ce que la montée de zod 3 vers zod 4 a RÉELLEMENT changé.
 *
 * R14 posait la condition : « prendre la 4 sans relire les tests de validation
 * reviendrait à changer les règles sans les vérifier ». Les 1632 tests sont
 * passés sans une ligne de code modifiée — ce qui ne prouve rien, puisqu'ils
 * n'interrogeaient aucun des points de rupture. Les 269 cas rejoués à travers
 * les deux moteurs en ont trouvé quatre qui comptent ; ce fichier les fige,
 * pour que la prochaine montée les voie bouger.
 *
 * Deux d'entre eux changent un verdict, et dans un seul sens : zod 4 refuse ce
 * que zod 3 acceptait. AUCUN cas ne passe de refusé à accepté — c'est la
 * propriété qui rend la montée sûre pour une barrière de validation.
 */

const step = (fields: unknown[]) => ({ version: 1, steps: [{ id: 'etape_1', fields }] });

const checkbox = (extra: Record<string, unknown>) => ({
  id: 'choix',
  type: 'checkbox',
  label: 'Vos choix',
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
  ...extra,
});

describe('zod 4 — entiers bornés à la plage sûre', () => {
  /**
   * `z.number().int()` n'acceptait, en zod 3, aucune borne haute implicite :
   * au-delà de 2^53 les entiers ne sont plus distinguables les uns des autres,
   * et `minSelected` / `maxSelected` sont les deux seules bornes du schéma
   * écrites sans `.max()` explicite — rien ne les arrêtait.
   */
  it('refuse un nombre de choix au-delà de l’entier sûr', () => {
    const refused = validateSurveySchema(
      step([checkbox({ maxSelected: Number.MAX_SAFE_INTEGER + 1 })]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.issues.map((issue) => issue.code)).toContain('too_big');
      expect(refused.issues[0]!.path).toBe('steps.0.fields.0.maxSelected');
    }
  });

  it('accepte encore la borne sûre elle-même', () => {
    expect(validateSurveySchema(step([checkbox({ maxSelected: Number.MAX_SAFE_INTEGER })])).ok).toBe(
      true,
    );
  });
});

describe('zod 4 — décalage horaire ISO 8601', () => {
  /**
   * `z.iso.datetime({ offset: true })` (ex-`z.string().datetime()`) exige
   * désormais le deux-points du décalage : `+02:00` passe, `+0200` non.
   *
   * L'application n'est pas concernée par ses propres écritures — toutes les
   * dates d'événement viennent de `wallClockToIso`, donc de
   * `Date.prototype.toISOString()`, qui termine en `Z`. Le resserrement porte
   * sur l'API : un appel forgé à `PATCH /api/admin/surveys/[id]` ne peut plus
   * déposer en base une forme que `new Date()` lit, mais que la norme écrit
   * autrement.
   */
  const dates = ['opensAt', 'closesAt', 'eventStartsAt', 'eventEndsAt'] as const;

  it('accepte « Z » et un décalage avec deux-points', () => {
    for (const key of dates) {
      expect(updateSurveySchema.safeParse({ [key]: '2026-09-04T18:30:00.000Z' }).success).toBe(true);
      expect(updateSurveySchema.safeParse({ [key]: '2026-09-04T18:30:00+02:00' }).success).toBe(
        true,
      );
    }
  });

  it('refuse un décalage sans deux-points, que zod 3 laissait passer', () => {
    for (const key of dates) {
      expect(updateSurveySchema.safeParse({ [key]: '2026-09-04T18:30:00+0200' }).success).toBe(
        false,
      );
    }
  });
});

describe('zod 4 — collection contrainte surdimensionnée (GHSA-mrhx-c7xc-m3w5)', () => {
  /**
   * L'avis de sécurité qui a rendu cette montée obligatoire. zod 3 validait
   * CHAQUE élément d'un tableau avant de constater qu'il dépassait son
   * plafond, et produisait un objet d'anomalie par élément : un corps de
   * requête recevable produisait des centaines de milliers d'objets.
   *
   * Ce n'est pas une affaire de bibliothèque seulement : `validationErrorResponse`
   * construit un dictionnaire à partir de CHAQUE anomalie, et
   * `validateSurveySchema` en recopie chemin, code et message. Le coût de zod
   * se payait donc une deuxième fois dans notre code.
   */
  it('signale un dépassement de taille sans examiner chaque élément', () => {
    const schema = z.array(z.string().max(5)).max(3);
    const result = schema.safeParse(Array.from({ length: 50_000 }, () => 'bien trop long'));

    expect(result.success).toBe(false);
    if (!result.success) {
      // zod 3 : 50 001 anomalies — une par élément, plus le dépassement.
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]!.code).toBe('too_big');
    }
  });

  it('refuse un schéma de sondage hors plafond sans énumérer ses étapes', () => {
    const huge = {
      version: 1,
      steps: Array.from({ length: 5_000 }, (_, index) => ({
        id: `etape_${index}`,
        fields: [{ id: 'q', type: 'text', label: 'Q' }],
      })),
    };
    const result = validateSurveySchema(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(1);
  });
});

describe('zod 4 — les messages par défaut sont en français', () => {
  /**
   * Ces messages ne restent pas dans un journal : `SurveyBuilder` énumère
   * `Object.values(result.fields)` sous le formulaire, et la route de
   * géocodage renvoie `issues[0].message` comme message d'erreur.
   *
   * zod 3 écrivait « Required » et « Expected string, received number ».
   * La montée a réécrit ces phrases ; les laisser en anglais aurait été un
   * choix, pas un héritage.
   */
  it('nomme le type attendu en français', () => {
    const result = z.object({ titre: z.string().min(2) }).safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toMatch(/attendu/);
      expect(result.error.issues[0]!.message).not.toMatch(/expected/i);
    }
  });

  it('nomme un dépassement de longueur en français', () => {
    const result = z.string().max(3).safeParse('beaucoup trop long');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toMatch(/Trop grand/);
    }
  });

  it('conserve les messages écrits à la main', () => {
    const refused = validateSurveySchema(
      step([{ id: 'Majuscule', type: 'text', label: 'Q' }]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.issues.some((issue) => issue.message.includes('lettre minuscule'))).toBe(true);
    }
  });
});

describe('zod 4 — les réglages enregistrés restent lisibles', () => {
  /**
   * Le risque silencieux de cette montée, et le seul qui ne se serait pas vu :
   * `validateSurveySettings` échouant d'un cran rendrait `settings.ok` faux, et
   * la page publique perdrait TOUS ses réglages d'un coup (`settings.ok ? … : {}`)
   * — pas un bloc, tous. Aucun écran ne l'annoncerait.
   *
   * Les 45 formes de réglages rejouées à travers les deux moteurs n'ont montré
   * AUCUN changement de verdict. Ce test garde les quatre modèles livrés, qui
   * sont les seuls réglages dont la forme exacte soit connue du dépôt.
   */
  it('accepte les réglages de chaque modèle', () => {
    for (const template of SURVEY_TEMPLATES) {
      const result = validateSurveySettings(template.settings);
      expect(result.ok, template.key).toBe(true);
    }
  });

  it('accepte une page publique complète', () => {
    const result = validateSurveySettings({
      publicPage: {
        hidden: ['share', 'faq'],
        statusLabel: 'Inscriptions ouvertes',
        ctaColor: '#1B3A6B',
        details: [{ label: 'Tenue', value: 'Tenue de ville' }],
        organiserWord: { author: 'A. Martin', role: 'Direction', text: 'Au plaisir.' },
        programme: [{ time: '19h30', title: 'Accueil' }],
        travelNote: 'Métro ligne 1\nBus 42\n\nParking sur place',
        faq: [{ question: 'Puis-je venir accompagné ?', answer: 'Oui.' }],
      },
      confirmation: { enabled: true, emailField: 'courriel', hidden: ['endTime'] },
      attendance: { presenceField: 'venue', presenceValue: 'oui', partyMode: 'one' },
      calendar: { title: 'Soirée des 180 ans' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Les sauts de ligne de l'accès survivent au `trim()`, qui ne retire que
      // les blancs de bord : la règle tient encore en zod 4.
      expect(result.settings.publicPage?.travelNote).toContain('\nBus 42\n');
    }
  });
});
