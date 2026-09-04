import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonCreated, jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import {
  createMembershipRequest,
  listMembershipRequests,
  membershipRequestSchema,
} from '@/lib/services/membership';

/**
 * Demandes de rattachement — la SEULE voie pour obtenir un rôle admin/editor.
 *
 * En lecture, le RLS décide de ce que l'appelant voit : ses propres demandes,
 * ou toutes s'il est super administrateur. La route ne filtre rien elle-même.
 */

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const url = new URL(request.url);
  const parsed = parseWith(listQuerySchema, {
    ...(url.searchParams.get('status')
      ? { status: url.searchParams.get('status') }
      : {}),
  });
  if (!parsed.ok) return parsed.response;

  const result = await listMembershipRequests(guarded.context, parsed.value);
  if (!result.ok) return mapDbError(result.error, 'membership.list_failed');

  return jsonOk({ requests: result.value });
}

export async function POST(request: Request): Promise<Response> {
  const guarded = await guard(request, {
    requireSession: true,
    rateLimit: 'membershipRequest',
  });
  if (!guarded.ok) return guarded.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseWith(membershipRequestSchema, body.value);
  if (!parsed.ok) return parsed.response;

  const result = await createMembershipRequest(guarded.context, parsed.value);
  if (!result.ok) return mapDbError(result.error, 'membership.create_failed');

  return jsonCreated({
    request: result.value.request,
    // Information, pas erreur : la demande est enregistrée même si l'email
    // n'a pas pu partir.
    notificationSent: result.value.emailSent,
  });
}
