/**
 * Bannière d'un événement : contraintes et chemin de stockage.
 *
 * Ce module est PUR : il ne téléverse rien et ne connaît ni Supabase ni le
 * réseau. Il décrit ce qui est acceptable, et le navigateur comme le serveur
 * s'y réfèrent — mais aucun des deux ne s'y fie seul.
 *
 * Répartition des rôles, importante à ne pas confondre :
 *
 *  * Storage applique `file_size_limit` et `allowed_mime_types` sur le bucket,
 *    et le RLS impose le dossier de l'organisation. Ce sont les SEULS contrôles
 *    qui protègent réellement, parce qu'ils s'exécutent hors du navigateur.
 *  * Les contrôles d'ici servent à refuser tôt, avec un message utile, plutôt
 *    qu'à laisser partir trois mégaoctets pour recevoir une erreur opaque.
 *  * `isBannerPathOf` sert au serveur : il vérifie qu'un chemin reçu désigne
 *    bien le dossier de CE sondage, dans CETTE organisation. Sans lui, un
 *    compte pourrait faire pointer sa bannière vers le fichier d'un autre
 *    tenant — le bucket est public, donc rien ne l'en empêcherait.
 */

/** Types acceptés. Doit rester aligné sur `allowed_mime_types` du bucket. */
export const BANNER_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

/**
 * Format de référence des visuels, tel que fourni par le client
 * (1200 × 704 pixels, soit un rapport d'environ 1,70:1).
 *
 * Il n'est pas IMPOSÉ : une image d'un autre rapport est acceptée et recadrée
 * au centre. Il est ANNONCÉ, pour que l'organisation puisse fournir une image
 * qui s'affichera entière — ce que ni un recadrage automatique ni un message
 * d'erreur ne remplacent.
 */
export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 704;
export const BANNER_ASPECT_LABEL = `${BANNER_WIDTH} × ${BANNER_HEIGHT} pixels`;

/** Taille maximale, en octets. Doit rester alignée sur `file_size_limit`. */
export const BANNER_MAX_BYTES = 3 * 1024 * 1024;

/** Extension canonique par type, pour ne pas se fier au nom d'origine. */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type BannerRejection =
  | { readonly code: 'unsupported_type'; readonly message: string }
  | { readonly code: 'too_large'; readonly message: string };

export type BannerCheck = { readonly ok: true } | { readonly ok: false; readonly reason: BannerRejection };

/** Vérification préalable, côté navigateur. Jamais la seule barrière. */
export function checkBanner(file: { type: string; size: number }): BannerCheck {
  if (!(BANNER_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      reason: {
        code: 'unsupported_type',
        message: 'Formats acceptés : JPEG, PNG, WebP ou AVIF.',
      },
    };
  }
  if (file.size > BANNER_MAX_BYTES) {
    return {
      ok: false,
      reason: {
        code: 'too_large',
        message: `L’image ne doit pas dépasser ${Math.round(BANNER_MAX_BYTES / (1024 * 1024))} Mio.`,
      },
    };
  }
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Chemin de stockage : `{organisation}/{sondage}/{horodatage}-{alea}.{ext}`.
 *
 * Le nom d'origine n'est PAS repris : il peut contenir n'importe quoi (des
 * séparateurs, des caractères de contrôle, le nom d'une personne). L'horodatage
 * distingue les versions successives — remplacer une bannière ne réutilise
 * jamais le même chemin, sinon l'ancienne image resterait affichée par les
 * caches pendant des heures. L'aléa départage deux téléversements de la même
 * seconde, qu'une horloge à la seconde confondrait.
 *
 * `nonce` est un paramètre plutôt qu'un tirage interne : cette fonction reste
 * pure, donc testable sans figer le générateur aléatoire.
 */
export function bannerPath(
  organisationId: string,
  surveyId: string,
  mimeType: string,
  at: Date,
  nonce: string,
): string | null {
  if (!UUID.test(organisationId) || !UUID.test(surveyId)) return null;
  if (!/^[0-9a-f]{6}$/.test(nonce)) return null;
  const extension = EXTENSION_BY_MIME[mimeType];
  if (!extension) return null;
  const stamp = at.toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return `${organisationId}/${surveyId}/${stamp}-${nonce}.${extension}`;
}

/** Aléa d'un chemin de bannière. Isolé pour que `bannerPath` reste pure. */
export function bannerNonce(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Le chemin désigne-t-il bien le dossier de ce sondage ?
 *
 * Contrôle SERVEUR. Le RLS de Storage empêche d'ÉCRIRE hors de son
 * organisation, mais rien n'empêcherait d'enregistrer dans `surveys` un chemin
 * pointant ailleurs : le bucket est public, l'image s'afficherait, et une
 * organisation illustrerait sa page avec le fichier d'une autre.
 */
export function isBannerPathOf(
  path: string,
  organisationId: string,
  surveyId: string,
): boolean {
  if (!UUID.test(organisationId) || !UUID.test(surveyId)) return false;
  const prefix = `${organisationId}/${surveyId}/`;
  if (!path.startsWith(prefix)) return false;

  const name = path.slice(prefix.length);
  // Un seul segment, sans remontée de dossier ni séparateur : `a/../b` doit
  // être refusé avant d'atteindre Storage, pas normalisé en silence.
  return /^[0-9]{8}T[0-9]{6}-[0-9a-f]{6}\.(jpg|png|webp|avif)$/.test(name);
}

/** URL publique d'une bannière, dérivée de l'URL du projet Supabase. */
export function bannerPublicUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/survey-banners/${path}`;
}
