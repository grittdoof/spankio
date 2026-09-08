import { describe, expect, it } from 'vitest';
import {
  hiddenCount,
  isBlockAllowed,
  publicPageSchema,
  PUBLIC_BLOCKS,
  PUBLIC_BLOCK_META,
  toggleBlock,
  type PublicPageSettings,
} from '@/lib/survey/public-page';

/**
 * Réglages de la page publique.
 *
 * Le sujet réel de ces tests est le SENS de la liste enregistrée : c'est une
 * liste de MASQUAGE, jamais d'autorisation. Un bloc ajouté demain doit naître
 * visible chez les organisations existantes, sinon personne ne saura qu'il
 * existe — et une organisation qui n'a jamais ouvert cet écran doit obtenir
 * une page complète, pas une page vide.
 */

describe('registre des blocs', () => {
  it('décrit chaque bloc, et rien de plus', () => {
    expect(PUBLIC_BLOCK_META.map((meta) => meta.key)).toEqual([...PUBLIC_BLOCKS]);
  });

  it('donne à chaque bloc un libellé ET une explication', () => {
    for (const meta of PUBLIC_BLOCK_META) {
      expect(meta.label.length).toBeGreaterThan(3);
      expect(meta.help.length).toBeGreaterThan(20);
    }
  });
});

describe('défauts', () => {
  it('montre tout, sauf ce qu’une organisation doit vouloir explicitement', () => {
    // Publier le nombre d'inscrits et offrir un lien de partage sont des
    // divulgations : elles se demandent, elles ne s'imposent pas.
    expect(isBlockAllowed(undefined, 'countdown')).toBe(true);
    expect(isBlockAllowed(undefined, 'programme')).toBe(true);
    expect(isBlockAllowed(undefined, 'responseCount')).toBe(false);
    expect(isBlockAllowed(undefined, 'share')).toBe(false);
  });

  it('s’applique aussi à des réglages présents mais vides', () => {
    expect(isBlockAllowed({}, 'countdown')).toBe(true);
    expect(isBlockAllowed({}, 'share')).toBe(false);
  });

  it('une liste VIDE n’est pas l’absence de liste : elle autorise tout', () => {
    // Un premier clic écrit la liste entière ; une liste vide veut donc dire
    // « rien n'est masqué », y compris ce qui l'était par défaut.
    expect(isBlockAllowed({ hidden: [] }, 'share')).toBe(true);
    expect(hiddenCount({ hidden: [] })).toBe(0);
  });
});

describe('bascule', () => {
  it('fige les défauts au premier clic', () => {
    // Sans cela, ouvrir « le partage » réactiverait « le nombre
    // d'inscriptions » masqué par défaut, sans que personne ne l'ait demandé.
    const next = toggleBlock(undefined, 'share', true);
    expect(next).toContain('responseCount');
    expect(next).not.toContain('share');
  });

  it('ferme un bloc en l’ajoutant à la liste', () => {
    const next = toggleBlock({ hidden: [] }, 'programme', false);
    expect(next).toEqual(['programme']);
  });

  it('n’ajoute jamais deux fois le même bloc', () => {
    const once = toggleBlock({ hidden: ['faq'] }, 'faq', false);
    expect(once).toEqual(['faq']);
  });

  it('garde l’ordre du registre, pas l’ordre des clics', () => {
    let hidden = toggleBlock({ hidden: [] }, 'faq', false);
    hidden = toggleBlock({ hidden }, 'banner', false);
    expect(hidden).toEqual(['banner', 'faq']);
  });

  it('fait l’aller-retour sans laisser de trace', () => {
    const closed = toggleBlock({ hidden: [] }, 'countdown', false);
    expect(toggleBlock({ hidden: closed }, 'countdown', true)).toEqual([]);
  });
});

describe('validation du contenu', () => {
  const parse = (input: unknown) => publicPageSchema.safeParse(input);

  it('accepte une page entièrement renseignée', () => {
    const result = parse({
      hidden: ['share'],
      statusLabel: 'Sur invitation',
      details: [{ label: 'Tenue de soirée', value: 'Vestiaire sur place' }],
      organiserWord: { author: 'La direction', role: 'Organisateur', text: 'Bonjour.' },
      programme: [{ time: '19h30', title: 'Accueil', note: 'Cocktail' }],
      travelNote: 'Métro Miromesnil',
      faq: [{ question: 'Puis-je venir accompagné ?', answer: 'Oui.' }],
    });
    expect(result.success).toBe(true);
  });

  it('refuse un bloc inconnu dans la liste de masquage', () => {
    // La liste circule dans du JSON : une valeur inventée doit être refusée,
    // pas rangée en base pour n'avoir aucun effet plus tard.
    expect(parse({ hidden: ['banniere'] }).success).toBe(false);
  });

  it('exige un intitulé de moment, l’heure restant facultative', () => {
    expect(parse({ programme: [{ title: 'Accueil' }] }).success).toBe(true);
    expect(parse({ programme: [{ time: '19h30' }] }).success).toBe(false);
  });

  it('exige une question ET sa réponse', () => {
    expect(parse({ faq: [{ question: 'Où ?' }] }).success).toBe(false);
    expect(parse({ faq: [{ question: 'Où ?', answer: 'Ici.' }] }).success).toBe(true);
  });

  it('borne les listes : une page n’est pas un site', () => {
    const moment = { title: 'x' };
    expect(parse({ programme: Array.from({ length: 20 }, () => moment) }).success).toBe(true);
    expect(parse({ programme: Array.from({ length: 21 }, () => moment) }).success).toBe(false);
    expect(parse({ details: Array.from({ length: 9 }, () => ({ label: 'x' })) }).success).toBe(
      false,
    );
  });

  it('borne les textes', () => {
    expect(parse({ statusLabel: 'x'.repeat(61) }).success).toBe(false);
    // L'accès se rédige en plusieurs lignes : son plafond est celui d'une
    // introduction d'étape, pas celui d'une aide de champ.
    expect(parse({ travelNote: 'x'.repeat(2000) }).success).toBe(true);
    expect(parse({ travelNote: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('garde les sauts de ligne de l’accès, et ne rogne que les bords', () => {
    // `trim()` retire les blancs de bord, jamais ceux du milieu : un accès
    // écrasé en un seul paragraphe devient illisible.
    const result = parse({ travelNote: '  Métro Miromesnil\nBus 22, 43\n  ' });
    expect(result.success && result.data.travelNote).toBe('Métro Miromesnil\nBus 22, 43');
  });

  it('découpe les espaces : un intitulé fait d’espaces n’en est pas un', () => {
    const result = parse({ statusLabel: '  Sur invitation  ' });
    expect(result.success && result.data.statusLabel).toBe('Sur invitation');
  });
});

describe('compteur de blocs fermés', () => {
  it('compte les défauts quand rien n’a été réglé', () => {
    expect(hiddenCount(undefined)).toBe(2);
  });

  it('compte ce qui est réellement fermé', () => {
    const settings: PublicPageSettings = { hidden: ['banner', 'faq', 'share'] };
    expect(hiddenCount(settings)).toBe(3);
  });
});
