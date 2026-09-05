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
 */

export interface AdminNavItem {
  readonly href: string;
  readonly label: string;
}

export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="sp-sidebar__nav" aria-label="Navigation de l’espace d’administration">
      {items.map((item) => {
        // Une sous-page (`/admin/sondages/xxx`) garde son entrée de premier
        // niveau active : l'utilisateur doit voir où il se trouve.
        const active =
          pathname === item.href ||
          (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            className="sp-sidebar__link"
            href={item.href}
            key={item.href}
            {...(active ? { 'aria-current': 'page' as const } : {})}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
