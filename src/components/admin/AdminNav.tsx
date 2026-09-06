'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navigation de l'espace d'administration.
 *
 * Cliente pour une seule raison : `aria-current="page"` doit désigner la page
 * réellement affichée, et le chemin n'est pas connu d'une mise en page
 * serveur. La surbrillance n'est donc pas qu'un effet visuel — elle est
 * annoncée par les lecteurs d'écran.
 *
 * Les icônes sont dessinées en SVG inline, sans bibliothèque : quelques traits
 * ne justifient pas une dépendance, et un `aria-hidden` évite qu'elles soient
 * annoncées en double du libellé.
 */

export type AdminNavIcon = 'home' | 'forms' | 'organisation' | 'requests';

export interface AdminNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: AdminNavIcon;
  /** Intitulé de section affiché AVANT cette entrée. */
  readonly group?: string;
}

/** Tracés à 24×24, contour uniquement : ils suivent la couleur du texte. */
const PATHS: Readonly<Record<AdminNavIcon, string>> = {
  home: 'M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9',
  forms: 'M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 9h6M9 13h6M9 17h3',
  organisation:
    'M4 20h16M6 20V8l6-4 6 4v12M10 12h1m3 0h1m-5 4h1m3 0h1',
  requests: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20c0-3.3 3.6-5 8-5s8 1.7 8 5',
};

function Icon({ name }: { name: AdminNavIcon }) {
  return (
    <svg
      aria-hidden="true"
      className="sp-sidebar__icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation de l’espace d’administration" className="sp-sidebar__nav">
      {items.map((item) => {
        // Une sous-page (`/admin/sondages/xxx`) garde son entrée de premier
        // niveau active : l'utilisateur doit voir où il se trouve.
        const active =
          pathname === item.href ||
          (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));

        return (
          <div key={item.href}>
            {item.group ? <p className="sp-sidebar__group">{item.group}</p> : null}
            <Link
              className="sp-sidebar__link"
              href={item.href}
              {...(active ? { 'aria-current': 'page' as const } : {})}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
