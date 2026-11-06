import { z } from '@/lib/config/zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonError, jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { walkinData, walkinFields } from '@/lib/checkin/walkin';
import { addWalkin, deskSettings } from '@/lib/services/checkin';

/**
 * Poste d'accueil : ajouter une personne qui se présente sans inscription.
 *
 * Même seau que le pointage — par UTILISATEUR, pas par IP : six hôtesses
 * derrière le wifi d'une salle n'ont qu'une adresse. Et même porte en base :
 * une fonction qui revérifie les droits, borne le contenu et rend
 * l'opération idempotente.
 *
 * Les questions acceptées sont relues ICI, depuis les désignations de
 * l'organisation : le client ne choisit pas les clés qu'il écrit. Une clé qui
 * n'est pas proposée est ignorée — même règle de liste blanche qu'une
 * soumission publique.
 */

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z.object({
  /** Généré par le client : un réessai après coupure ne crée pas d'homonyme. */
  opId: z.string().uuid(),
  values: z.record(z.string().max(64), z.string().max(400)),
});

/** Trois ou quatre champs courts : jamais plus de quelques centaines d'octets. */
const INVITE_MAX_BODY_BYTES = 4_096;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guard(request, {
    requireSession: true,
    rateLimit: 'checkin',
    rateLimitBy: 'user',
  });
  if (!guarded.ok) return guarded.response;

  const parsedParams = parseWith(paramsSchema, await params);
  if (!parsedParams.ok) return parsedParams.response;

  const body = await readJsonBody(request, INVITE_MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = parseWith(bodySchema, body.value);
  if (!parsed.ok) return parsed.response;

  // Lu sous RLS : un événement que l'appelant ne voit pas est un `404`.
  const desk = await deskSettings(guarded.context, parsedParams.value.id);
  if (!desk.ok) return mapDbError(desk.error, 'checkin.walkin_failed');

  const fields = walkinFields(desk.value.schema, desk.value.attendance);
  const data = walkinData(fields, parsed.value.values);
  if (!data.ok) return jsonError('invalid_input', data.message);

  const added = await addWalkin(guarded.context, {
    surveyId: parsedParams.value.id,
    data: data.data,
    opId: parsed.value.opId,
    schema: desk.value.schema,
    attendance: desk.value.attendance,
  });
  if (!added.ok) return mapDbError(added.error, 'checkin.walkin_failed');

  return jsonOk(added.value);
}
