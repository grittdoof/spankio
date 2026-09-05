import { eq } from '@/lib/data/port';
import { guard } from '@/lib/api/guard';
import { readJsonBody } from '@/lib/api/read-json';
import { jsonCreated, jsonError, jsonOk, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { SURVEY_TEMPLATES } from '@/lib/event/templates';
import { createSurvey, createSurveySchema, listSurveys } from '@/lib/services/surveys';

/**
 * Sondages de l'organisation.
 *
 * Aucune vérification de rôle ici : le RLS filtre la lecture à l'organisation
 * de l'appelant, et refuse l'écriture à qui n'a pas le droit d'écrire des
 * sondages ou n'a pas le module correspondant.
 */

export async function GET(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const surveys = await listSurveys(guarded.context);
  if (!surveys.ok) return mapDbError(surveys.error, 'surveys.list_failed');

  return jsonOk({
    surveys: surveys.value,
    // Les modèles disponibles accompagnent la liste : l'écran de création en
    // a besoin, et une requête de moins vaut mieux qu'une de plus.
    templates: SURVEY_TEMPLATES.map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description,
      kind: template.kind,
      moduleKey: template.moduleKey,
    })),
  });
}

export async function POST(request: Request): Promise<Response> {
  const guarded = await guard(request, { requireSession: true });
  if (!guarded.ok) return guarded.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseWith(createSurveySchema, body.value);
  if (!parsed.ok) return parsed.response;

  // L'organisation vient du profil, jamais de la requête : un client ne peut
  // pas créer un sondage chez un autre tenant.
  const profile = await guarded.context.port.selectOne<{ organisation_id: string | null }>({
    table: 'profiles',
    columns: 'organisation_id',
    where: [eq('id', guarded.context.userId!)],
  });
  if (profile.error) return mapDbError(profile.error, 'surveys.profile_failed');
  if (!profile.data.organisation_id) {
    return jsonError('forbidden', 'Votre compte n’est rattaché à aucune organisation.');
  }

  const created = await createSurvey(
    guarded.context,
    profile.data.organisation_id,
    parsed.value,
  );
  if (!created.ok) return mapDbError(created.error, 'surveys.create_failed');

  return jsonCreated({ survey: created.value });
}
