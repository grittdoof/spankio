import type { z } from 'zod';
import { jsonError } from './respond';

/**
 * Traduit un échec de validation zod en réponse 400 avec les messages par
 * champ, sans jamais renvoyer la valeur reçue (elle pourrait contenir des
 * données personnelles, qui n'ont pas à revenir dans un corps d'erreur).
 */
export function validationErrorResponse(error: z.ZodError): Response {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return jsonError('invalid_input', undefined, { fields });
}

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * Le type de sortie est déduit du schéma (`z.output`) et non de son entrée :
 * sans cela, les valeurs par défaut (`.default([])`) resteraient optionnelles
 * pour l'appelant alors que zod les a déjà remplies.
 */
export function parseWith<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): ParsedBody<z.output<S>> {
  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, response: validationErrorResponse(result.error) };
  }
  return { ok: true, value: result.data as z.output<S> };
}
