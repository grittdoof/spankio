import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { signOut } from '../(auth)/actions';

/**
 * Page dépendante de la session : jamais prérendue. Le marquer explicitement
 * évite que le build tente de la générer statiquement — et rend visible le
 * fait qu'elle est propre à chaque utilisateur.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Espace d’administration' };

interface ModuleEntry {
  key: string;
  name: string;
  allowed: boolean;
  isCore: boolean;
}

/**
 * Accueil de l'espace d'administration.
 *
 * Un compte non rattaché n'y voit pas une interface vide et énigmatique : il
 * voit ce qui lui manque et où le demander. Le tableau de bord complet arrive
 * à l'étape 6.
 */
export default async function AdminHomePage() {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const profile = await context.port.selectOne<{
    role: string;
    status: string;
    organisation_id: string | null;
    full_name: string | null;
  }>({
    table: 'profiles',
    columns: 'role, status, organisation_id, full_name',
    where: [eq('id', context.userId)],
  });

  if (profile.error) {
    return (
      <main className="sp-container" id="contenu" style={{ paddingBlock: '3rem' }}>
        <Alert tone="error">{fr.errors.unexpected}</Alert>
      </main>
    );
  }

  if (profile.data.role === 'super_admin') redirect('/super-admin/demandes');

  const rattached = profile.data.organisation_id !== null && profile.data.status === 'active';

  const organisation = rattached
    ? await context.port.selectOne<{ name: string }>({
        table: 'organisations',
        columns: 'name',
        where: [eq('id', profile.data.organisation_id!)],
      })
    : null;

  const modules = rattached
    ? await context.port.rpc<ModuleEntry[]>('my_modules')
    : null;

  return (
    <main className="sp-container" id="contenu" style={{ paddingBlock: '3rem' }}>
      <div className="sp-stack">
        {!rattached ? (
          <div className="sp-card sp-stack">
            <h1>{fr.auth.status.pendingTitle}</h1>
            <p className="sp-muted">{fr.auth.status.pendingBody}</p>
            <p>
              <Link className="sp-btn" href="/demande-de-rattachement">
                {fr.auth.membershipRequest.title}
              </Link>
            </p>
          </div>
        ) : (
          <div className="sp-card sp-stack">
            <h1>{organisation?.data?.name ?? fr.platform.name}</h1>
            <p className="sp-muted">
              Rôle : {fr.auth.roles[profile.data.role as keyof typeof fr.auth.roles] ?? profile.data.role}
            </p>
            <h2>Modules autorisés</h2>
            <ul>
              {(modules?.data ?? [])
                .filter((module) => module.allowed)
                .map((module) => (
                  <li key={module.key}>{module.name}</li>
                ))}
            </ul>
          </div>
        )}

        <form action={signOut}>
          <button className="sp-btn sp-btn--outline sp-btn--sm" type="submit">
            {fr.nav.signOut}
          </button>
        </form>
      </div>
    </main>
  );
}
