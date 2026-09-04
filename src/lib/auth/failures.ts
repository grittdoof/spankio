/**
 * Classification des échecs d'authentification.
 *
 * Ce module existe à cause d'un défaut constaté en production : pour ne pas
 * révéler si une adresse est déjà inscrite, l'inscription et la
 * réinitialisation affichaient un message de succès QUEL QUE SOIT l'échec.
 * Le principe est bon, sa portée était trop large — quand le service d'envoi
 * de courriels était saturé, l'écran annonçait « compte créé, ouvrez le
 * message de confirmation » alors que rien n'avait été créé et qu'aucun
 * message ne partirait.
 *
 * La distinction à faire n'est donc pas « échec / succès » mais :
 *
 *  * un refus qui parle du COMPTE (adresse déjà utilisée, identifiants
 *    incorrects) → réponse indifférenciée, sinon on permet d'énumérer les
 *    comptes inscrits ;
 *  * une panne qui parle de la PLATEFORME (quota d'envoi atteint, service
 *    indisponible) → à dire franchement, elle ne renseigne sur personne.
 */

export type AuthFailureKind =
  /** Identifiants refusés, ou adresse déjà utilisée : ne rien révéler. */
  | 'account'
  /** Adresse non confirmée : l'utilisateur doit ouvrir son courriel. */
  | 'unconfirmed'
  /** Trop de tentatives pour cet appelant. */
  | 'rate_limited'
  /** Panne côté plateforme (envoi de courriels saturé, service en erreur). */
  | 'unavailable';

/** Forme minimale d'une erreur `@supabase/supabase-js`. */
export interface AuthFailureLike {
  readonly message: string;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

/**
 * Codes renvoyés par Supabase Auth lorsque l'envoi de courriels est saturé.
 * Le service d'envoi par défaut d'un projet Supabase est bridé à quelques
 * messages par heure : c'est le cas le plus fréquent sur un projet neuf.
 */
const EMAIL_QUOTA_CODES = new Set([
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
  'email_provider_disabled',
  'smtp_send_failed',
]);

const REQUEST_QUOTA_CODES = new Set(['over_request_rate_limit']);

const UNCONFIRMED_CODES = new Set(['email_not_confirmed', 'phone_not_confirmed']);

export function classifyAuthFailure(error: AuthFailureLike): AuthFailureKind {
  const code = error.code ?? '';
  const message = error.message.toLowerCase();

  if (UNCONFIRMED_CODES.has(code) || message.includes('not confirmed')) {
    return 'unconfirmed';
  }

  if (EMAIL_QUOTA_CODES.has(code)) return 'unavailable';
  // Repli sur le message : les codes ne sont pas garantis sur toutes les
  // versions du service, et un quota d'envoi ne doit pas être pris pour un
  // refus de compte.
  if (message.includes('email rate limit') || message.includes('smtp')) {
    return 'unavailable';
  }

  if (REQUEST_QUOTA_CODES.has(code)) return 'rate_limited';
  if (error.status === 429) return 'rate_limited';

  return 'account';
}

/**
 * Code d'erreur d'interface correspondant, ou `null` quand la réponse doit
 * rester indifférenciée pour ne pas permettre d'énumérer les comptes.
 */
export function authErrorCodeFor(kind: AuthFailureKind): string | null {
  switch (kind) {
    case 'unconfirmed':
      return 'emailNotConfirmed';
    case 'rate_limited':
      return 'tooManyAttempts';
    case 'unavailable':
      return 'emailServiceUnavailable';
    case 'account':
      return null;
  }
}
