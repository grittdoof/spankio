import { describe, expect, it } from 'vitest';
import {
  EnvError,
  isEmailConfigured,
  isRateLimitConfigured,
  parsePublicEnv,
  parseServerEnv,
} from '@/lib/config/env';

const validPublic = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SITE_URL: 'https://example.org',
};

const validServer = {
  ...validPublic,
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

describe('parsePublicEnv', () => {
  it('accepte une configuration complète', () => {
    expect(parsePublicEnv(validPublic)).toEqual(validPublic);
  });

  it('rejette une URL invalide en nommant la variable', () => {
    expect(() =>
      parsePublicEnv({ ...validPublic, NEXT_PUBLIC_SUPABASE_URL: 'pas-une-url' }),
    ).toThrowError(EnvError);

    try {
      parsePublicEnv({ ...validPublic, NEXT_PUBLIC_SITE_URL: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as EnvError).missing.join()).toContain('NEXT_PUBLIC_SITE_URL');
    }
  });

  it('rejette une clé anonyme absente', () => {
    const { NEXT_PUBLIC_SUPABASE_ANON_KEY: _omit, ...rest } = validPublic;
    expect(() => parsePublicEnv(rest)).toThrowError(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe('parseServerEnv', () => {
  it('exige la clé de service', () => {
    expect(() => parseServerEnv(validPublic)).toThrowError(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("n'exige aucune intégration optionnelle", () => {
    const env = parseServerEnv(validServer);
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.KV_REST_API_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('valide les intégrations optionnelles quand elles sont fournies', () => {
    expect(() =>
      parseServerEnv({ ...validServer, KV_REST_API_URL: 'nope' }),
    ).toThrowError(/KV_REST_API_URL/);

    const env = parseServerEnv({
      ...validServer,
      KV_REST_API_URL: 'https://kv.upstash.io',
      KV_REST_API_TOKEN: 'token',
      RESEND_API_KEY: 're_123',
      EMAIL_FROM: 'Plateforme <no-reply@example.org>',
    });
    expect(env.EMAIL_FROM).toBe('Plateforme <no-reply@example.org>');
  });
});

describe('détection des intégrations', () => {
  it("considère l'email configuré seulement si clé ET expéditeur sont là", () => {
    expect(isEmailConfigured({})).toBe(false);
    expect(isEmailConfigured({ RESEND_API_KEY: 're_1' })).toBe(false);
    expect(isEmailConfigured({ EMAIL_FROM: 'a@b.c' })).toBe(false);
    expect(isEmailConfigured({ RESEND_API_KEY: 're_1', EMAIL_FROM: 'a@b.c' })).toBe(true);
  });

  it('exige les deux variables KV pour le rate-limit distribué', () => {
    expect(isRateLimitConfigured({})).toBe(false);
    expect(isRateLimitConfigured({ KV_REST_API_URL: 'https://kv' })).toBe(false);
    expect(
      isRateLimitConfigured({ KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 't' }),
    ).toBe(true);
  });
});
