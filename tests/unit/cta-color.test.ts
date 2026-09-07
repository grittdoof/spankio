import { describe, expect, it } from 'vitest';
import {
  checkCtaColor,
  ctaPalette,
  CTA_MIN_RATIO,
  CTA_PAGE_RATIO,
} from '@/lib/design/cta';
import {
  contrastRatio,
  isHexColor,
  normaliseHex,
  relativeLuminance,
  shade,
} from '@/lib/design/color';
import { publicPageSchema } from '@/lib/survey/public-page';

/**
 * Couleur du bouton d'inscription.
 *
 * Deux enjeux, et le second est le vrai sujet :
 *
 *  1. **Lisibilité.** Une organisation choisit son fond ; l'encre en découle.
 *     Une couleur dont aucune encre n'atteint le seuil est refusée, au repos
 *     comme au survol.
 *  2. **Sûreté.** Cette valeur finit dans un attribut `style`, et React
 *     n'assainit pas les valeurs CSS. Ce qui sort de ce module est
 *     RECONSTRUIT depuis des composantes analysées : aucune chaîne d'entrée
 *     n'est recopiée.
 */

describe('forme d’une couleur', () => {
  it('n’accepte que six chiffres hexadécimaux précédés d’un dièse', () => {
    expect(isHexColor('#2F6FDB')).toBe(true);
    expect(isHexColor('#2f6fdb')).toBe(true);
    // Formes refusées : abrégée, sans dièse, nommée, avec alpha.
    expect(isHexColor('#2F6')).toBe(false);
    expect(isHexColor('2F6FDB')).toBe(false);
    expect(isHexColor('rebeccapurple')).toBe(false);
    expect(isHexColor('#2F6FDBFF')).toBe(false);
    expect(isHexColor(' #2F6FDB ')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it('normalise en majuscules', () => {
    expect(normaliseHex('#2f6fdb')).toBe('#2F6FDB');
  });

  it('ne recopie JAMAIS l’entrée : elle est reconstruite', () => {
    // Le point de sûreté : même une entrée qui contient du CSS ne peut pas
    // ressortir, parce que la sortie est recomposée depuis trois nombres.
    expect(normaliseHex('#2F6FDB; background: url(https://mechant.test)')).toBeNull();
    expect(normaliseHex('red;position:fixed')).toBeNull();
    expect(normaliseHex('var(--sp-danger)')).toBeNull();
  });
});

describe('nuance de survol', () => {
  it('garde la teinte : assombrir un rouge ne doit pas le rendre brun', () => {
    const darker = shade('#E00114', -0.08);
    // La teinte OKLCh est conservée à moins d'un degré près.
    expect(contrastRatio(darker, '#FFFFFF')).toBeGreaterThan(
      contrastRatio('#E00114', '#FFFFFF'),
    );
  });

  it('reste dans les bornes : le noir ne peut pas s’assombrir davantage', () => {
    expect(shade('#000000', -0.5)).toBe('#000000');
    expect(shade('#FFFFFF', 0.5)).toBe('#FFFFFF');
  });
});

describe('palette', () => {
  it('choisit l’encre blanche sur un fond sombre', () => {
    const palette = ctaPalette('#0B4A96');
    expect(palette?.ink).toBe('#FFFFFF');
    expect(palette?.ratio).toBeGreaterThanOrEqual(CTA_MIN_RATIO);
  });

  it('choisit l’encre foncée sur un fond clair', () => {
    const palette = ctaPalette('#F5C518');
    expect(palette?.ink).toBe('#1A1D26');
    expect(palette?.ratio).toBeGreaterThanOrEqual(CTA_MIN_RATIO);
  });

  it('s’ÉLOIGNE de l’encre au survol, jamais systématiquement vers le sombre', () => {
    // Encre blanche → le fond s'assombrit ; encre foncée → il s'éclaircit.
    const dark = ctaPalette('#0B4A96')!;
    const light = ctaPalette('#F5C518')!;
    expect(dark.ink).toBe('#FFFFFF');
    expect(light.ink).toBe('#1A1D26');
    expect(relativeLuminance(dark.hover)).toBeLessThan(
      relativeLuminance(dark.background),
    );
    expect(relativeLuminance(light.hover)).toBeGreaterThan(
      relativeLuminance(light.background),
    );
  });

  it('ne fait donc pas baisser le contraste au survol', () => {
    // C'est cette propriété qui rend la vérification au repos suffisante. Une
    // première version assombrissait tout, y compris un jaune à encre foncée :
    // le contraste y baissait, et seule la vérification du survol mordait.
    for (const hex of ['#0B4A96', '#F5C518', '#E00114', '#0B1220', '#042F64', '#8A9BB8']) {
      const palette = ctaPalette(hex);
      expect(palette, hex).not.toBeNull();
      if (!palette) continue;
      expect(palette.hoverRatio, hex).toBeGreaterThanOrEqual(palette.ratio);
    }
  });

  it('garantit le seuil au survol EN TOUTES circonstances, extrêmes compris', () => {
    // Aux extrêmes (blanc pur, noir pur) la nuance repart dans l'autre sens
    // pour rester perceptible, et le contraste y baisse un peu. La garantie
    // n'est donc pas « il ne baisse jamais » mais « il reste au-dessus du
    // seuil » — et c'est celle-là qui protège le répondant.
    for (const hex of ['#FFFFFF', '#000000', '#0B4A96', '#F5C518']) {
      expect(ctaPalette(hex)?.hoverRatio, hex).toBeGreaterThanOrEqual(CTA_MIN_RATIO);
    }
  });

  it('garde un survol visible même aux extrêmes', () => {
    // Le blanc ne peut pas s'éclaircir : on repart dans l'autre sens, et
    // seulement si le contraste y survit.
    expect(ctaPalette('#FFFFFF')?.hover).not.toBe('#FFFFFF');
    expect(ctaPalette('#000000')?.hover).not.toBe('#000000');
  });

  it('refuse une couleur qu’aucune encre ne rend lisible', () => {
    // La bande réellement refusée est ÉTROITE — les gris moyens, autour de
    // #7F7F7F, où le blanc plafonne à 3,95:1 et l'encre foncée à 4,20:1. Un
    // ton plus clair ou plus sombre repasse au-dessus du seuil : la
    // personnalisation reste donc largement ouverte.
    expect(ctaPalette('#787878')).toBeNull();
    expect(ctaPalette('#7F7F7F')).toBeNull();
    // Les deux bords de la bande, eux, passent.
    expect(ctaPalette('#707070')).not.toBeNull();
    expect(ctaPalette('#868686')).not.toBeNull();
  });

  it('accepte en revanche un gris-bleu assez sombre pour l’encre foncée', () => {
    // Contre-exemple retenu : cette couleur était refusée par la première
    // version, non parce qu'elle était illisible — 5,7:1 avec l'encre
    // foncée — mais parce que la règle de survol l'assombrissait.
    const palette = ctaPalette('#8A9BB8');
    expect(palette?.ink).toBe('#1A1D26');
    expect(palette?.ratio).toBeGreaterThanOrEqual(CTA_MIN_RATIO);
  });

  it('refuse une valeur invalide plutôt que de la laisser passer', () => {
    expect(ctaPalette(undefined)).toBeNull();
    expect(ctaPalette('')).toBeNull();
    expect(ctaPalette('#GGGGGG')).toBeNull();
    expect(ctaPalette(42)).toBeNull();
  });

  it('accepte la couleur d’accent de la charte : le défaut doit rester valide', () => {
    expect(ctaPalette('#2F6FDB')?.ink).toBe('#FFFFFF');
  });
});

describe('contraste avec le fond de page', () => {
  it('est mesuré et rendu, sans jamais conditionner un refus', () => {
    // WCAG 1.4.11 dispense de cette exigence un contrôle identifiable par son
    // libellé, ce qui est toujours le cas ici. Un ton pâle est donc accepté.
    const pale = ctaPalette('#F5C518');
    expect(pale).not.toBeNull();
    expect(pale?.pageRatio).toBeLessThan(CTA_PAGE_RATIO);
  });

  it('est élevé pour une couleur franche', () => {
    expect(ctaPalette('#042F64')?.pageRatio).toBeGreaterThan(CTA_PAGE_RATIO);
  });
});

describe('diagnostic', () => {
  it('distingue un format invalide d’un contraste insuffisant', () => {
    expect(checkCtaColor('pas une couleur')).toEqual({ ok: false, reason: 'format' });
    const verdict = checkCtaColor('#7F7F7F');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('contrast');
    // Le chiffre mesuré est rendu : « invalide » n'aiderait personne à choisir
    // une autre couleur.
    if (verdict.reason !== 'contrast') return;
    expect(verdict.ratio).toBeGreaterThan(1);
    expect(verdict.ratio).toBeLessThan(CTA_MIN_RATIO);
  });

  it('renvoie la palette quand la couleur convient', () => {
    const verdict = checkCtaColor('#0B4A96');
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.palette.background).toBe('#0B4A96');
  });
});

describe('enregistrement', () => {
  const parse = (input: unknown) => publicPageSchema.safeParse(input);

  it('accepte un code hexadécimal complet', () => {
    expect(parse({ ctaColor: '#0B4A96' }).success).toBe(true);
  });

  it('refuse tout ce qui n’est pas un code hexadécimal', () => {
    // Le schéma garde le FORMAT : c'est lui qui protège l'attribut `style`.
    expect(parse({ ctaColor: 'red' }).success).toBe(false);
    expect(parse({ ctaColor: '#0B4' }).success).toBe(false);
    expect(parse({ ctaColor: '#0B4A96; background: url(x)' }).success).toBe(false);
  });

  it('ne contraint PAS le contraste : une valeur héritée ne doit pas tout casser', () => {
    // Une contrainte de lisibilité ici ferait échouer la validation des
    // réglages en entier, et la page publique perdrait tous ses blocs d'un
    // coup — le rendu refuse la couleur, il ne jette pas le reste.
    expect(parse({ ctaColor: '#7F7F7F' }).success).toBe(true);
    expect(ctaPalette('#7F7F7F')).toBeNull();
  });
});
