import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIdentifier,
  hashIdentifier,
  rateLimitHeaders,
  resetMemoryLimiter,
} from '@/lib/security/rate-limit';
import { resetLogSink, setLogSink, type LogRecord } from '@/lib/logger';

const store = { url: 'https://kv.exemple.test', token: 'jeton' };

function pipelineResponse(count: number, pttl = 60_000): Response {
  return new Response(
    JSON.stringify([{ result: count }, { result: 1 }, { result: pttl }]),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

let logs: LogRecord[] = [];

beforeEach(() => {
  logs = [];
  setLogSink((record) => logs.push(record));
  resetMemoryLimiter();
});

afterEach(() => {
  resetLogSink();
  vi.restoreAllMocks();
});

describe('empreinte de l’appelant', () => {
  it('ne renvoie jamais l’adresse en clair', async () => {
    const hash = await hashIdentifier('203.0.113.7');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain('203');
  });

  it('est déterministe et distincte par adresse', async () => {
    expect(await hashIdentifier('1.2.3.4')).toBe(await hashIdentifier('1.2.3.4'));
    expect(await hashIdentifier('1.2.3.4')).not.toBe(await hashIdentifier('1.2.3.5'));
  });

  it('prend le premier saut de x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' });
    expect(clientIdentifier(headers)).toBe('203.0.113.7');
  });

  it('retombe sur x-real-ip puis sur une valeur neutre', () => {
    expect(clientIdentifier(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIdentifier(new Headers())).toBe('inconnu');
  });
});

describe('store distribué', () => {
  it('autorise sous la limite et décompte les jetons', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse(1));
    const result = await checkRateLimit('publicSubmit', '1.1.1.1', { store, fetch: fetchMock });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(RATE_LIMITS.publicSubmit.limit);
    expect(result.remaining).toBe(RATE_LIMITS.publicSubmit.limit - 1);
    expect(result.degraded).toBe(false);
  });

  it('refuse au-delà de la limite', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse(6));
    const result = await checkRateLimit('publicSubmit', '1.1.1.1', { store, fetch: fetchMock });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('envoie une empreinte, jamais l’adresse, dans la clé', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse(1));
    await checkRateLimit('auth', '203.0.113.7', { store, fetch: fetchMock });

    const body = String((fetchMock.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).not.toContain('203.0.113.7');
    expect(body).toContain('rl:auth:');
  });

  it('borne la conservation de l’empreinte par un TTL égal à la fenêtre', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse(1));
    await checkRateLimit('erasureRequest', '1.1.1.1', { store, fetch: fetchMock });

    const body = String((fetchMock.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).toContain(`"EXPIRE"`);
    expect(body).toContain(String(RATE_LIMITS.erasureRequest.windowSeconds));
  });
});

describe('panne du store : fail-open assumé + second rideau mémoire', () => {
  it('laisse passer et journalise une erreur', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkRateLimit('publicSubmit', '1.1.1.1', { store, fetch: fetchMock });

    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
    expect(logs.some((l) => l.level === 'error' && l.event === 'ratelimit.store_unreachable')).toBe(
      true,
    );
  });

  it('finit par refuser via le compteur mémoire', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const rule = RATE_LIMITS.publicSubmit;

    for (let i = 0; i < rule.limit; i += 1) {
      const allowed = await checkRateLimit('publicSubmit', '9.9.9.9', { store, fetch: fetchMock });
      expect(allowed.allowed).toBe(true);
    }

    const blocked = await checkRateLimit('publicSubmit', '9.9.9.9', { store, fetch: fetchMock });
    expect(blocked.allowed).toBe(false);
    expect(blocked.degraded).toBe(true);
  });

  it('traite une réponse HTTP en erreur comme une panne', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    const result = await checkRateLimit('auth', '1.1.1.1', { store, fetch: fetchMock });
    expect(result.degraded).toBe(true);
    expect(logs.some((l) => l.event === 'ratelimit.store_unreachable')).toBe(true);
  });

  it('signale l’absence de store configuré', async () => {
    const result = await checkRateLimit('auth', '1.1.1.1', { store: null });
    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
    expect(logs.some((l) => l.level === 'warn' && l.event === 'ratelimit.store_absent')).toBe(true);
  });

  it('remet les compteurs à zéro une fois la fenêtre écoulée', async () => {
    const rule = RATE_LIMITS.membershipRequest;
    let clock = 1_000_000;
    const deps = { store: null, now: () => clock };

    for (let i = 0; i < rule.limit; i += 1) {
      expect((await checkRateLimit('membershipRequest', '8.8.8.8', deps)).allowed).toBe(true);
    }
    expect((await checkRateLimit('membershipRequest', '8.8.8.8', deps)).allowed).toBe(false);

    clock += rule.windowSeconds * 1000 + 1;
    expect((await checkRateLimit('membershipRequest', '8.8.8.8', deps)).allowed).toBe(true);
  });

  it('cloisonne les seaux entre eux', async () => {
    const rule = RATE_LIMITS.membershipRequest;
    for (let i = 0; i < rule.limit + 1; i += 1) {
      await checkRateLimit('membershipRequest', '7.7.7.7', { store: null });
    }
    const other = await checkRateLimit('erasureRequest', '7.7.7.7', { store: null });
    expect(other.allowed).toBe(true);
  });
});

describe('en-têtes de réponse', () => {
  it('expose la limite, le reste et le délai', () => {
    const headers = rateLimitHeaders({
      allowed: true,
      limit: 5,
      remaining: 3,
      resetAt: Date.now() + 30_000,
      degraded: false,
    });
    expect(headers['RateLimit-Limit']).toBe('5');
    expect(headers['RateLimit-Remaining']).toBe('3');
    expect(Number(headers['RateLimit-Reset'])).toBeGreaterThan(0);
    expect(headers['Retry-After']).toBeUndefined();
  });

  it('ajoute Retry-After quand la requête est refusée', () => {
    const headers = rateLimitHeaders({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      degraded: false,
    });
    expect(headers['Retry-After']).toBeDefined();
  });
});
