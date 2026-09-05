import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { Callout } from '@/components/ui/Callout';
import { PageHeader } from '@/components/ui/PageHeader';
import { canWriteSurveys, loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { listSurveys } from '@/lib/services/surveys';

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
 * Deux publics, deux écrans. Un compte non rattaché ne voit pas une interface
 * vide et énigmatique : il voit ce qui lui manque et où le demander. Un compte
 * rattaché voit d'abord la prochaine action utile — un tableau de bord qui
 * n'indique aucune suite laisse chercher.
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

  if (!session.attached) {
    return (
      <div className="sp-rise">
        <PageHeader title={fr.auth.status.pendingTitle} lead={fr.auth.status.pendingBody} />
        <div className="sp-card sp-stack">
          <Callout title="Ce qu’il vous reste à faire">
            Indiquez l’organisation que vous rejoignez et le rôle souhaité. Un
            administrateur de la plateforme valide la demande, puis vous recevez un
            courriel : votre espace s’ouvre à ce moment-là.
          </Callout>
          <p>
            <Link className="sp-btn sp-btn--lg" href="/demande-de-rattachement">
              {fr.auth.membershipRequest.title}
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const surveys = await listSurveys(context);
  const all = surveys.ok ? surveys.value : [];
  const published = all.filter((survey) => survey.status === 'published');
  const drafts = all.filter((survey) => survey.status === 'draft');
  const writable = canWriteSurveys(session);
  const roleLabel =
    fr.auth.roles[session.role as keyof typeof fr.auth.roles] ?? session.role;

  return (
    <div className="sp-rise">
      <PageHeader
        title={session.organisationName ?? fr.platform.name}
        lead={
          all.length === 0
            ? 'Votre espace est prêt. Créez un premier formulaire pour commencer à recueillir des réponses.'
            : 'Retrouvez vos formulaires, suivez les réponses et exportez-les quand vous voulez.'
        }
        meta={<span className="sp-badge sp-badge--accent">{roleLabel}</span>}
        actions={
          writable ? (
            <Link className="sp-btn sp-btn--lg" href="/admin/sondages/nouveau">
              Créer un formulaire
            </Link>
          ) : null
        }
      />

      {all.length === 0 ? (
        <section className="sp-card sp-stack sp-section">
          <h2 className="sp-card__title">Trois étapes, et c’est en ligne</h2>
          <ol className="sp-steps-list">
            <li>
              <strong>Créez le formulaire.</strong> Un parcours guidé vous demande le titre,
              le type, puis les informations à afficher aux répondants.
            </li>
            <li>
              <strong>Ajoutez vos questions.</strong> Onze types de questions, des étapes,
              et des questions qui n’apparaissent que si une réponse précédente le justifie.
            </li>
            <li>
              <strong>Publiez et partagez l’adresse.</strong> Les réponses arrivent dans
              votre tableau de bord, exportables en tableur à tout moment.
            </li>
          </ol>
          {writable ? (
            <p>
              <Link className="sp-btn" href="/admin/sondages/nouveau">
                Commencer
              </Link>
            </p>
          ) : (
            <Callout tone="muted" mark="!" title="Votre rôle est en lecture seule">
              Demandez à un administrateur de votre organisation de vous accorder le rôle
              d’éditeur pour créer des formulaires.
            </Callout>
          )}
        </section>
      ) : (
        <section className="sp-section">
          <div className="sp-stat-grid">
            <div className="sp-stat">
              <span className="sp-stat__value">{all.length}</span>
              <span className="sp-stat__label">
                Formulaire{all.length > 1 ? 's' : ''} au total
              </span>
            </div>
            <div className="sp-stat">
              <span className="sp-stat__value">{published.length}</span>
              <span className="sp-stat__label">
                En ligne, {published.length > 1 ? 'ouverts' : 'ouvert'} aux réponses
              </span>
            </div>
            <div className="sp-stat">
              <span className="sp-stat__value">{drafts.length}</span>
              <span className="sp-stat__label">
                Brouillon{drafts.length > 1 ? 's' : ''} à terminer
              </span>
            </div>
          </div>
          <p style={{ marginTop: 'var(--sp-space-5)' }}>
            <Link className="sp-btn sp-btn--outline" href="/admin/sondages">
              Voir tous les formulaires
            </Link>
          </p>
        </section>
      )}

      <section className="sp-section">
        <h2 className="sp-section__title">Modules autorisés</h2>
        <p className="sp-section__lead">
          Les modules déterminent ce que votre organisation peut créer. Ils sont accordés
          par un administrateur de la plateforme.
        </p>
        <ul className="sp-module-list">
          {session.modules
            .filter((module) => module.allowed)
            .map((module) => (
              <li className="sp-card sp-card--flat" key={module.key}>
                <strong>{module.name}</strong>
                {module.isCore ? (
                  <span className="sp-badge">Toujours actif</span>
                ) : (
                  <span className="sp-badge sp-badge--success">Accordé</span>
                )}
              </li>
            ))}
        </ul>
      </section>

      {session.isPlatformAdmin ? (
        <section className="sp-card sp-stack">
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
        </section>
      ) : null}
    </div>
  );
}
