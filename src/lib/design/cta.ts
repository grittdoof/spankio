import { contrastRatio, normaliseHex, shade } from './color';
import { CSS_TOKEN_HEX } from './tokens';

/**
 * Couleur du bouton d'inscription d'une invitation.
 *
 * Une organisation choisit UNE couleur — son fond. Tout le reste en découle,
 * et c'est le point : laisser choisir aussi la couleur du texte reviendrait à
 * laisser fabriquer un bouton illisible.
 *
 *  1. **L'encre est déduite, jamais choisie.** Blanc ou encre foncée de la
 *     charte, celle des deux qui contraste le mieux avec le fond.
 *  2. **Le survol s'éloigne de l'encre**, il ne va pas systématiquement vers le
 *     sombre. Encre blanche → on assombrit le fond ; encre foncée → on
 *     l'éclaircit. Le contraste ne peut donc que MONTER au survol, et c'est ce
 *     qui rend la vérification au repos suffisante. La première version
 *     assombrissait tout, y compris un bouton jaune à encre foncée : le
 *     contraste y baissait, et la seule vérification qui mordait était celle du
 *     survol — l'inverse de ce qu'on veut.
 *  3. **Une couleur qui ne peut pas être rendue lisible est REFUSÉE.** La
 *     fonction renvoie `null`, et l'appelant retombe sur la charte. C'est le
 *     dernier rempart : quoi qu'il y ait en base — une valeur d'une version
 *     antérieure, une saisie forcée par l'API — la page publique ne peut pas
 *     afficher un appel à l'action qu'on ne lit pas.
 *
 * Le seuil est celui du reste du produit : 4,5:1 (WCAG 1.4.3 AA). Un libellé
 * de bouton est du texte normal, pas du grand texte.
 *
 * Ce qui n'est PAS imposé, et pourquoi : le contraste du bouton avec le fond de
 * page. WCAG 1.4.11 dispense de cette exigence un contrôle identifiable par son
 * libellé — ce qui est toujours le cas ici, l'encre étant garantie à 4,5:1. Une
 * couleur très pâle est donc acceptée, et simplement SIGNALÉE : refuser tous
 * les pastels au nom d'une règle qui ne s'applique pas serait un excès de zèle
 * déguisé en accessibilité.
 */

/** Contraste minimal exigé entre le libellé et son fond. */
export const CTA_MIN_RATIO = 4.5;

/** Écart de luminosité perceptuelle entre le repos et le survol. */
const HOVER_DELTA = 0.08;

const WHITE = CSS_TOKEN_HEX['--sp-on-accent'] ?? '#FFFFFF';
const INK = CSS_TOKEN_HEX['--sp-text'] ?? '#1A1D26';
/** Fond de page du thème CLAIR : le `pageRatio` ne décrit que celui-là. */
const PAGE = CSS_TOKEN_HEX['--sp-bg'] ?? '#F2F3F7';

/** En dessous, le contour du bouton se devine à peine sur le fond de page. */
export const CTA_PAGE_RATIO = 3;

export interface CtaPalette {
  /** Fond, en forme canonique — reconstruit, jamais recopié de l'entrée. */
  readonly background: string;
  readonly hover: string;
  /** Libellé : blanc, ou l'encre foncée de la charte. */
  readonly ink: string;
  readonly ratio: number;
  readonly hoverRatio: number;
  /**
   * Contraste du fond du bouton avec le fond de page du thème clair. Purement
   * informatif : il ne conditionne aucun refus.
   */
  readonly pageRatio: number;
}

/**
 * Palette d'un bouton à partir de son fond, ou `null` si la couleur est
 * invalide ou impossible à rendre lisible.
 */
export function ctaPalette(background: unknown): CtaPalette | null {
  const hex = normaliseHex(background);
  if (!hex) return null;

  const white = contrastRatio(WHITE, hex);
  const ink = contrastRatio(INK, hex);
  const chosen = white >= ink ? WHITE : INK;
  const ratio = Math.max(white, ink);
  if (ratio < CTA_MIN_RATIO) return null;

  const hover = hoverShade(hex, chosen);
  // Ceinture, pas contrainte agissante : par construction le survol s'écarte
  // de l'encre, donc son contraste est au moins celui du repos. Le contrôle
  // reste là pour qu'un changement de la règle de survol ne puisse pas
  // introduire un bouton illisible sans faire échouer quelque chose.
  const hoverRatio = contrastRatio(chosen, hover);
  if (hoverRatio < CTA_MIN_RATIO) return null;

  return {
    background: hex,
    hover,
    ink: chosen,
    ratio: round(ratio),
    hoverRatio: round(hoverRatio),
    pageRatio: round(contrastRatio(hex, PAGE)),
  };
}

/**
 * Diagnostic d'une couleur, pour l'écran de réglages : il doit dire POURQUOI
 * une couleur est refusée, avec le chiffre mesuré, plutôt que « invalide ».
 */
export type CtaVerdict =
  | { readonly ok: true; readonly palette: CtaPalette }
  | { readonly ok: false; readonly reason: 'format' }
  | { readonly ok: false; readonly reason: 'contrast'; readonly ratio: number };

export function checkCtaColor(background: unknown): CtaVerdict {
  const hex = normaliseHex(background);
  if (!hex) return { ok: false, reason: 'format' };

  const palette = ctaPalette(hex);
  if (palette) return { ok: true, palette };

  const best = Math.max(contrastRatio(WHITE, hex), contrastRatio(INK, hex));
  return { ok: false, reason: 'contrast', ratio: round(best) };
}

/**
 * Fond du survol : on s'écarte de l'encre.
 *
 * Cas limite traité : un fond déjà blanc ne peut pas s'éclaircir davantage, ni
 * un fond noir s'assombrir — la nuance calculée serait alors identique au
 * repos, et le survol ne se verrait pas. On repart dans l'autre sens, et
 * seulement si le contraste y survit.
 */
function hoverShade(hex: string, ink: string): string {
  const away = shade(hex, ink === WHITE ? -HOVER_DELTA : HOVER_DELTA);
  if (away !== hex) return away;

  const back = shade(hex, ink === WHITE ? HOVER_DELTA : -HOVER_DELTA);
  return contrastRatio(ink, back) >= CTA_MIN_RATIO ? back : hex;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
