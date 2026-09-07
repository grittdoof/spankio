/**
 * Marque d'une organisation : son logo, ou à défaut un carré portant son
 * initiale.
 *
 * Le logo est celui déposé dans `/admin/organisation`. Il remplace l'initiale
 * dès qu'il existe : c'est ce que l'organisation reconnaît, alors qu'une
 * lettre dans un carré n'est qu'un pis-aller — mais un pis-aller nécessaire,
 * parce qu'une organisation qui n'a pas encore de logo doit tout de même se
 * distinguer d'une autre dans la barre latérale.
 *
 * L'initiale est dessinée en CSS et en texte, sans fichier : une origine de
 * moins à autoriser dans la politique de sécurité de contenu, et aucun
 * chargement.
 *
 * `aria-hidden` / `alt=""` : la marque est décorative dans les deux cas. Le
 * nom qui l'accompagne porte l'information — la répéter ferait entendre
 * « S Spie batignolles ».
 */
export interface BrandMarkProps {
  name: string;
  /** Classe de dimensionnement. Le CSS distingue le carré de l'image. */
  className: string;
  /** Logo de l'organisation, s'il en a un. */
  logoUrl?: string | null;
}

export function BrandMark({ name, className, logoUrl }: BrandMarkProps) {
  const logo = logoUrl?.trim();

  if (logo) {
    return (
      // `next/image` est écarté ici pour la même raison qu'ailleurs : il ferait
      // transiter le logo de CHAQUE organisation par l'optimiseur de Vercel,
      // facturé à l'usage, alors que le fichier est déjà servi par un CDN.
      // eslint-disable-next-line @next/next/no-img-element
      <img alt="" className={className} decoding="async" src={logo} />
    );
  }

  const initial = [...name.trim()][0]?.toUpperCase() ?? '·';
  return (
    <span aria-hidden="true" className={className}>
      {initial}
    </span>
  );
}
