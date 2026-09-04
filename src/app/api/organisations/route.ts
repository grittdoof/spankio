import { guard } from '@/lib/api/guard';
import { jsonOk, mapDbError } from '@/lib/api/respond';

interface DirectoryRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
}

/**
 * Annuaire des organisations, pour choisir celle à rejoindre.
 *
 * Réservé aux comptes authentifiés et limité aux colonnes nécessaires au
 * choix : la vue `organisation_directory` n'expose ni coordonnées ni réglages.
 */
export async function GET(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const result = await guarded.context.port.select<DirectoryRow>({
    table: 'organisation_directory',
    columns: 'id, slug, name, logo_url',
    order: { column: 'name' },
    limit: 500,
  });
  if (result.error) return mapDbError(result.error, 'organisations.list_failed');

  return jsonOk({
    organisations: result.data.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      logoUrl: row.logo_url,
    })),
  });
}
