import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminNav, type AdminNavItem } from '@/components/admin/AdminNav';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { signOut } from '../(auth)/actions';

/**
 * Mise en page de l'espace d'administration.
 *
 * La barre latérale n'affiche que ce à quoi le compte a réellement accès : un
 * compte non rattaché n'y voit aucun lien de gestion, un compte privé du
 * module événement n'y voit pas ce module. Ce n'est pas une barrière — le RLS
 * l'est — mais une interface qui ne promet rien qu'elle ne tienne.
 */

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);

  const items: AdminNavItem[] = [{ href: '/admin', label: 'Mon espace' }];
  if (session?.attached) {
    items.push({ href: '/admin/sondages', label: 'Formulaires' });
  }
  if (session?.isPlatformAdmin) {
    items.push({ href: '/super-admin/demandes', label: 'Demandes de rattachement' });
  }

  return (
    <div className="sp-admin">
      <div className="sp-sidebar">
        <Link className="sp-sidebar__brand" href="/admin">
          {session?.organisationName ?? fr.platform.name}
        </Link>
        <AdminNav items={items} />
        <form action={signOut} style={{ marginTop: '1.5rem' }}>
          <button className="sp-btn sp-btn--outline sp-btn--sm" type="submit">
            {fr.nav.signOut}
          </button>
        </form>
      </div>
      <main className="sp-admin__main" id="contenu">
        {children}
      </main>
    </div>
  );
}
