/**
 * Politique de mot de passe.
 *
 * Ce module distingue deux moments que l'on confond facilement — et que j'ai
 * confondus, jusqu'à ce qu'un compte réel se retrouve inutilisable :
 *
 *  * **Fixer** un mot de passe (inscription, réinitialisation) : c'est là que
 *    la politique de longueur s'applique.
 *  * **Vérifier** un mot de passe (connexion) : on n'exige que d'avoir saisi
 *    quelque chose, et c'est le serveur d'authentification qui tranche.
 *
 * Appliquer la longueur minimale à la connexion rend inutilisable tout compte
 * créé ailleurs — tableau de bord Supabase, import, futur SSO — dont le mot de
 * passe est plus court. L'écran annonce alors « mot de passe incorrect » alors
 * que rien n'est incorrect, et la personne n'a aucun moyen de comprendre.
 */

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Plafond de longueur. Il n'a rien à voir avec la sécurité du mot de passe :
 * il borne le travail de hachage, une entrée de plusieurs mégaoctets étant un
 * vecteur de déni de service.
 */
export const MAX_PASSWORD_LENGTH = 200;

export type PasswordVerdict = 'ok' | 'empty' | 'too_short' | 'too_long';

/** Vérifie un mot de passe que l'on est en train de FIXER. */
export function checkNewPassword(value: string | null | undefined): PasswordVerdict {
  if (value === null || value === undefined || value === '') return 'empty';
  // Longueur en points de code : un mot de passe composé d'emoji ne doit pas
  // compter double.
  const length = [...value].length;
  if (length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (length > MAX_PASSWORD_LENGTH) return 'too_long';
  return 'ok';
}

/**
 * Vérifie un mot de passe SOUMIS à la connexion. Aucune exigence de longueur
 * minimale : la seule question est « y a-t-il quelque chose à vérifier ? ».
 */
export function checkSubmittedPassword(value: string | null | undefined): PasswordVerdict {
  if (value === null || value === undefined || value === '') return 'empty';
  if ([...value].length > MAX_PASSWORD_LENGTH) return 'too_long';
  return 'ok';
}
