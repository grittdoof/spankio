import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import {
  MembershipDecision,
  type ModuleOption,
  type PendingRequest,
} from '@/components/super-admin/MembershipDecision';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { signOut } from '@/app/(auth)/actions';
import { approve, reject } from './actions';

/**
 * Page dépendante de la session : jamais prérendue. Le marquer explicitement
 * évite que le build tente de la générer statiquement — et rend visible le
 * fait qu'elle est propre à chaque utilisateur.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Demandes de rattachement' };

const NOTICES: Readonly<Record<string, string>> = {
  validee: 'Demande validée. Le compte a été prévenu par courriel.',
  'validee-sans-courriel':
    'Demande validée. Le courriel de décision n’a pas pu être envoyé : le compte a bien les droits accordés.',
  refusee: 'Demande refusée. Le compte a été prévenu par courriel.',
  'refusee-sans-courriel':
    'Demande refusée. Le courriel de décision n’a pas pu être envoyé.',
};

/**
 * File des demandes en attente.
 *
 * Le RLS fait que cette page ne renvoie RIEN à un compte non super
 * administrateur : la liste est vide et aucune action n'aboutit. La barrière
 * n'est pas l'affichage.
 */
export default async function PendingRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const requests = await context.port.select<{
    id: string;
    requester_name: string | null;
    requester_email: string;
    organisation_id: string | null;
    requested_organisation_name: string | null;
    requested_role: string;
    message: string | null;
    created_at: string;
  }>({
    table: 'membership_requests',
    columns:
      'id, requester_name, requester_email, organisation_id, ' +
      'requested_organisation_name, requested_role, message, created_at',
    where: [eq('status', 'pending')],
    order: { column: 'created_at', ascending: true },
    limit: 200,
  });

  const modulesResult = await context.port.select<{
    key: string;
    name: string;
    is_core: boolean;
  }>({
    table: 'modules',
    columns: 'key, name, is_core',
    order: { column: 'sort_order' },
  });

  const modules: ModuleOption[] = (modulesResult.data ?? []).map((module) => ({
    key: module.key,
    name: module.name,
    isCore: module.is_core,
  }));

  // Noms d'organisation résolus via l'annuaire : une seule lecture, et aucune
  // donnée de gestion exposée.
  const directory = await context.port.select<{ id: string; name: string }>({
    table: 'organisation_directory',
    columns: 'id, name',
    limit: 500,
  });
  const namesById = new Map((directory.data ?? []).map((row) => [row.id, row.name]));

  const pending: PendingRequest[] = (requests.data ?? []).map((row) => ({
    id: row.id,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    organisationLabel: row.organisation_id
      ? (namesById.get(row.organisation_id) ?? 'Organisation inconnue')
      : (row.requested_organisation_name ?? 'Organisation à préciser'),
    createsOrganisation: row.organisation_id === null,
    requestedRole: row.requested_role,
    message: row.message,
    createdAt: row.created_at,
  }));

  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;
  const okCode = typeof params['ok'] === 'string' ? params['ok'] : undefined;

  return (
    <main className="sp-container" id="contenu" style={{ paddingBlock: '3rem' }}>
      <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
        <div>
          <h1>Demandes de rattachement</h1>
          <p className="sp-muted">
            Choisissez le rôle et les modules autorisés pour chaque compte.
          </p>
        </div>

        {okCode && NOTICES[okCode] ? <Alert tone="success">{NOTICES[okCode]}</Alert> : null}
        {errorCode ? <Alert tone="error">{fr.errors.unexpected}</Alert> : null}

        {pending.length === 0 ? (
          <div className="sp-card">
            <p className="sp-muted">Aucune demande en attente.</p>
          </div>
        ) : (
          <ul className="sp-list">
            {pending.map((request) => (
              <MembershipDecision
                key={request.id}
                request={request}
                modules={modules}
                approveAction={approve}
                rejectAction={reject}
              />
            ))}
          </ul>
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
