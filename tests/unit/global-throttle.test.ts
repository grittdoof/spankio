import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetGlobalSlots, reserveGlobalSlot } from '@/lib/security/global-throttle';
import { resetLogSink, setLogSink } from '@/lib/logger';

/**
 * Verrou global d'une seconde.
 *
 * Ce qu'il faut prouver n'est pas qu'il « marche », mais qu'il refuse quand il
 * doit refuser, et que sa dégradation en panne de store est bien celle qui est
 * documentée — pas un fail-closed annoncé et non tenu.
 */

const store = { url: 'https://kv.exemple.test', token: 'jeton' };

afterEach(() => {
  resetGlobalSlots();
  resetLogSink();
  vi.restoreAllMocks();
});

function reply(result: unknown): Response {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('réservation dans le store', () => {
  it('accorde le créneau quand la clé a pu être posée', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(reply('OK')));
    const granted = await reserveGlobalSlot('geocode:test', 1000, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    expect(granted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('utilise SET ... NX EX, qui est atomique côté Redis', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(reply('OK'));
    });
    await reserveGlobalSlot('geocode:test', 1000, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    expect(calls[0]).toBe('https://kv.exemple.test/set/geocode%3Atest/1/NX/EX/1');
  });

  it('refuse quand une autre instance détient déjà le créneau', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(reply(null)));
    const granted = await reserveGlobalSlot('geocode:test', 1000, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    expect(granted).toBe(false);
  });

  it('refuse aussi quand la réponse du store est incompréhensible', async () => {
    // On ne suppose pas avoir le créneau quand on ne comprend pas la réponse :
    // l'erreur penche du côté qui appelle moins.
    const fetchImpl = vi.fn(() => Promise.resolve(reply({ inattendu: true })));
    const granted = await reserveGlobalSlot('geocode:test', 1000, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    expect(granted).toBe(false);
  });
});

describe('garde-fou de l’instance', () => {
  it('refuse un second appel dans l’intervalle sans même interroger le store', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(reply('OK')));
    const deps = {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    };

    expect(await reserveGlobalSlot('geocode:test', 1000, deps)).toBe(true);
    expect(await reserveGlobalSlot('geocode:test', 1000, deps)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rouvre le créneau une fois l’intervalle écoulé', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(reply('OK')));
    const base = { store, fetch: fetchImpl as unknown as typeof fetch };

    expect(await reserveGlobalSlot('geocode:test', 1000, { ...base, now: () => 1_000_000 })).toBe(
      true,
    );
    expect(await reserveGlobalSlot('geocode:test', 1000, { ...base, now: () => 1_000_999 })).toBe(
      false,
    );
    expect(await reserveGlobalSlot('geocode:test', 1000, { ...base, now: () => 1_001_000 })).toBe(
      true,
    );
  });

  it('sépare les clés : deux usages ne se bloquent pas l’un l’autre', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(reply('OK')));
    const deps = { store, fetch: fetchImpl as unknown as typeof fetch, now: () => 1_000_000 };

    expect(await reserveGlobalSlot('a', 1000, deps)).toBe(true);
    expect(await reserveGlobalSlot('b', 1000, deps)).toBe(true);
  });
});

describe('dégradation', () => {
  it('laisse passer sans store configuré, en le signalant', async () => {
    const records: string[] = [];
    setLogSink((record) => records.push(record.event));

    const granted = await reserveGlobalSlot('geocode:test', 1000, {
      store: null,
      now: () => 1_000_000,
    });

    expect(granted).toBe(true);
    expect(records).toContain('throttle.store_absent');
  });

  it('laisse passer si le store est injoignable, mais reste borné par instance', async () => {
    // Comportement DOCUMENTÉ : dégradation, pas fermeture. Chaque instance
    // reste à un appel par intervalle.
    const records: string[] = [];
    setLogSink((record) => records.push(record.event));

    const fetchImpl = vi.fn(() => Promise.reject(new Error('injoignable')));
    const deps = { store, fetch: fetchImpl as unknown as typeof fetch, now: () => 1_000_000 };

    expect(await reserveGlobalSlot('geocode:test', 1000, deps)).toBe(true);
    expect(await reserveGlobalSlot('geocode:test', 1000, deps)).toBe(false);
    expect(records).toContain('throttle.store_unreachable');
  });

  it('traite une réponse HTTP en erreur comme une panne, pas comme un refus', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('nope', { status: 500 })));
    const granted = await reserveGlobalSlot('geocode:test', 1000, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    expect(granted).toBe(true);
  });
});
