/**
 * Le jeton d'une invitation à usage unique.
 *
 * Trois décisions, et la première commande les deux autres.
 *
 * **Le jeton n'existe en clair qu'une fois.** La base n'en garde qu'une
 * empreinte SHA-256, exactement comme la clé anti-doublon : ce qui est stocké
 * ne doit pas suffire à exercer le droit qu'il protège. Conséquence assumée —
 * un lien perdu ne se retrouve pas, il se refait. C'est le comportement de
 * toutes les clés d'API, et il vaut mieux que l'inverse.
 *
 * **Il est produit par `crypto.getRandomValues`**, pas par `Math.random` ni
 * par un identifiant dérivé de l'invitation. Un jeton devinable transformerait
 * le lien en simple formalité.
 *
 * **Il voyage en base64url**, donc sans caractère à échapper dans une URL : un
 * jeton qui se corrompt au copier-coller produit un refus incompréhensible.
 */

/** 32 octets : largement au-delà de ce qu'une recherche exhaustive atteint. */
const TOKEN_BYTES = 32;

/** Durée de vie par défaut d'un lien. Une invitation est périssable. */
export const INVITATION_TTL_DAYS = 7;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateInvitationToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/**
 * Forme acceptable d'un jeton reçu.
 *
 * Ce n'est pas une vérification de droit — la base le fait — mais un refus
 * PRÉCOCE : interroger la base avec les trois caractères d'une URL tronquée ne
 * sert à rien, et un contrôle de forme rend l'écran capable de dire « ce lien
 * est incomplet » plutôt que « lien invalide ».
 */
export function isInvitationTokenShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(value);
}

/** Lien complet, celui qu'on envoie. */
export function invitationLink(siteUrl: string, token: string): string {
  const base = siteUrl.replace(/\/$/, '');
  return `${base}/accueil/invitation?jeton=${encodeURIComponent(token)}`;
}

/**
 * Expiration par défaut du LIEN, distincte de celle de l'affectation.
 *
 * Le lien se consomme avant la soirée ; l'accès à la liste, lui, s'arrête
 * après. Les confondre donnerait soit un lien qui vaut encore un mois plus
 * tard, soit un accès qui tombe pendant le service.
 */
export function defaultInvitationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 3600 * 1000);
}

/** Une adresse se compare en minuscules et sans espaces, des deux côtés. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmailShape(value: string): boolean {
  // Volontairement permissif : la seule vérification qui compte est que le
  // destinataire reçoive le courriel et que son JETON porte cette adresse.
  // Un contrôle strict refuserait des adresses valides et rares.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
