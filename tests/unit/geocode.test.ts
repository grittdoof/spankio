import { describe, expect, it } from 'vitest';
import {
  GEOCODE_RESULT_LIMIT,
  NOMINATIM_ENDPOINT,
  NOMINATIM_MIN_INTERVAL_MS,
  isValidLatitude,
  isValidLongitude,
  nominatimUrl,
  nominatimUserAgent,
  parseGeocodeResults,
  roundCoordinate,
} from '@/lib/event/geocode';

describe('composition de la requête', () => {
  it('interroge Nominatim avec la recherche et les bornes attendues', () => {
    const url = new URL(nominatimUrl({ query: '12 rue des Lilas' }));
    expect(`${url.origin}${url.pathname}`).toBe(NOMINATIM_ENDPOINT);
    expect(url.searchParams.get('q')).toBe('12 rue des Lilas');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe(String(GEOCODE_RESULT_LIMIT));
    expect(url.searchParams.get('accept-language')).toBe('fr');
  });

  it('ne demande pas le détail d’adresse, dont on n’a pas l’usage', () => {
    const url = new URL(nominatimUrl({ query: 'Lyon' }));
    expect(url.searchParams.get('addressdetails')).toBe('0');
  });

  it('échappe une recherche contenant des caractères réservés', () => {
    const url = new URL(nominatimUrl({ query: 'rue A&B ?#/' }));
    expect(url.searchParams.get('q')).toBe('rue A&B ?#/');
  });

  it('restreint aux pays demandés quand la liste est fournie', () => {
    const url = new URL(nominatimUrl({ query: 'Lyon', countryCodes: ['fr', 'be'] }));
    expect(url.searchParams.get('countrycodes')).toBe('fr,be');
  });

  it('n’ajoute pas de restriction quand la liste est vide', () => {
    const url = new URL(nominatimUrl({ query: 'Lyon', countryCodes: [] }));
    expect(url.searchParams.has('countrycodes')).toBe(false);
  });
});

describe('identification de l’application', () => {
  it('compose un user-agent identifiant l’application et son adresse', () => {
    expect(nominatimUserAgent('https://exemple.test/quelque/chose')).toBe(
      'spankio/1.0 (+https://exemple.test)',
    );
  });

  it('respecte une valeur imposée par la configuration', () => {
    expect(nominatimUserAgent('https://exemple.test', 'spankio (contact@exemple.test)')).toBe(
      'spankio (contact@exemple.test)',
    );
  });

  it('ignore une valeur imposée vide plutôt que d’envoyer un user-agent vide', () => {
    expect(nominatimUserAgent('https://exemple.test', '   ')).toBe(
      'spankio/1.0 (+https://exemple.test)',
    );
  });

  it('n’invente pas de contact quand l’adresse du site est invalide', () => {
    expect(nominatimUserAgent('pas-une-url')).toBe('spankio/1.0 (+pas-une-url)');
  });
});

describe('lecture de la réponse', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    display_name: '12 Rue des Lilas, Lyon, France',
    lat: '45.764043',
    lon: '4.835659',
    type: 'house',
    ...over,
  });

  it('reconstruit les résultats champ par champ', () => {
    expect(parseGeocodeResults([entry()])).toEqual([
      {
        label: '12 Rue des Lilas, Lyon, France',
        latitude: 45.764043,
        longitude: 4.835659,
        kind: 'house',
      },
    ]);
  });

  it('accepte des coordonnées déjà numériques', () => {
    const [first] = parseGeocodeResults([entry({ lat: 45.5, lon: 4.5 })]);
    expect(first?.latitude).toBe(45.5);
  });

  it.each([
    ['une latitude hors bornes', entry({ lat: '91' })],
    ['une longitude hors bornes', entry({ lon: '181' })],
    ['une latitude illisible', entry({ lat: 'nord' })],
    ['une latitude absente', entry({ lat: undefined })],
    ['un libellé vide', entry({ display_name: '   ' })],
    ['un libellé non textuel', entry({ display_name: 42 })],
  ])('écarte une entrée avec %s au lieu de la corriger', (_label, row) => {
    expect(parseGeocodeResults([row])).toEqual([]);
  });

  it('ignore les entrées qui ne sont pas des objets', () => {
    expect(parseGeocodeResults([null, 'texte', 12, entry()])).toHaveLength(1);
  });

  it('rend une liste vide pour une réponse qui n’est pas un tableau', () => {
    expect(parseGeocodeResults({ error: 'quota' })).toEqual([]);
    expect(parseGeocodeResults(null)).toEqual([]);
    expect(parseGeocodeResults('[]')).toEqual([]);
  });

  it('plafonne le nombre de résultats', () => {
    const many = Array.from({ length: 20 }, () => entry());
    expect(parseGeocodeResults(many)).toHaveLength(GEOCODE_RESULT_LIMIT);
  });

  it('tronque un libellé démesuré au lieu de le stocker entier', () => {
    const [first] = parseGeocodeResults([entry({ display_name: 'a'.repeat(1000) })]);
    expect(first?.label).toHaveLength(300);
  });

  it('accepte un type absent sans inventer de valeur', () => {
    const [first] = parseGeocodeResults([entry({ type: undefined })]);
    expect(first?.kind).toBeNull();
  });
});

describe('bornes et arrondi', () => {
  it.each([
    [-90, true],
    [90, true],
    [0, true],
    [90.1, false],
    [Number.NaN, false],
  ])('latitude %s → %s', (value, expected) => {
    expect(isValidLatitude(value)).toBe(expected);
  });

  it.each([
    [-180, true],
    [180, true],
    [180.5, false],
    [Number.POSITIVE_INFINITY, false],
  ])('longitude %s → %s', (value, expected) => {
    expect(isValidLongitude(value)).toBe(expected);
  });

  it('arrondit à six décimales, soit environ onze centimètres', () => {
    expect(roundCoordinate(45.7640431234)).toBe(45.764043);
    expect(roundCoordinate(-4.8356594999)).toBe(-4.835659);
  });
});

describe('politique d’usage', () => {
  it('fixe l’intervalle minimal à une seconde', () => {
    // La politique d'OpenStreetMap plafonne à une requête par seconde pour
    // l'application entière : la constante ne doit pas dériver en silence.
    expect(NOMINATIM_MIN_INTERVAL_MS).toBe(1000);
  });
});
