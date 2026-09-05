/**
 * Marque de la plateforme : un carré azur portant une initiale.
 *
 * Dessinée en CSS et en texte, sans fichier image : une origine de moins à
 * autoriser dans la politique de sécurité de contenu, aucun chargement, et
 * l'initiale suit le nom de l'organisation quand il y en a une.
 *
 * `aria-hidden` : la marque est décorative. Le nom qui l'accompagne porte
 * l'information — la répéter ferait entendre « S Spie batignolles ».
 */
export function BrandMark({ name, className }: { name: string; className: string }) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? '·';
  return (
    <span aria-hidden="true" className={className}>
      {initial}
    </span>
  );
}
