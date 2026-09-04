import { eq } from '@/lib/data/port';
import { guard } from '@/lib/api/guard';
import { jsonOk, mapDbError } from '@/lib/api/respond';

interface ProfileRow {
  id: string;
  organisation_id: string | null;
  role: string;
  status: string;
  full_name: string | null;
  email: string;
}

interface ModuleEntry {
  key: string;
  name: string;
  description: string;
  isCore: boolean;
  allowed: boolean;
  enabledForOrganisation: boolean;
}

/**
 * Profil du compte connecté, avec ses modules effectivement autorisés.
 * L'interface s'en sert pour n'afficher que ce que le compte peut faire — mais
 * l'affichage n'est qu'un confort : le refus réel vient du RLS.
 */
export async function GET(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;
  const { context } = guarded;

  const profile = await context.port.selectOne<ProfileRow>({
    table: 'profiles',
    columns: 'id, organisation_id, role, status, full_name, email',
    where: [eq('id', context.userId!)],
  });
  if (profile.error) return mapDbError(profile.error, 'me.profile_failed');

  const modules = await context.port.rpc<ModuleEntry[]>('my_modules');
  if (modules.error) return mapDbError(modules.error, 'me.modules_failed');

  let organisation: { id: string; slug: string; name: string; logo_url: string | null } | null =
    null;
  if (profile.data.organisation_id) {
    const result = await context.port.selectOne<{
      id: string;
      slug: string;
      name: string;
      logo_url: string | null;
    }>({
      table: 'organisations',
      columns: 'id, slug, name, logo_url',
      where: [eq('id', profile.data.organisation_id)],
    });
    organisation = result.data;
  }

  return jsonOk({
    profile: {
      id: profile.data.id,
      role: profile.data.role,
      status: profile.data.status,
      fullName: profile.data.full_name,
      email: profile.data.email,
      organisationId: profile.data.organisation_id,
    },
    organisation,
    modules: modules.data ?? [],
  });
}
