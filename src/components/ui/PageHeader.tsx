import Link from 'next/link';

/**
 * En-tête d'écran : retour, titre, chapeau, actions — toujours dans cet ordre,
 * sur tous les écrans.
 *
 * L'uniformité est le but. Un en-tête réinventé à chaque page oblige à
 * relocaliser le titre et l'action principale à chaque navigation ; c'est un
 * coût invisible, payé à chaque écran.
 */

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  /** Une phrase : ce que l'écran permet de faire. */
  lead?: string;
  crumbs?: readonly Crumb[];
  /** Action principale de l'écran, à droite. Une seule. */
  actions?: React.ReactNode;
  /** Badges d'état affichés sous le titre. */
  meta?: React.ReactNode;
}

export function PageHeader({ title, lead, crumbs, actions, meta }: PageHeaderProps) {
  // Un seul lien de retour, vers le parent — et non la chaîne entière.
  //
  // Un fil d'Ariane complet est une phrase que l'œil doit lire pour en
  // extraire un mot ; ce qu'on cherche presque toujours, c'est « remonter
  // d'un cran ». Le chemin complet reste connu de l'URL, et le titre juste en
  // dessous dit où l'on est.
  const parent = [...(crumbs ?? [])].reverse().find((crumb) => crumb.href);

  return (
    <header className="sp-header">
      <div className="sp-header__text">
        {parent?.href ? (
          <Link className="sp-back" href={parent.href}>
            <svg
              aria-hidden="true"
              className="sp-back__icon"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M14 6l-6 6 6 6" />
            </svg>
            {parent.label}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {meta ? <p className="sp-header__meta">{meta}</p> : null}
        {lead ? <p className="sp-lead">{lead}</p> : null}
      </div>
      {actions ? <div className="sp-header__actions">{actions}</div> : null}
    </header>
  );
}
