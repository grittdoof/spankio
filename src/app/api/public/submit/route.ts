import { z } from 'zod';
import { guard } from '@/lib/api/guard';
import { readJsonBody, SUBMISSION_MAX_BODY_BYTES } from '@/lib/api/read-json';
import { jsonCreated, jsonError, mapDbError } from '@/lib/api/respond';
import { parseWith } from '@/lib/api/validate';
import { submitPublicResponse } from '@/lib/services/submission';

/**
 * Soumission publique d'une réponse.
 *
 * C'est la surface la plus exposée de la plateforme : ouverte sans compte, sur
 * une URL publique. Les garde-fous s'y empilent volontairement, du moins cher
 * au plus cher :
 *
 *  1. limitation de débit par appelant (empreinte d'IP, jamais l'adresse) ;
 *  2. plafond de taille du corps, vérifié AVANT toute analyse ;
 *  3. forme de la requête ;
 *  4. validation métier contre le schéma du sondage, en liste blanche ;
 *  5. revérification en SQL de ce que le SQL peut prouver.
 *
 * Les erreurs renvoyées sont des codes stables, sans détail interne : le corps
 * d'une réponse d'erreur ne doit rien apprendre sur la structure de la base.
 */

const bodySchema = z.object({
  organisationSlug: z.string().trim().min(1).max(62),
  surveySlug: z.string().trim().min(1).max(82),
  /** Réponses brutes. La validation fine est faite contre le schéma du sondage. */
  data: z.unknown(),
  consentGiven: z.boolean().default(false),
});

export async function POST(request: Request): Promise<Response> {
  const guarded = await guard(request, { rateLimit: 'publicSubmit' });
  if (!guarded.ok) return guarded.response;

  const body = await readJsonBody(request, SUBMISSION_MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = parseWith(bodySchema, body.value);
  if (!parsed.ok) return parsed.response;

  const result = await submitPublicResponse(guarded.context, {
    organisationSlug: parsed.value.organisationSlug,
    surveySlug: parsed.value.surveySlug,
    data: parsed.value.data,
    consentGiven: parsed.value.consentGiven,
  });

  if (!result.ok) {
    // Les erreurs de champ sont renvoyées telles quelles : elles portent sur
    // ce que le répondant a saisi, il doit pouvoir corriger.
    if (result.fields) {
      const fields: Record<string, string> = {};
      for (const error of result.fields) {
        fields[error.field] ??= error.code;
      }
      return jsonError('invalid_input', undefined, { fields });
    }
    return mapDbError(result.error, 'submission.failed');
  }

  return jsonCreated({
    responseId: result.value.responseId,
    surveyId: result.value.surveyId,
    kind: result.value.kind,
  });
}
