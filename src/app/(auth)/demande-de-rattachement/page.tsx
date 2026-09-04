import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MembershipRequestForm } from '@/components/auth/MembershipRequestForm';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { authErrorMessage, fr } from '@/lib/i18n/fr';
import { submitMembershipRequest } from '../actions';

/**
 * Page dépendante de la session : jamais prérendue. Le marquer explicitement
 * évite que le build tente de la générer statiquement — et rend visible le
 * fait qu'elle est propre à chaque utilisateur.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: fr.auth.membershipRequest.title };

/**
 * Écran de demande de rattachement.
 *
 * La liste des organisations vient de l'annuaire (`organisation_directory`) :
 * le compte n'est encore membre de rien, la table `organisations` lui est donc
 * masquée par le RLS.
 */
export default async function MembershipRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const organisations = await context.port.select<{ id: string; name: string }>({
    table: 'organisation_directory',
    columns: 'id, name',
    order: { column: 'name' },
    limit: 500,
  });

  const pending = await context.port.select<{ id: string }>({
    table: 'membership_requests',
    columns: 'id',
    where: [eq('user_id', context.userId), eq('status', 'pending')],
    limit: 1,
  });

  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;
  const okCode = typeof params['ok'] === 'string' ? params['ok'] : undefined;

  return (
    <MembershipRequestForm
      action={submitMembershipRequest}
      organisations={organisations.data ?? []}
      pending={(pending.data ?? []).length > 0}
      error={authErrorMessage(errorCode)}
      notice={
        okCode === 'envoye'
          ? fr.auth.membershipRequest.sent
          : okCode === 'deja'
            ? fr.auth.membershipRequest.pending
            : null
      }
    />
  );
}
