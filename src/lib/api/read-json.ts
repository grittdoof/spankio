import { jsonError } from './respond';

/**
 * Lecture du corps JSON d'une requête, avec PLAFOND DE TAILLE.
 *
 * Le plafond est appliqué avant l'analyse : lire puis parser un corps de
 * plusieurs mégaoctets pour le rejeter ensuite coûterait exactement ce qu'un
 * attaquant cherche à faire coûter. `Content-Length` est vérifié quand il est
 * présent, et la taille réelle du texte l'est toujours (l'en-tête est fourni
 * par le client, donc il ne prouve rien).
 */

export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
/** Plafond des soumissions publiques, aligné sur celui de la fonction SQL. */
export const SUBMISSION_MAX_BODY_BYTES = 64 * 1024;

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      return { ok: false, response: jsonError('payload_too_large') };
    }
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: jsonError('invalid_input', 'Corps de requête illisible.') };
  }

  // Taille réelle en octets : un caractère non ASCII en pèse plusieurs.
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, response: jsonError('payload_too_large') };
  }

  if (text.trim() === '') {
    return { ok: false, response: jsonError('invalid_input', 'Corps de requête vide.') };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: jsonError('invalid_input', 'JSON invalide.') };
  }
}
