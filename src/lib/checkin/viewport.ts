/**
 * Où se trouve la partie VISIBLE de l'écran — clavier compris.
 *
 * Défaut réel, signalé sur iPhone au premier essai : la barre du bas était en
 * `position: fixed`, donc accrochée au bas de la PAGE. Or Safari n'ouvre pas
 * le clavier en rétrécissant la page : il le pose PAR-DESSUS, et fait glisser
 * la zone visible. La barre restait donc derrière le clavier ou flottait plus
 * haut, avec une bande de liste visible entre les deux ; et un défilement
 * vers le haut, clavier ouvert, l'emportait hors de l'écran.
 *
 * `window.visualViewport` dit où est la zone réellement visible. La barre s'y
 * accroche : elle est relevée de ce que le clavier recouvre, et suit la zone
 * quand on fait défiler. Calcul pur, parce qu'une erreur de signe ici se
 * verrait à l'œil, sur un téléphone, et nulle part ailleurs.
 */

export interface ViewportInput {
  /** Hauteur de la page (`window.innerHeight`). */
  readonly innerHeight: number;
  /** Hauteur de la zone visible (`visualViewport.height`). */
  readonly height: number;
  /** Décalage de la zone visible depuis le haut de la page. */
  readonly offsetTop: number;
}

export interface ViewportMetrics {
  /** De combien relever une barre accrochée en bas : ce que le clavier cache. */
  readonly lift: number;
  /** Haut de la zone visible, pour un panneau qui doit la remplir. */
  readonly top: number;
  /** Hauteur de la zone visible. */
  readonly height: number;
  /** Un clavier est ouvert — pas seulement une barre d'adresse repliée. */
  readonly keyboard: boolean;
}

/**
 * Au-delà de cette hauteur, ce qui recouvre la page est un clavier. En deçà,
 * c'est la barre d'adresse de Safari qui se replie ou se déplie au défilement :
 * la traiter comme un clavier ferait sauter la marge de l'encoche.
 */
export const KEYBOARD_THRESHOLD = 120;

export function viewportMetrics(input: ViewportInput): ViewportMetrics {
  const height = Math.max(0, Math.round(input.height));
  const top = Math.max(0, Math.round(input.offsetTop));
  // Le bas de la zone visible, comparé au bas de la page. Jamais négatif : un
  // arrondi ou un rebond élastique ne doit pas ENFONCER la barre sous l'écran.
  const lift = Math.max(0, Math.round(input.innerHeight - input.height - input.offsetTop));
  return {
    lift,
    top,
    height,
    keyboard: input.innerHeight - input.height > KEYBOARD_THRESHOLD,
  };
}
