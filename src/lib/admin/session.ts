import { eq } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';

/**
 * Identité applicative de l'appelant dans l'espace d'administration.
 *
 * Ce module ne décide d'AUCUN droit : le RLS filtre déjà les lignes visibles
 * et refuse les écritures interdites. Ce qu'il fournit, c'est de quoi afficher
 * une interface honnête — ne pas proposer un lien vers un module non autorisé
 * vaut mieux que de le proposer et d'échouer ensuite.
 */

export interface AdminModule {
  readonly key: string;
  readonly name: string;
  readonly allowed: boolean;
  readonly isCore: boolean;
}

export interface AdminSession {
  readonly userId: string;
  readonly role: string;
  readonly status: string;
  readonly organisationId: string | null;
  readonly organisationName: string | null;
  /** Segment d'URL publique des formulaires : `/s/<slug>/<sondage>`. */
  readonly organisationSlug: string | null;
  readonly fullName: string | null;
  /** Rattaché ET actif : les deux conditions d'un espace d'organisation. */
  readonly attached: boolean;
  readonly isPlatformAdmin: boolean;
  /** Vide tant que le compte n'est pas rattaché. */
  readonly modules: readonly AdminModule[];
}

interface ProfileRow {
  role: string;
  status: string;
  organisation_id: string | null;
  full_name: string | null;
}

/**
 * `null` si le profil est illisible — un compte tout juste créé dont le
 * déclencheur n'a pas encore tourné, ou une panne. L'appelant décide quoi en
 * faire : une page d'erreur, pas une interface à moitié remplie.
 */
export async function loadAdminSession(
  context: RequestContext,
  userId: string,
): Promise<AdminSession | null> {
  const profile = await context.port.selectOne<ProfileRow>({
    table: 'profiles',
    columns: 'role, status, organisation_id, full_name',
    where: [eq('id', userId)],
  });
  if (profile.error) return null;

  const attached = profile.data.organisation_id !== null && profile.data.status === 'active';

  const organisation =
    attached && profile.data.organisation_id
      ? await context.port.selectOne<{ name: string; slug: string }>({
          table: 'organisations',
          columns: 'name, slug',
          where: [eq('id', profile.data.organisation_id)],
        })
      : null;

  const modules = attached ? await context.port.rpc<AdminModule[]>('my_modules') : null;

  return {
    userId,
    role: profile.data.role,
    status: profile.data.status,
    organisationId: profile.data.organisation_id,
    organisationName: organisation?.data?.name ?? null,
    organisationSlug: organisation?.data?.slug ?? null,
    fullName: profile.data.full_name,
    attached,
    isPlatformAdmin: profile.data.role === 'super_admin',
    modules: modules?.data ?? [],
  };
}

/** Un rôle qui peut écrire des sondages. Le RLS reste seul juge à l'écriture. */
export function canWriteSurveys(session: AdminSession): boolean {
  return session.attached && ['admin', 'editor', 'super_admin'].includes(session.role);
}
