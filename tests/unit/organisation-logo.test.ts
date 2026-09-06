import { describe, expect, it } from 'vitest';
import {
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  checkLogo,
  isLogoUrlOf,
  isStoredLogoUrl,
  logoNonce,
  logoPath,
  logoPublicUrl,
} from '@/lib/organisation/logo';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SUPABASE = 'https://exemple.supabase.co';
const AT = new Date('2026-09-06T09:15:30.500Z');

describe('contrôle préalable du fichier', () => {
  it.each(LOGO_MIME_TYPES)('accepte %s', (type) => {
    expect(checkLogo({ type, size: 4096 }).ok).toBe(true);
  });

  it('refuse un SVG, et dit pourquoi', () => {
    // Un SVG est un document XML pouvant porter du script, et il serait servi
    // depuis une origine publique.
    const result = checkLogo({ type: 'image/svg+xml', size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.code).toBe('unsupported_type');
      expect(result.reason.message).toContain('SVG');
    }
  });

  it.each(['application/pdf', 'text/html', 'image/gif', ''])('refuse %s', (type) => {
    expect(checkLogo({ type, size: 1024 }).ok).toBe(false);
  });

  it('accepte exactement la taille maximale et refuse un octet de plus', () => {
    expect(checkLogo({ type: 'image/png', size: LOGO_MAX_BYTES }).ok).toBe(true);
    const result = checkLogo({ type: 'image/png', size: LOGO_MAX_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe('too_large');
  });
});

describe('composition du chemin', () => {
  it('range sous le dossier de l’organisation', () => {
    expect(logoPath(ORG, 'image/png', AT, 'abc123')).toBe(`${ORG}/20260906T091530-abc123.png`);
  });

  it('n’utilise que l’extension canonique du type', () => {
    expect(logoPath(ORG, 'image/jpeg', AT, 'abc123')).toMatch(/\.jpg$/);
    expect(logoPath(ORG, 'image/webp', AT, 'abc123')).toMatch(/\.webp$/);
  });

  it.each([
    ['un identifiant qui n’est pas un UUID', '../autre', 'image/png', 'abc123'],
    ['un type non pris en charge', ORG, 'image/svg+xml', 'abc123'],
    ['un aléa mal formé', ORG, 'image/png', 'XYZ'],
  ])('refuse %s', (_label, org, type, nonce) => {
    expect(logoPath(org, type, AT, nonce)).toBeNull();
  });

  it('produit un chemin différent à la même seconde', () => {
    expect(logoPath(ORG, 'image/png', AT, 'aaaaaa')).not.toBe(
      logoPath(ORG, 'image/png', AT, 'bbbbbb'),
    );
  });

  it('tire un aléa de six chiffres hexadécimaux', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(logoNonce()).toMatch(/^[0-9a-f]{6}$/);
    }
  });
});

describe('distinction entre lien externe et objet stocké', () => {
  it('reconnaît une URL de notre bucket', () => {
    const url = logoPublicUrl(SUPABASE, `${ORG}/20260906T091530-abc123.png`);
    expect(isStoredLogoUrl(url, SUPABASE)).toBe(true);
  });

  it.each([
    'https://exemple.test/logo.png',
    'https://exemple.supabase.co/storage/v1/object/public/survey-banners/x/y/z.jpg',
    'https://exemple.supabase.co/autre-chemin/logo.png',
  ])('ne prend pas « %s » pour un objet du bucket', (url) => {
    expect(isStoredLogoUrl(url, SUPABASE)).toBe(false);
  });

  it('compose l’URL sans doubler la barre oblique', () => {
    const path = `${ORG}/20260906T091530-abc123.png`;
    expect(logoPublicUrl(`${SUPABASE}/`, path)).toBe(logoPublicUrl(SUPABASE, path));
  });
});

describe('contrôle serveur de l’URL', () => {
  const stored = (org: string, name = '20260906T091530-abc123.png') =>
    logoPublicUrl(SUPABASE, `${org}/${name}`);

  it('accepte l’objet du dossier de cette organisation', () => {
    expect(isLogoUrlOf(stored(ORG), ORG, SUPABASE)).toBe(true);
  });

  it('refuse l’objet d’une AUTRE organisation', () => {
    // Le bucket est public : sans ce contrôle, une organisation afficherait le
    // logo d'une autre sans jamais rien téléverser.
    expect(isLogoUrlOf(stored(OTHER), ORG, SUPABASE)).toBe(false);
  });

  it.each([
    'quelconque.png',
    '../autre.png',
    'sous/dossier.png',
    '20260906T091530-abc123.svg',
    '20260906T091530-ABC123.png',
  ])('refuse le nom d’objet arbitraire « %s »', (name) => {
    expect(isLogoUrlOf(stored(ORG, name), ORG, SUPABASE)).toBe(false);
  });

  it('laisse passer un lien externe : c’est le second chemin offert', () => {
    expect(isLogoUrlOf('https://spie-batignolles.fr/logo.png', ORG, SUPABASE)).toBe(true);
  });

  it('refuse tout objet stocké quand l’identifiant est mal formé', () => {
    expect(isLogoUrlOf(stored(ORG), 'pas-un-uuid', SUPABASE)).toBe(false);
  });

  it('accepte ce que compose logoPath, pour chaque type', () => {
    for (const type of LOGO_MIME_TYPES) {
      const path = logoPath(ORG, type, AT, logoNonce());
      expect(path).not.toBeNull();
      expect(isLogoUrlOf(logoPublicUrl(SUPABASE, path!), ORG, SUPABASE)).toBe(true);
    }
  });
});
