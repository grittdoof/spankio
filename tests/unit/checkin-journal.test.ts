import { describe, expect, it } from 'vitest';
import {
  journalActionLabel,
  journalEntries,
  journalSummary,
} from '@/lib/checkin/journal';
import { expandSeats } from '@/lib/checkin/seats';
import type { GuestRow } from '@/lib/survey/guests';
import type { CheckinLogRow } from '@/lib/services/checkin';

/**
 * Le journal de la porte.
 *
 * Ce qu'on fixe ici est surtout un REFUS : ne jamais faire disparaître une
 * transition dont la personne n'est plus identifiable. C'est précisément
 * celle-là qu'on cherche quand un chiffre surprend.
 */

const guests: GuestRow[] = [
  {
    id: 'r1',
    submittedAt: '2026-11-01T10:00:00.000Z',
    name: 'Martin Jean',
    initials: 'MJ',
    detail: 'Spie batignolles',
    companion: 'Martin Jacqueline',
    status: 'attending',
    people: 2,
    ambiguous: false,
  },
];

const seats = expandSeats(guests);

function entry(partial: Partial<CheckinLogRow> = {}): CheckinLogRow {
  return {
    opId: 'op-1',
    responseId: 'r1',
    seat: 0,
    at: '2026-11-18T19:05:00.000Z',
    byProfile: 'p1',
    arrived: true,
    source: 'desk',
    ...partial,
  };
}

const actors = new Map([['p1', 'Camille Roux']]);

describe('journalEntries', () => {
  it('nomme la personne pointée et celle qui a pointé', () => {
    const [row] = journalEntries([entry()], seats, actors);
    expect(row).toMatchObject({
      who: 'Martin Jean',
      by: 'Camille Roux',
      source: 'desk',
      arrived: true,
      isCompanion: false,
    });
  });

  it('distingue le siège de l’accompagnant', () => {
    const [row] = journalEntries([entry({ seat: 1 })], seats, actors);
    expect(row).toMatchObject({ who: 'Martin Jacqueline', isCompanion: true });
  });

  it('GARDE une transition dont la personne n’est plus identifiable', () => {
    // Une inscription corrigée change d'identifiant ; le journal garde
    // l'ancien, parce que c'est bien sous celui-là que le geste a eu lieu.
    // La masquer reviendrait à effacer ce qu'on vient chercher.
    const [row] = journalEntries([entry({ responseId: 'disparue' })], seats, actors);
    expect(row).toMatchObject({ who: null, arrived: true });
  });

  it('n’invente pas un auteur qu’il ne connaît pas', () => {
    const orphan = journalEntries([entry({ byProfile: null })], seats, actors);
    expect(orphan[0]?.by).toBeNull();
    const unknown = journalEntries([entry({ byProfile: 'p-inconnu' })], seats, actors);
    expect(unknown[0]?.by).toBeNull();
  });

  it('respecte l’ordre reçu, sans le retrier', () => {
    // Le service rend déjà du plus récent au plus ancien : retrier ici
    // donnerait deux tris à maintenir, et c'est le plus discret qui
    // finirait par mentir.
    const rows = journalEntries(
      [entry({ opId: 'a' }), entry({ opId: 'b' }), entry({ opId: 'c' })],
      seats,
      actors,
    );
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('journalActionLabel', () => {
  it('écrit ce qui s’est passé, sans compter sur la couleur', () => {
    const [pointe] = journalEntries([entry()], seats, actors);
    const [retire] = journalEntries([entry({ arrived: false })], seats, actors);
    expect(journalActionLabel(pointe!)).toBe('Arrivée pointée');
    expect(journalActionLabel(retire!)).toBe('Arrivée retirée');
  });
});

describe('journalSummary', () => {
  it('compte les gestes, les deux sens, et les auteurs distincts', () => {
    const rows = journalEntries(
      [
        entry({ opId: 'a' }),
        entry({ opId: 'b', arrived: false }),
        entry({ opId: 'c', byProfile: 'p2' }),
      ],
      seats,
      new Map([
        ['p1', 'Camille Roux'],
        ['p2', 'Sacha Lemoine'],
      ]),
    );
    expect(journalSummary(rows)).toEqual({
      total: 3,
      arrivals: 2,
      removals: 1,
      actors: 2,
    });
  });

  it('ne compte pas un auteur inconnu comme une personne', () => {
    const rows = journalEntries([entry({ byProfile: null })], seats, actors);
    expect(journalSummary(rows).actors).toBe(0);
  });
});
