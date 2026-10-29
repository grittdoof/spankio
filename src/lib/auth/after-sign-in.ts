import { isInvitationTokenShape } from '@/lib/checkin/invitation';

/**
 * Où l'on atterrit après une connexion réussie.
 *
 * Par défaut `/admin`, qui redirige lui-même un compte d'accueil vers son
 * poste. La seule exception est le lien d'invitation : il ne vaut qu'une fois,
 * et quelqu'un qui le suit sans être connecté le perdrait en passant par
 * l'écran de connexion.
 *
 * **C'est une liste fermée d'UNE forme, pas une validation d'URL.** Un
 * paramètre de retour est le mécanisme classique de la redirection ouverte :
 * un attaquant envoie `…/connexion?suite=https://ailleurs.test`, la victime se
 * connecte pour de bon, et atterrit sur une page qui imite la nôtre. On ne
 * vérifie donc pas que la destination « a l'air » interne — on vérifie qu'elle
 * est exactement celle qu'on attend, jeton compris.
 */

const DEFAUT = '/admin';
const PREFIXE = '/accueil/invitation?jeton=';

export function safeAfterSignIn(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || !raw.startsWith(PREFIXE)) return DEFAUT;

  const token = decodeURIComponent(raw.slice(PREFIXE.length));
  if (!isInvitationTokenShape(token)) return DEFAUT;

  return `${PREFIXE}${encodeURIComponent(token)}`;
}
