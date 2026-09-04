import { z } from 'zod';
import { eq } from '@/lib/data/port';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonError, jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { ASSIGNABLE_ROLES } from '@/lib/services/membership';

/**
 * Gestion des membres par l'administrateur de l'organisation.
 *
 * Les garde-fous ne sont pas ici : le trigger `guard_profile_privileges`
 * interdit déjà de promouvoir un super administrateur, de déplacer un membre
 * vers une autre organisation ou de se promouvoir soi-même. Cette route se
 * contente de transmettre et de traduire le refus.
 */

interface MemberRow {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export async function GET(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const members = await guarded.context.port.select<MemberRow>({
    table: 'profiles',
    columns: 'id, full_name, email, role, status, created_at',
    order: { column: 'email' },
  });
  if (members.error) return mapDbError(members.error, 'members.list_failed');

  return jsonOk({ members: members.data });
}

const patchSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  moduleOverrides: z
    .array(
      z.object({
        moduleKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        allowed: z.boolean(),
      }),
    )
    .max(20)
    .optional(),
});

export async function PATCH(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseWith(patchSchema, body.value);
  if (!parsed.ok) return parsed.response;
  const { memberId, role, status, moduleOverrides } = parsed.value;

  if (role === undefined && status === undefined && moduleOverrides === undefined) {
    return jsonError('invalid_input', 'Aucune modification demandée.');
  }

  if (role !== undefined || status !== undefined) {
    const updated = await guarded.context.port.update<MemberRow>(
      'profiles',
      {
        ...(role !== undefined ? { role } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      [eq('id', memberId)],
      'id, full_name, email, role, status, created_at',
    );
    if (updated.error) return mapDbError(updated.error, 'members.update_failed');
    if (updated.data.length === 0) {
      return jsonError('forbidden', "Ce membre n'est pas modifiable par ce compte.");
    }
  }

  for (const override of moduleOverrides ?? []) {
    const result = await guarded.context.port.upsert(
      'profile_module_overrides',
      {
        profile_id: memberId,
        module_key: override.moduleKey,
        allowed: override.allowed,
      },
      ['profile_id', 'module_key'],
      'profile_id, module_key, allowed',
    );
    if (result.error) return mapDbError(result.error, 'members.override_failed');
  }

  const refreshed = await guarded.context.port.selectOne<MemberRow>({
    table: 'profiles',
    columns: 'id, full_name, email, role, status, created_at',
    where: [eq('id', memberId)],
  });
  if (refreshed.error) return mapDbError(refreshed.error, 'members.reload_failed');

  return jsonOk({ member: refreshed.data });
}
