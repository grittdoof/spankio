import { isInvitationTokenShape } from '@/lib/checkin/invitation';

/**
 * Où l'on atterrit après une connexion réussie.
 *
 * Par défaut `/admin`, qui redirige lui-même un compte d'accueil vers son
 * poste. Deux exceptions, et une seule raison commune : la personne visait un
 * écran PRÉCIS avant d'être arrêtée par la connexion.
 *
 *  * **Le lien d'invitation** ne vaut qu'une fois : quelqu'un qui le suit sans
 *    être connecté le perdrait en passant par l'écran de connexion.
 *  * **Le poste d'un événement** : une hôtesse reçoit le lien de SA soirée.
 *    La renvoyer vers `/admin` la fait atterrir sur le poste de sa PREMIÈRE
 *    affectation — qui n'est pas forcément celle du lien — ou sur un écran de
 *    choix. Pire, quand une autre session traîne sur le téléphone, l'écran
 *    visé ne s'ouvre jamais. Le lien qu'on lui a envoyé doit la mener là.
 *
 * **C'est une liste fermée de DEUX formes, pas une validation d'URL.** Un
 * paramètre de retour est le mécanisme classique de la redirection ouverte :
 * un attaquant envoie `…/connexion?suite=https://ailleurs.test`, la victime se
 * connecte pour de bon, et atterrit sur une page qui imite la nôtre. On ne
 * vérifie donc pas que la destination « a l'air » interne — on vérifie qu'elle
 * est exactement l'une des deux qu'on attend, jeton ou identifiant compris, et
 * la valeur rendue est RECONSTRUITE à partir de ce qu'on a validé.
 */

const DEFAUT = '/admin';
const PREFIXE_INVITATION = '/accueil/invitation?jeton=';
const PREFIXE_POSTE = '/accueil/';

/** Un identifiant d'événement, et rien d'autre : ni chemin, ni requête. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeAfterSignIn(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return DEFAUT;

  if (raw.startsWith(PREFIXE_INVITATION)) {
    // `decodeURIComponent` lève sur un pourcentage isolé — `%zz`. Une adresse
    // malformée est un retour refusé, jamais un écran de connexion en panne :
    // c'est la seule page qui doit marcher quand tout le reste est fermé.
    let token: string;
    try {
      token = decodeURIComponent(raw.slice(PREFIXE_INVITATION.length));
    } catch {
      return DEFAUT;
    }
    if (!isInvitationTokenShape(token)) return DEFAUT;
    return `${PREFIXE_INVITATION}${encodeURIComponent(token)}`;
  }

  if (raw.startsWith(PREFIXE_POSTE)) {
    const id = raw.slice(PREFIXE_POSTE.length);
    if (!UUID.test(id)) return DEFAUT;
    return `${PREFIXE_POSTE}${id.toLowerCase()}`;
  }

  return DEFAUT;
}
