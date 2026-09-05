import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';

/**
 * Page dépendante de la session : jamais prérendue. Le marquer explicitement
 * évite que le build tente de la générer statiquement — et rend visible le
 * fait qu'elle est propre à chaque utilisateur.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Espace d’administration' };

/**
 * Accueil de l'espace d'administration.
 *
 * Un compte non rattaché n'y voit pas une interface vide et énigmatique : il
 * voit ce qui lui manque et où le demander.
 */
export default async function AdminHomePage() {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  // Un super administrateur SANS organisation n'a rien à faire ici : son
  // espace est celui de la plateforme. S'il en a une, il voit son espace
  // d'organisation, avec un lien vers l'espace plateforme — les deux rôles
  // s'additionnent.
  if (session.isPlatformAdmin && !session.attached) redirect('/super-admin/demandes');

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      {!session.attached ? (
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
        <>
          <div className="sp-page-header">
            <div>
              <h1>{session.organisationName}</h1>
              <p className="sp-muted">
                Rôle :{' '}
                {fr.auth.roles[session.role as keyof typeof fr.auth.roles] ?? session.role}
              </p>
            </div>
            <Link className="sp-btn" href="/admin/sondages">
              Gérer les formulaires
            </Link>
          </div>

          <div className="sp-card sp-stack">
            <h2 className="sp-card__title">Modules autorisés</h2>
            <ul>
              {session.modules
                .filter((module) => module.allowed)
                .map((module) => (
                  <li key={module.key}>{module.name}</li>
                ))}
            </ul>
          </div>
        </>
      )}

      {session.isPlatformAdmin ? (
        <div className="sp-card sp-stack">
          <h2 className="sp-card__title">Administration de la plateforme</h2>
          <p className="sp-muted">
            Votre compte porte aussi le rôle de super administrateur : il valide les
            demandes de rattachement et concède les modules aux organisations.
          </p>
          <p>
            <Link className="sp-btn sp-btn--outline" href="/super-admin/demandes">
              Voir les demandes de rattachement
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
