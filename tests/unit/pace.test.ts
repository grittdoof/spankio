import { describe, expect, it } from 'vitest';
import {
  parsePaceWindow,
  recentResponses,
  responsePace,
} from '@/lib/survey/pace';

/**
 * Rythme d'arrivée des réponses.
 *
 * Le sujet réel de ces tests est la FRONTIÈRE DES JOURS. Une réponse envoyée à
 * 23 h 40 heure de Paris tombe le lendemain en UTC : sur un serveur en UTC —
 * ce qu'est Vercel — la colonne du jour serait décalée sans que rien ne le
 * signale.
 */

const at = (iso: string) => ({ submitted_at: iso });

describe('fenêtre', () => {
  it('ne retient que des valeurs connues', () => {
    expect(parsePaceWindow('30j')).toBe('30j');
    expect(parsePaceWindow('7j')).toBe('7j');
    // Une valeur bricolée dans l'URL retombe sur le défaut, elle n'échoue pas.
    expect(parsePaceWindow('365j')).toBe('7j');
    expect(parsePaceWindow(undefined)).toBe('7j');
  });
});

describe('sept jours, jour par jour', () => {
  const now = new Date('2026-09-07T10:00:00Z');

  it('produit sept seaux, le dernier étant aujourd’hui', () => {
    const pace = responsePace([], { now, window: '7j', timeZone: 'Europe/Paris' });
    expect(pace.buckets).toHaveLength(7);
    expect(pace.buckets[0]!.start).toBe('2026-09-01T00:00:00.000Z');
    expect(pace.buckets[6]!.start).toBe('2026-09-07T00:00:00.000Z');
    expect(pace.total).toBe(0);
    expect(pace.busiest).toBeNull();
  });

  it('range chaque réponse dans le jour de son FUSEAU, pas celui d’UTC', () => {
    // 23 h 40 à Paris le 6 septembre = 21 h 40 UTC le 6 : même jour.
    // 00 h 30 à Paris le 7 septembre = 22 h 30 UTC le 6 : jour SUIVANT à Paris.
    const pace = responsePace(
      [at('2026-09-06T21:40:00Z'), at('2026-09-06T22:30:00Z')],
      { now, window: '7j', timeZone: 'Europe/Paris' },
    );
    expect(pace.buckets.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  it('ignore ce qui tombe hors de la fenêtre, et le total le reflète', () => {
    const pace = responsePace(
      [at('2026-08-01T10:00:00Z'), at('2026-09-05T10:00:00Z'), at('2026-12-01T10:00:00Z')],
      { now, window: '7j', timeZone: 'Europe/Paris' },
    );
    expect(pace.total).toBe(1);
  });

  it('ignore un horodatage illisible plutôt que de compter NaN', () => {
    const pace = responsePace([at('pas une date')], {
      now,
      window: '7j',
      timeZone: 'Europe/Paris',
    });
    expect(pace.total).toBe(0);
  });

  it('désigne la période la plus fournie, jamais un seau vide', () => {
    const pace = responsePace(
      [at('2026-09-04T10:00:00Z'), at('2026-09-04T11:00:00Z'), at('2026-09-06T10:00:00Z')],
      { now, window: '7j', timeZone: 'Europe/Paris' },
    );
    expect(pace.busiest?.count).toBe(2);
    expect(pace.busiest?.fullLabel).toBe('4 septembre');
  });

  it('abrège l’étiquette du jour sans point', () => {
    const pace = responsePace([], { now, window: '7j', timeZone: 'Europe/Paris' });
    expect(pace.buckets.map((bucket) => bucket.label)).toEqual([
      'mar',
      'mer',
      'jeu',
      'ven',
      'sam',
      'dim',
      'lun',
    ]);
  });
});

describe('trente jours, cinq jours par seau', () => {
  const now = new Date('2026-09-07T10:00:00Z');

  it('produit six seaux couvrant trente jours', () => {
    const pace = responsePace([], { now, window: '30j', timeZone: 'Europe/Paris' });
    expect(pace.buckets).toHaveLength(6);
    expect(pace.buckets[0]!.start).toBe('2026-08-09T00:00:00.000Z');
    expect(pace.buckets[5]!.start).toBe('2026-09-03T00:00:00.000Z');
  });

  it('regroupe cinq jours dans un même seau', () => {
    const pace = responsePace(
      [at('2026-09-03T10:00:00Z'), at('2026-09-07T10:00:00Z')],
      { now, window: '30j', timeZone: 'Europe/Paris' },
    );
    expect(pace.buckets[5]!.count).toBe(2);
    expect(pace.buckets[5]!.fullLabel).toBe('du 3 septembre au 7 septembre');
  });

  it('étiquette les seaux en jour/mois : « 12 » seul serait ambigu', () => {
    const pace = responsePace([], { now, window: '30j', timeZone: 'Europe/Paris' });
    expect(pace.buckets[0]!.label).toBe('09/08');
  });
});

describe('réponses récentes', () => {
  const now = new Date('2026-09-07T10:00:00Z');

  it('retient les sept derniers jours, bornes comprises', () => {
    const recent = recentResponses(
      [
        at('2026-09-01T00:10:00Z'),
        at('2026-08-31T23:00:00Z'),
        at('2026-09-07T09:00:00Z'),
      ],
      { now, days: 7, timeZone: 'Europe/Paris' },
    );
    // 31 août 23 h UTC = 1er septembre 1 h à Paris : DANS la fenêtre.
    expect(recent).toHaveLength(3);
  });

  it('conserve les objets reçus, pour que l’appelant puisse les recompter', () => {
    const rows = [{ submitted_at: '2026-09-06T10:00:00Z', data: { a: 1 } }];
    expect(recentResponses(rows, { now, days: 7 })[0]).toBe(rows[0]);
  });
});
