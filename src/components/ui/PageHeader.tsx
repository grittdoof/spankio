import Link from 'next/link';

/**
 * En-tête d'écran : fil d'Ariane, titre, chapeau, actions — toujours dans cet
 * ordre, sur tous les écrans.
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
  return (
    <header className="sp-header">
      <div className="sp-header__text">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Fil d’Ariane">
            <ol className="sp-crumbs">
              {crumbs.map((crumb) => (
                <li key={`${crumb.label}-${crumb.href ?? ''}`}>
                  {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1>{title}</h1>
        {meta ? <p className="sp-header__meta">{meta}</p> : null}
        {lead ? <p className="sp-lead">{lead}</p> : null}
      </div>
      {actions ? <div className="sp-header__actions">{actions}</div> : null}
    </header>
  );
}
