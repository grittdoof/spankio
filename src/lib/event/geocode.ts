/**
 * Géocodage par Nominatim (OpenStreetMap).
 *
 * Ce module est PUR : il compose une requête et interprète une réponse, sans
 * jamais appeler le réseau. L'appel réel vit dans la route
 * `/api/admin/geocode`, qui est le seul point de sortie — le navigateur ne
 * contacte JAMAIS Nominatim directement, pour trois raisons :
 *
 *  1. la politique d'usage d'OSM exige un `User-Agent` identifiant
 *     l'application, qu'un navigateur ne laisse pas choisir ;
 *  2. elle plafonne à une requête par seconde et par application — un plafond
 *     global, qu'aucun navigateur ne peut faire respecter à lui seul ;
 *  3. laisser chaque poste appeler l'API révélerait à un tiers l'adresse IP de
 *     chaque personne qui tape une adresse.
 */

/** Limite de résultats. Au-delà, la liste devient un obstacle, pas une aide. */
export const GEOCODE_RESULT_LIMIT = 5;

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Délai minimal entre deux appels, en millisecondes.
 * Imposé par la politique d'usage de Nominatim : une requête par seconde,
 * pour l'application entière et non par utilisateur.
 */
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

export interface GeocodeQuery {
  readonly query: string;
  /** Langue des libellés retournés. */
  readonly language?: string;
  /** Restriction facultative à des pays (codes ISO 3166-1 alpha-2). */
  readonly countryCodes?: readonly string[];
}

/**
 * URL d'appel. `format=jsonv2` et `addressdetails=0` : on ne demande pas le
 * détail d'adresse, dont on n'a pas l'usage — moins de données reçues d'un
 * tiers, moins de données à ne pas conserver.
 */
export function nominatimUrl(query: GeocodeQuery): string {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set('q', query.query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '0');
  url.searchParams.set('limit', String(GEOCODE_RESULT_LIMIT));
  url.searchParams.set('accept-language', query.language ?? 'fr');
  if (query.countryCodes && query.countryCodes.length > 0) {
    url.searchParams.set('countrycodes', query.countryCodes.join(','));
  }
  return url.toString();
}

/**
 * `User-Agent` conforme à la politique d'usage d'OSM : il identifie
 * l'application et donne un moyen de contact. Sans lui, les requêtes sont
 * refusées — et le faire passer pour un navigateur serait un contournement,
 * pas une solution.
 */
export function nominatimUserAgent(siteUrl: string, override?: string): string {
  if (override && override.trim() !== '') return override.trim();
  let host = siteUrl;
  try {
    host = new URL(siteUrl).origin;
  } catch {
    // URL invalide : on garde la valeur telle quelle plutôt que d'inventer un
    // contact qui n'existe pas.
  }
  return `spankio/1.0 (+${host})`;
}

export interface GeocodeResult {
  /** Libellé affichable, tel que retourné par Nominatim. */
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Type de lieu (`house`, `street`, `city`…), pour information. */
  readonly kind: string | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Normalise la réponse de Nominatim.
 *
 * Une réponse d'un tiers est une entrée non fiable comme une autre : chaque
 * champ est reconstruit, jamais recopié. Une entrée dont la latitude ou la
 * longitude est hors bornes est ÉCARTÉE plutôt que corrigée — une coordonnée
 * inventée placerait un marqueur au mauvais endroit sans que personne ne s'en
 * aperçoive.
 */
export function parseGeocodeResults(payload: unknown): GeocodeResult[] {
  if (!Array.isArray(payload)) return [];

  const results: GeocodeResult[] = [];
  for (const entry of payload as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;

    const label = typeof row['display_name'] === 'string' ? row['display_name'].trim() : '';
    const latitude = toFiniteNumber(row['lat']);
    const longitude = toFiniteNumber(row['lon']);

    if (label === '' || latitude === null || longitude === null) continue;
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) continue;

    results.push({
      label: label.slice(0, 300),
      latitude,
      longitude,
      kind: typeof row['type'] === 'string' ? row['type'].slice(0, 60) : null,
    });

    if (results.length >= GEOCODE_RESULT_LIMIT) break;
  }

  return results;
}

/**
 * Coordonnées arrondies pour l'affichage et le stockage.
 *
 * Six décimales : environ onze centimètres. Au-delà, on afficherait une
 * précision que ni OpenStreetMap ni un marqueur déplacé à la souris n'ont.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
