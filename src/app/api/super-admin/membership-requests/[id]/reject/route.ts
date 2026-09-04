import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { rejectMembershipRequest, rejectionSchema } from '@/lib/services/membership';

const paramsSchema = z.object({ id: z.string().uuid() });

/** Refus motivé d'une demande. Autorisation vérifiée par la fonction SQL. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseWith(rejectionSchema, body.value);
  if (!parsed.ok) return parsed.response;

  const result = await rejectMembershipRequest(
    guarded.context,
    parsedParams.value.id,
    parsed.value.note ?? null,
  );
  if (!result.ok) return mapDbError(result.error, 'membership.reject_failed');

  return jsonOk({ notificationSent: result.value.emailSent });
}
