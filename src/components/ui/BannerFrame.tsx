import { BANNER_ASPECT_LABEL } from '@/lib/event/banner';

/**
 * Cadre d'affichage d'une bannière d'événement.
 *
 * Un seul composant pour l'aperçu de l'éditeur, la miniature de la liste et
 * le rendu public : trois cadrages différents donneraient trois images
 * différentes, et l'organisation ne saurait pas ce que voit le répondant.
 *
 * Le cadre réserve sa place avant le chargement (`aspect-ratio` en CSS) :
 * sans cela la page saute au moment où l'image arrive. Une image au format de
 * référence s'affiche entière ; une image plus haute ou plus large est
 * recadrée au centre plutôt que déformée.
 *
 * `alt=""` : la bannière est décorative. Le titre de l'événement porte
 * l'information juste à côté ; la décrire une seconde fois ferait entendre
 * deux fois la même chose.
 */

export type BannerVariant = 'full' | 'preview' | 'thumb';

const VARIANT_CLASS: Readonly<Record<BannerVariant, string>> = {
  full: '',
  preview: ' sp-banner-frame--preview',
  thumb: ' sp-banner-frame--thumb',
};

export interface BannerFrameProps {
  url: string;
  variant?: BannerVariant;
  /** Chargement différé pour les miniatures d'une longue liste. */
  lazy?: boolean;
}

export function BannerFrame({ url, variant = 'full', lazy = false }: BannerFrameProps) {
  return (
    <span className={`sp-banner-frame${VARIANT_CLASS[variant]}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="sp-banner"
        decoding="async"
        loading={lazy ? 'lazy' : 'eager'}
        src={url}
      />
    </span>
  );
}

export { BANNER_ASPECT_LABEL };
