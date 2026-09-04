import { z } from 'zod';
import { eq } from '@/lib/data/port';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonError, jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';

/**
 * Activation des modules par l'administrateur de l'organisation.
 *
 * Répartition des pouvoirs, imposée par le RLS et non par ce code :
 *   * le super administrateur CONCÈDE un module à une organisation (création
 *     de la ligne dans `organisation_modules`) ;
 *   * l'administrateur de l'organisation l'ACTIVE ou le DÉSACTIVE (colonne
 *     `enabled`). Il ne peut pas s'octroyer un module non concédé.
 */

interface OrganisationModuleRow {
  organisation_id: string;
  module_key: string;
  enabled: boolean;
  granted_at: string;
}

export async function GET(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const granted = await guarded.context.port.select<OrganisationModuleRow>({
    table: 'organisation_modules',
    columns: 'organisation_id, module_key, enabled, granted_at',
    order: { column: 'module_key' },
  });
  if (granted.error) return mapDbError(granted.error, 'modules.list_failed');

  const catalogue = await guarded.context.port.select<{
    key: string;
    name: string;
    description: string;
    is_core: boolean;
  }>({
    table: 'modules',
    columns: 'key, name, description, is_core',
    order: { column: 'sort_order' },
  });
  if (catalogue.error) return mapDbError(catalogue.error, 'modules.catalogue_failed');

  return jsonOk({ catalogue: catalogue.data, granted: granted.data });
}

const patchSchema = z.object({
  moduleKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  enabled: z.boolean(),
});

export async function PATCH(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseWith(patchSchema, body.value);
  if (!parsed.ok) return parsed.response;

  const updated = await guarded.context.port.update<OrganisationModuleRow>(
    'organisation_modules',
    { enabled: parsed.value.enabled },
    [eq('module_key', parsed.value.moduleKey)],
    'organisation_id, module_key, enabled, granted_at',
  );
  if (updated.error) return mapDbError(updated.error, 'modules.update_failed');

  // Aucune ligne touchée : soit le module n'est pas concédé à cette
  // organisation, soit l'appelant n'a pas le droit de l'activer. Dans les deux
  // cas le RLS a filtré la ligne — on ne distingue pas, pour ne pas révéler
  // ce qui existe.
  if (updated.data.length === 0) {
    return jsonError('forbidden', "Ce module n'est pas activable par ce compte.");
  }

  return jsonOk({ module: updated.data[0] });
}
