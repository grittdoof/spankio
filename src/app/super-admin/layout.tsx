import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminNav, type AdminNavItem } from '@/components/admin/AdminNav';
import { BrandMark } from '@/components/ui/BrandMark';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { signOut } from '../(auth)/actions';

/**
 * Espace de la plateforme.
 *
 * Distinct de l'espace d'organisation, et pas seulement par son adresse : ce
 * ne sont pas les mêmes objets. Ici on gouverne des organisations et des
 * rattachements ; là-bas on fabrique des formulaires. Les mêler dans une seule
 * navigation obligerait à se demander, à chaque entrée, de quel côté on se
 * trouve.
 *
 * La barrière reste le RLS : un compte ordinaire qui atteint ces adresses ne
 * voit que ses propres lignes et n'aboutit à aucune écriture. La redirection
 * ci-dessous ne fait que lui éviter un écran vide et incompréhensible.
 */

export const dynamic = 'force-dynamic';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session?.isPlatformAdmin) redirect('/admin');

  const items: AdminNavItem[] = [
    { href: '/super-admin/demandes', label: 'Demandes de rattachement', icon: 'requests' },
    { href: '/super-admin/organisations', label: 'Organisations', icon: 'organisation' },
  ];

  if (session.attached) {
    items.push({
      href: '/admin',
      label: session.organisationName ?? 'Mon organisation',
      icon: 'home',
      group: 'Mon espace',
    });
  }

  return (
    <div className="sp-admin">
      <div className="sp-sidebar">
        <Link className="sp-sidebar__brand" href="/super-admin/demandes">
          <BrandMark className="sp-sidebar__mark" name={fr.platform.name} />
          <span className="sp-sidebar__name">Plateforme</span>
        </Link>

        <AdminNav items={items} />

        <div className="sp-sidebar__foot">
          <form action={signOut}>
            <button className="sp-btn sp-btn--ghost sp-btn--sm" type="submit">
              {fr.nav.signOut}
            </button>
          </form>
        </div>
      </div>

      <main className="sp-admin__main" id="contenu">
        <div className="sp-page">{children}</div>
      </main>
    </div>
  );
}
