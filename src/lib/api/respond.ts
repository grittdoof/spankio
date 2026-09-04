import { logger } from '@/lib/logger';
import type { DbError } from '@/lib/data/port';
import { rateLimitHeaders, type RateLimitResult } from '@/lib/security/rate-limit';

/**
 * Réponses HTTP normalisées.
 *
 * Un client reçoit toujours `{ error: { code, message } }` avec un code stable
 * et un message en français destiné à être affiché. Les détails techniques
 * (SQLSTATE, contrainte violée) partent dans les logs, jamais dans le corps de
 * la réponse : ils renseigneraient un attaquant sur la structure interne.
 */

export type ApiErrorCode =
  | 'invalid_input'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'closed'
  | 'consent_required'
  | 'payload_too_large'
  | 'too_many_requests'
  | 'server_error';

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  closed: 423,
  consent_required: 412,
  payload_too_large: 413,
  too_many_requests: 429,
  server_error: 500,
};

const DEFAULT_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  invalid_input: 'Les données envoyées sont invalides.',
  unauthenticated: 'Vous devez être connecté pour effectuer cette action.',
  forbidden: "Vous n'avez pas les droits nécessaires pour cette action.",
  not_found: 'Ressource introuvable.',
  conflict: 'Cette action a déjà été effectuée.',
  closed: "Ce sondage n'accepte plus de réponses.",
  consent_required: 'Le consentement est nécessaire pour envoyer cette réponse.',
  payload_too_large: 'Les données envoyées sont trop volumineuses.',
  too_many_requests: 'Trop de requêtes. Merci de réessayer dans un instant.',
  server_error: "Une erreur inattendue s'est produite.",
};

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> };
}

export function jsonOk<T>(data: T, headers: Record<string, string> = {}): Response {
  return Response.json(data, {
    status: 200,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

export function jsonCreated<T>(data: T, headers: Record<string, string> = {}): Response {
  return Response.json(data, {
    status: 201,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

export function jsonError(
  code: ApiErrorCode,
  message?: string,
  options: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message: message ?? DEFAULT_MESSAGES[code],
      ...(options.fields ? { fields: options.fields } : {}),
    },
  };
  return Response.json(body, {
    status: STATUS_BY_CODE[code],
    headers: { 'cache-control': 'no-store', ...(options.headers ?? {}) },
  });
}

export function tooManyRequests(result: RateLimitResult): Response {
  return jsonError('too_many_requests', undefined, { headers: rateLimitHeaders(result) });
}

/**
 * Traduit une erreur de base en réponse HTTP.
 *
 * Les SQLSTATE applicatifs `PTxxx` viennent des fonctions du schéma ; les codes
 * PostgreSQL standard (42501 refus RLS, 23505 unicité, 23514 contrainte) sont
 * traduits sans jamais exposer le détail au client.
 */
export function mapDbError(error: DbError, event: string): Response {
  switch (error.code) {
    case 'PT400':
      return jsonError('invalid_input');
    case 'PT403':
    case '42501':
      return jsonError('forbidden');
    case 'PT404':
      return jsonError('not_found');
    case 'PT409':
    case '23505':
      return jsonError('conflict');
    case 'PT412':
      return jsonError('consent_required');
    case 'PT413':
      return jsonError('payload_too_large');
    case 'PT423':
      return jsonError('closed');
    case 'PT429':
      return jsonError('too_many_requests');
    case '23514':
      // Contrainte de table violée : c'est une entrée invalide côté client.
      logger.warn(event, 'Contrainte de table violée.', { code: error.code });
      return jsonError('invalid_input');
    case '23503':
      return jsonError('not_found');
    default:
      logger.error(event, 'Erreur de base non traduite.', {
        code: error.code,
        message: error.message,
      });
      return jsonError('server_error');
  }
}
