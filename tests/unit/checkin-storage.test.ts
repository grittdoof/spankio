import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearQueues, loadQueue, saveQueue, QUEUE_TTL_MS } from '@/lib/checkin/storage';
import type { PendingOp } from '@/lib/checkin/reducer';
import { isCheckinOnly } from '@/lib/admin/session';

/**
 * Persistance de la file.
 *
 * Ce qui doit survivre à un verrouillage d'écran : les pointages pas encore
 * confirmés. Ce qui ne doit PAS être sur l'appareil : la liste des invités.
 */

function op(partial: Partial<PendingOp> = {}): PendingOp {
  return {
    opId: 'op-1',
    responseId: 'r1',
    arrived: true,
    peopleIn: null,
    attempts: 0,
    status: 'queued',
    error: null,
    ...partial,
  };
}

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('la file survit, la liste d’invités non', () => {
  it('relit ce qui a été enregistré', () => {
    saveQueue('s1', [op()], 1000);
    expect(loadQueue('s1', 2000)).toEqual([op()]);
  });

  it('ne garde RIEN d’autre que des identifiants et des booléens', () => {
    saveQueue('s1', [op()], 1000);
    const raw = (window as unknown as { localStorage: MemoryStorage }).localStorage.getItem(
      'spk.checkin.queue.s1',
    );
    // Aucune donnée personnelle : pas de nom, pas de courriel. L'instantané de
    // la liste a été écarté exprès — c'est le rôle de la liste imprimée.
    expect(raw).not.toBeNull();
    expect(raw).not.toMatch(/nom|name|mail/i);
  });

  it('abandonne une file trop vieille plutôt que de la rejouer', () => {
    saveQueue('s1', [op()], 1000);
    // Une opération vieille de douze heures ne décrit plus la soirée en cours :
    // la renvoyer ferait rebasculer un invité sans que personne l'ait demandé.
    expect(loadQueue('s1', 1000 + QUEUE_TTL_MS + 1)).toEqual([]);
  });

  it('repose en attente une opération laissée « en vol »', () => {
    saveQueue('s1', [op({ status: 'sending' })], 1000);
    // La laisser en `sending` figerait la file : le vidage refuse de démarrer
    // tant qu'un envoi est en cours.
    expect(loadQueue('s1', 2000)[0]!.status).toBe('queued');
  });

  it('efface la clé quand la file se vide', () => {
    saveQueue('s1', [op()], 1000);
    saveQueue('s1', [], 2000);
    expect(loadQueue('s1', 2000)).toEqual([]);
  });

  it('ne garde rien d’un autre événement après une déconnexion', () => {
    saveQueue('s1', [op()], 1000);
    saveQueue('s2', [op({ opId: 'op-2' })], 1000);
    clearQueues();
    expect(loadQueue('s1', 2000)).toEqual([]);
    expect(loadQueue('s2', 2000)).toEqual([]);
  });

  it('ne fait pas tomber l’écran quand le stockage est refusé', () => {
    // Navigation privée, données de site bloquées, quota plein : l'accesseur
    // LÈVE. Le poste doit continuer, simplement sans survivre à un rechargement.
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('refusé');
      },
    });
    expect(() => saveQueue('s1', [op()])).not.toThrow();
    expect(loadQueue('s1')).toEqual([]);
  });

  it('ne fait pas tomber l’écran sur un contenu corrompu', () => {
    (window as unknown as { localStorage: MemoryStorage }).localStorage.setItem(
      'spk.checkin.queue.s1',
      'ceci n’est pas du JSON',
    );
    expect(loadQueue('s1')).toEqual([]);
  });
});

describe('un compte d’accueil n’a pas d’espace d’administration', () => {
  it('reconnaît le rôle qui n’a que le poste', () => {
    const base = {
      userId: 'u1',
      status: 'active',
      organisationId: 'o1',
      organisationName: 'Org',
      organisationSlug: 'org',
      organisationLogoUrl: null,
      fullName: null,
      attached: true,
      isPlatformAdmin: false,
      modules: [],
    };
    // `attached` est VRAI pour un host — il est bien rattaché. C'est donc le
    // rôle, et lui seul, qui dit qu'il n'a pas d'espace de travail.
    expect(isCheckinOnly({ ...base, role: 'host' })).toBe(true);
    expect(isCheckinOnly({ ...base, role: 'viewer' })).toBe(false);
    expect(isCheckinOnly({ ...base, role: 'admin' })).toBe(false);
    expect(isCheckinOnly(null)).toBe(false);
  });
});
