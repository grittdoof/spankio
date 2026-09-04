/**
 * Retour des liens envoyés par courriel.
 *
 * Deux décisions prises après un échec réel en production :
 *
 *  1. **La destination est un segment de chemin choisi dans une liste
 *     fermée**, et non une URL transmise en paramètre. Une URL de retour
 *     paramétrable est à la fois une surface de redirection ouverte et un
 *     casse-tête pour la liste d'autorisations de Supabase — qui compare des
 *     URL entières, chaîne de requête comprise. Ici, l'URL de retour est
 *     fixe et courte : `/auth/callback` ou `/auth/callback/<clé>`.
 *
 *  2. **Les erreurs de Supabase sont traduites, jamais ignorées.** Un lien
 *     périmé renvoie l'utilisateur avec `error_code=otp_expired` ; ne pas le
 *     lire produit une page d'accueil normale sur une URL absconse, et
 *     personne ne comprend ce qui s'est passé.
 */

/**
 * Destinations autorisées après un retour de courriel. Toute autre valeur
 * retombe sur l'espace d'administration : la liste est fermée, donc aucune
 * redirection arbitraire n'est possible, même si le lien est fabriqué.
 */
const DESTINATIONS: Readonly<Record<string, string>> = {
  '': '/admin',
  'nouveau-mot-de-passe': '/nouveau-mot-de-passe',
};

/** Destination interne correspondant aux segments d'URL reçus. */
export function callbackDestination(segments: readonly string[] | undefined): string {
  const key = (segments ?? []).join('/');
  return DESTINATIONS[key] ?? DESTINATIONS[''] ?? '/admin';
}

/** Clé de destination à utiliser dans une URL de retour. */
export const CALLBACK_KEYS = {
  admin: '',
  newPassword: 'nouveau-mot-de-passe',
} as const;

/** URL de retour complète, sans chaîne de requête (facile à autoriser). */
export function callbackUrl(siteUrl: string, key: string): string {
  const base = `${siteUrl.replace(/\/$/, '')}/auth/callback`;
  return key === '' ? base : `${base}/${key}`;
}

/**
 * Codes d'erreur renvoyés par Supabase dans l'URL de retour, traduits en codes
 * d'interface. `error_code` est le plus précis ; `error` sert de repli.
 */
export function callbackErrorCode(
  errorCode: string | null | undefined,
  error: string | null | undefined,
): string | null {
  if (!errorCode && !error) return null;

  switch (errorCode) {
    case 'otp_expired':
      return 'linkExpired';
    case 'validation_failed':
    case 'bad_oauth_state':
      return 'linkInvalid';
    default:
      break;
  }

  // `access_denied` sans code plus précis : le lien a été refusé, souvent
  // parce qu'il avait déjà servi.
  if (error === 'access_denied') return 'linkInvalid';
  return 'sessionExpired';
}
