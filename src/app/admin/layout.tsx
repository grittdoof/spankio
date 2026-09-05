import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminNav, type AdminNavItem } from '@/components/admin/AdminNav';
import { BrandMark } from '@/components/ui/BrandMark';
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
  const name = session?.organisationName ?? fr.platform.name;

  const items: AdminNavItem[] = [{ href: '/admin', label: 'Mon espace', icon: 'home' }];
  if (session?.attached) {
    items.push({ href: '/admin/sondages', label: 'Formulaires', icon: 'forms' });
  }
  if (session?.isPlatformAdmin) {
    items.push({
      href: '/super-admin/demandes',
      label: 'Demandes de rattachement',
      icon: 'requests',
      group: 'Plateforme',
    });
  }

  return (
    <div className="sp-admin">
      <div className="sp-sidebar">
        <Link className="sp-sidebar__brand" href="/admin">
          <BrandMark className="sp-sidebar__mark" name={name} />
          <span className="sp-sidebar__name">{name}</span>
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
