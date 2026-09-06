/**
 * Logo d'une organisation : téléversé, ou désigné par un lien.
 *
 * Deux chemins, pour une raison simple : la plupart des organisations ont leur
 * logo dans un fichier, quelques-unes l'ont déjà en ligne sur leur site. Ne
 * proposer que le lien obligerait à trouver où héberger l'image ; ne proposer
 * que le téléversement obligerait à dupliquer une image déjà publiée.
 *
 * Ce module est PUR : il ne téléverse rien et ne connaît ni Supabase ni le
 * réseau. Répartition des rôles, la même que pour les bannières :
 *
 *  * Storage applique `file_size_limit` et `allowed_mime_types`, et le RLS
 *    impose le dossier de l'organisation. Ce sont les SEULS contrôles qui
 *    protègent, parce qu'ils s'exécutent hors du navigateur.
 *  * Les contrôles d'ici refusent tôt, avec un message utile.
 *  * `isLogoUrlOf` sert au SERVEUR : une URL qui désigne notre bucket doit
 *    désigner le dossier de CETTE organisation. Le bucket est public — sans
 *    cette vérification, une organisation pourrait afficher le logo d'une
 *    autre sans jamais rien téléverser.
 */

export const LOGO_BUCKET = 'organisation-logos';

/** Types acceptés. Doit rester aligné sur `allowed_mime_types` du bucket. */
export const LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
] as const;

/** Taille maximale, en octets. Doit rester alignée sur `file_size_limit`. */
export const LOGO_MAX_BYTES = 1024 * 1024;

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type LogoRejection =
  | { readonly code: 'unsupported_type'; readonly message: string }
  | { readonly code: 'too_large'; readonly message: string };

export type LogoCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LogoRejection };

/** Vérification préalable, côté navigateur. Jamais la seule barrière. */
export function checkLogo(file: { type: string; size: number }): LogoCheck {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      reason: {
        code: 'unsupported_type',
        message:
          'Formats acceptés : PNG, JPEG, WebP ou AVIF. Le SVG n’est pas accepté : c’est un document qui peut contenir du code.',
      },
    };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      ok: false,
      reason: {
        code: 'too_large',
        message: `L’image ne doit pas dépasser ${Math.round(LOGO_MAX_BYTES / 1024)} Kio.`,
      },
    };
  }
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_NAME = /^[0-9]{8}T[0-9]{6}-[0-9a-f]{6}\.(png|jpg|webp|avif)$/;

/**
 * Chemin de stockage : `{organisation}/{horodatage}-{aléa}.{ext}`.
 *
 * Le nom d'origine n'est PAS repris : il peut contenir des séparateurs, des
 * caractères de contrôle, ou le nom d'une personne. L'horodatage distingue les
 * versions — remplacer un logo au même chemin le laisserait affiché par les
 * caches pendant des heures — et l'aléa départage deux téléversements de la
 * même seconde.
 */
export function logoPath(
  organisationId: string,
  mimeType: string,
  at: Date,
  nonce: string,
): string | null {
  if (!UUID.test(organisationId)) return null;
  if (!/^[0-9a-f]{6}$/.test(nonce)) return null;
  const extension = EXTENSION_BY_MIME[mimeType];
  if (!extension) return null;
  const stamp = at.toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return `${organisationId}/${stamp}-${nonce}.${extension}`;
}

/** Aléa d'un chemin de logo. Isolé pour que `logoPath` reste pure. */
export function logoNonce(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Préfixe des URL servies par notre bucket de logos. */
function bucketPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${LOGO_BUCKET}/`;
}

/** URL publique d'un logo téléversé. */
export function logoPublicUrl(supabaseUrl: string, path: string): string {
  return `${bucketPrefix(supabaseUrl)}${path}`;
}

/**
 * L'URL désigne-t-elle NOTRE bucket ?
 *
 * Distingue les deux chemins : un lien externe est accepté tel quel, une URL
 * de notre stockage doit être vérifiée.
 */
export function isStoredLogoUrl(url: string, supabaseUrl: string): boolean {
  return url.startsWith(bucketPrefix(supabaseUrl));
}

/**
 * Contrôle SERVEUR d'une URL de logo.
 *
 * Un lien externe passe : c'est le second chemin offert, et il ne désigne rien
 * qui nous appartienne. Une URL de notre bucket doit en revanche pointer vers
 * le dossier de CETTE organisation, et vers un objet dont le nom a bien été
 * composé par `logoPath` — sinon une organisation afficherait le logo d'une
 * autre, ou n'importe quel objet du bucket.
 */
export function isLogoUrlOf(
  url: string,
  organisationId: string,
  supabaseUrl: string,
): boolean {
  if (!isStoredLogoUrl(url, supabaseUrl)) return true;
  if (!UUID.test(organisationId)) return false;

  const path = url.slice(bucketPrefix(supabaseUrl).length);
  const prefix = `${organisationId}/`;
  if (!path.startsWith(prefix)) return false;

  // Un seul segment après le dossier : `a/../b` doit être refusé avant
  // d'atteindre quoi que ce soit, pas normalisé en silence.
  return OBJECT_NAME.test(path.slice(prefix.length));
}
