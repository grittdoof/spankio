import { describe, expect, it } from 'vitest';
import {
  BANNER_MAX_BYTES,
  BANNER_MIME_TYPES,
  bannerNonce,
  bannerPath,
  bannerPublicUrl,
  checkBanner,
  isBannerPathOf,
} from '@/lib/event/banner';

const ORG = '11111111-1111-4111-8111-111111111111';
const SURVEY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const AT = new Date('2026-09-05T13:45:12.345Z');

describe('contrôle préalable du fichier', () => {
  it.each(BANNER_MIME_TYPES)('accepte %s', (type) => {
    expect(checkBanner({ type, size: 1024 }).ok).toBe(true);
  });

  it('refuse un SVG, document XML porteur de script', () => {
    const result = checkBanner({ type: 'image/svg+xml', size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe('unsupported_type');
  });

  it.each(['application/pdf', 'text/html', 'application/octet-stream', ''])(
    'refuse %s',
    (type) => {
      expect(checkBanner({ type, size: 1024 }).ok).toBe(false);
    },
  );

  it('accepte exactement la taille maximale et refuse un octet de plus', () => {
    expect(checkBanner({ type: 'image/png', size: BANNER_MAX_BYTES }).ok).toBe(true);
    const result = checkBanner({ type: 'image/png', size: BANNER_MAX_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe('too_large');
  });
});

describe('composition du chemin', () => {
  it('range sous l’organisation puis le sondage', () => {
    const path = bannerPath(ORG, SURVEY, 'image/jpeg', AT, 'abc123');
    expect(path).toBe(`${ORG}/${SURVEY}/20260905T134512-abc123.jpg`);
  });

  it('ignore le nom d’origine et n’utilise que l’extension canonique', () => {
    expect(bannerPath(ORG, SURVEY, 'image/webp', AT, 'abc123')).toMatch(/\.webp$/);
    expect(bannerPath(ORG, SURVEY, 'image/avif', AT, 'abc123')).toMatch(/\.avif$/);
  });

  it('refuse un identifiant qui n’est pas un UUID', () => {
    expect(bannerPath('../autre', SURVEY, 'image/png', AT, 'abc123')).toBeNull();
    expect(bannerPath(ORG, 'pas-un-uuid', 'image/png', AT, 'abc123')).toBeNull();
  });

  it('refuse un type non pris en charge et un aléa mal formé', () => {
    expect(bannerPath(ORG, SURVEY, 'image/svg+xml', AT, 'abc123')).toBeNull();
    expect(bannerPath(ORG, SURVEY, 'image/png', AT, 'XYZ')).toBeNull();
    expect(bannerPath(ORG, SURVEY, 'image/png', AT, '')).toBeNull();
  });

  it('produit un chemin différent à la même seconde', () => {
    // Deux téléversements dans la même seconde ne doivent pas se recouvrir :
    // le second écraserait le premier, et l'aperçu resterait faux en cache.
    const first = bannerPath(ORG, SURVEY, 'image/png', AT, 'aaaaaa');
    const second = bannerPath(ORG, SURVEY, 'image/png', AT, 'bbbbbb');
    expect(first).not.toBe(second);
  });

  it('tire un aléa de six chiffres hexadécimaux', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(bannerNonce()).toMatch(/^[0-9a-f]{6}$/);
    }
  });
});

describe('vérification serveur du chemin', () => {
  const valid = `${ORG}/${SURVEY}/20260905T134512-abc123.jpg`;

  it('accepte le chemin de ce sondage', () => {
    expect(isBannerPathOf(valid, ORG, SURVEY)).toBe(true);
  });

  it('refuse le dossier d’une autre organisation', () => {
    expect(isBannerPathOf(valid, OTHER, SURVEY)).toBe(false);
  });

  it('refuse le dossier d’un autre sondage de la même organisation', () => {
    expect(isBannerPathOf(valid, ORG, OTHER)).toBe(false);
  });

  it.each([
    `${ORG}/${SURVEY}/../${OTHER}/20260905T134512-abc123.jpg`,
    `${ORG}/${SURVEY}/sous/dossier.jpg`,
    `${ORG}/${SURVEY}/quelconque.jpg`,
    `${ORG}/${SURVEY}/20260905T134512-abc123.svg`,
    `${ORG}/${SURVEY}/`,
    `/${ORG}/${SURVEY}/20260905T134512-abc123.jpg`,
  ])('refuse « %s »', (path) => {
    expect(isBannerPathOf(path, ORG, SURVEY)).toBe(false);
  });

  it('refuse tout chemin quand les identifiants sont mal formés', () => {
    expect(isBannerPathOf(valid, 'pas-un-uuid', SURVEY)).toBe(false);
  });

  it('accepte ce que compose bannerPath, pour toute combinaison', () => {
    for (const type of BANNER_MIME_TYPES) {
      const path = bannerPath(ORG, SURVEY, type, AT, bannerNonce());
      expect(path).not.toBeNull();
      expect(isBannerPathOf(path!, ORG, SURVEY)).toBe(true);
    }
  });
});

describe('URL publique', () => {
  it('compose l’URL du bucket sans doubler la barre oblique', () => {
    const path = `${ORG}/${SURVEY}/20260905T134512-abc123.jpg`;
    expect(bannerPublicUrl('https://exemple.supabase.co/', path)).toBe(
      `https://exemple.supabase.co/storage/v1/object/public/survey-banners/${path}`,
    );
    expect(bannerPublicUrl('https://exemple.supabase.co', path)).toBe(
      `https://exemple.supabase.co/storage/v1/object/public/survey-banners/${path}`,
    );
  });
});
