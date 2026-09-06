import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { grantModule, revokeModule } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Organisations' };

const NOTICES: Readonly<Record<string, string>> = {
  accorde: 'Module accordé. L’organisation peut désormais l’utiliser.',
  retire: 'Module retiré. Les formulaires existants restent en base mais deviennent inaccessibles à l’organisation.',
};

const ERRORS: Readonly<Record<string, string>> = {
  identifiant: 'Organisation ou module introuvable.',
  concession: 'La concession a été refusée.',
  retrait: 'Le retrait a été refusé.',
};

interface OrganisationRow {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  logo_url: string | null;
  contact_email: string | null;
  created_at: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeZone: 'Europe/Paris',
});

/**
 * Gestion des organisations, réservée à la plateforme.
 *
 * Le RLS fait toute la barrière : `organisations_select` ne renvoie la
 * totalité des lignes qu'à `is_super_admin()`, et les policies de
 * `organisation_modules` réservent la concession au même rôle. Un compte
 * ordinaire qui atteindrait cette URL ne verrait que sa propre organisation et
 * n'aboutirait à aucune écriture — la page n'est pas la barrière.
 *
 * Les comptages sont faits ICI, en mémoire, plutôt que par des agrégats SQL :
 * une vue d'agrégats devrait être exposée à PostgREST et recevoir ses propres
 * droits, pour un gain nul à l'échelle de quelques dizaines d'organisations.
 */
export default async function OrganisationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.isPlatformAdmin) redirect('/admin');

  const [organisations, modules, granted, profiles, surveys] = await Promise.all([
    context.port.select<OrganisationRow>({
      table: 'organisations',
      columns: 'id, slug, name, is_active, logo_url, contact_email, created_at',
      order: { column: 'created_at', ascending: false },
      limit: 500,
    }),
    context.port.select<{ key: string; name: string; is_core: boolean }>({
      table: 'modules',
      columns: 'key, name, is_core',
      order: { column: 'sort_order' },
    }),
    context.port.select<{ organisation_id: string; module_key: string }>({
      table: 'organisation_modules',
      columns: 'organisation_id, module_key',
      limit: 2000,
    }),
    context.port.select<{ organisation_id: string | null; status: string }>({
      table: 'profiles',
      columns: 'organisation_id, status',
      limit: 5000,
    }),
    context.port.select<{ organisation_id: string; status: string }>({
      table: 'surveys',
      columns: 'organisation_id, status',
      limit: 5000,
    }),
  ]);

  if (organisations.error) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  const optional = (modules.data ?? []).filter((module) => !module.is_core);
  const grantedBy = new Map<string, Set<string>>();
  for (const row of granted.data ?? []) {
    const set = grantedBy.get(row.organisation_id) ?? new Set<string>();
    set.add(row.module_key);
    grantedBy.set(row.organisation_id, set);
  }

  const membersBy = new Map<string, number>();
  for (const row of profiles.data ?? []) {
    if (!row.organisation_id || row.status !== 'active') continue;
    membersBy.set(row.organisation_id, (membersBy.get(row.organisation_id) ?? 0) + 1);
  }

  const surveysBy = new Map<string, { total: number; published: number }>();
  for (const row of surveys.data ?? []) {
    const entry = surveysBy.get(row.organisation_id) ?? { total: 0, published: 0 };
    entry.total += 1;
    if (row.status === 'published') entry.published += 1;
    surveysBy.set(row.organisation_id, entry);
  }

  const okCode = typeof params['ok'] === 'string' ? params['ok'] : undefined;
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;

  return (
    <div className="sp-rise">
      <PageHeader
        title="Organisations"
        lead="Chaque organisation a son espace, ses membres et ses modules. Vous décidez de ce qu’elle a le droit d’utiliser ; son administrateur décide de ce qu’il active."
        crumbs={[{ label: 'Plateforme', href: '/super-admin/demandes' }]}
        meta={
          <span className="sp-badge sp-badge--accent">
            {organisations.data.length} organisation
            {organisations.data.length > 1 ? 's' : ''}
          </span>
        }
        actions={
          <Link className="sp-btn sp-btn--outline" href="/super-admin/demandes">
            Demandes de rattachement
          </Link>
        }
      />

      {okCode && NOTICES[okCode] ? <Alert tone="success">{NOTICES[okCode]}</Alert> : null}
      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      {organisations.data.length === 0 ? (
        <EmptyState
          title="Aucune organisation"
          lead="Les organisations naissent d’une demande de rattachement validée. Aucune ne peut être créée depuis l’application par un autre chemin."
          action={
            <Link className="sp-btn" href="/super-admin/demandes">
              Voir les demandes
            </Link>
          }
        />
      ) : (
        <ul className="sp-survey-list">
          {organisations.data.map((organisation) => {
            const counts = surveysBy.get(organisation.id) ?? { total: 0, published: 0 };
            const members = membersBy.get(organisation.id) ?? 0;
            const has = grantedBy.get(organisation.id) ?? new Set<string>();

            return (
              <li className="sp-card" key={organisation.id}>
                <div className="sp-survey-row">
                  <div className="sp-survey-row__main">
                    <h2 className="sp-card__title">{organisation.name}</h2>
                    <p className="sp-survey-row__badges">
                      {organisation.is_active ? (
                        <span className="sp-badge sp-badge--success">Active</span>
                      ) : (
                        <span className="sp-badge sp-badge--danger">Désactivée</span>
                      )}
                      {!organisation.contact_email ? (
                        <span className="sp-badge sp-badge--warning">Profil incomplet</span>
                      ) : null}
                    </p>
                    <p className="sp-survey-row__hint">
                      {members} membre{members > 1 ? 's' : ''} · {counts.total} formulaire
                      {counts.total > 1 ? 's' : ''} dont {counts.published} en ligne · créée
                      le {DATE_FORMAT.format(new Date(organisation.created_at))}
                    </p>
                    <p className="sp-survey-row__url">/s/{organisation.slug}</p>
                  </div>

                  <div className="sp-actions">
                    {optional.map((module) => {
                      const allowed = has.has(module.key);
                      return (
                        <form
                          action={allowed ? revokeModule : grantModule}
                          key={`${organisation.id}-${module.key}`}
                        >
                          <input name="organisationId" type="hidden" value={organisation.id} />
                          <input name="moduleKey" type="hidden" value={module.key} />
                          <button
                            className={`sp-btn sp-btn--sm ${
                              allowed ? 'sp-btn--ghost sp-btn--danger-text' : 'sp-btn--outline'
                            }`}
                            type="submit"
                          >
                            {allowed ? `Retirer ${module.name}` : `Accorder ${module.name}`}
                          </button>
                        </form>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
