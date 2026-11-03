import { describe, expect, it } from 'vitest';
import {
  expandSeats,
  parseDeskOrder,
  parseSeatKey,
  seatCount,
  seatKey,
  sortGuests,
} from '@/lib/checkin/seats';
import type { GuestRow } from '@/lib/survey/guests';

/**
 * Une ligne par personne.
 *
 * Ce que ces tests fixent, c'est surtout ce qu'on REFUSE de faire : réduire un
 * accompagnant à un chiffre, le nommer d'après son hôte alors que le
 * formulaire demande son nom, et faire dépendre l'identité d'une arrivée de
 * l'ordre d'affichage.
 */

function guest(partial: Partial<GuestRow> = {}): GuestRow {
  return {
    id: 'r1',
    submittedAt: '2026-11-01T10:00:00.000Z',
    name: 'Jean Martin',
    initials: 'JM',
    detail: 'Spie batignolles',
    companion: null,
    status: 'attending',
    people: 1,
    ambiguous: false,
    ...partial,
  };
}

describe('seatCount', () => {
  it('compte au moins la personne inscrite', () => {
    expect(seatCount(guest({ people: 1 }))).toBe(1);
    expect(seatCount(guest({ people: 3 }))).toBe(3);
  });

  it('garde une ligne à qui a décliné', () => {
    // Un invité qui a décliné peut se présenter quand même : le rapport compte
    // précisément ceux-là. Sa ligne doit donc exister pour être pointable.
    expect(seatCount(guest({ people: 0, status: 'declined' }))).toBe(1);
  });
});

describe('expandSeats', () => {
  it('ne déplie rien quand personne n’accompagne', () => {
    const seats = expandSeats([guest()]);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ seat: 0, name: 'Jean Martin', isCompanion: false });
  });

  it('donne à l’accompagnant SON nom et sa précision', () => {
    // Le cas réel : Jean Martin s'inscrit et saisit Jacqueline Martin.
    const seats = expandSeats([guest({ people: 2, companion: 'Jacqueline Martin' })]);
    expect(seats).toHaveLength(2);
    expect(seats[1]).toMatchObject({
      seat: 1,
      name: 'Jacqueline Martin',
      detail: 'accompagnant(e) de Jean Martin',
      isCompanion: true,
    });
  });

  it('prend les initiales du nom de l’accompagnant', () => {
    const seats = expandSeats([guest({ people: 2, companion: 'Jacqueline Martin' })]);
    expect(seats[1]?.initials).toBe('JM');
  });

  it('nomme « Invité » quand le formulaire ne demande rien', () => {
    // La ligne existe quand même : pointable, c'est l'essentiel.
    const seats = expandSeats([guest({ people: 2 })]);
    expect(seats[1]).toMatchObject({
      name: 'Invité',
      detail: 'accompagnant(e) de Jean Martin',
    });
  });

  it('numérote les accompagnants anonymes quand il y en a plusieurs', () => {
    // Trois rangées « Invité » identiques se pointeraient au hasard.
    const seats = expandSeats([guest({ people: 3 })]);
    expect(seats.map((seat) => seat.name)).toEqual(['Jean Martin', 'Invité 1', 'Invité 2']);
  });

  it('ne nomme l’accompagnant désigné qu’une fois', () => {
    // Un formulaire ne demande qu'UN jeu de questions pour l'accompagnant :
    // recopier ce nom sur les sièges suivants inventerait des homonymes.
    const seats = expandSeats([guest({ people: 3, companion: 'Jacqueline Martin' })]);
    expect(seats.map((seat) => seat.name)).toEqual([
      'Jean Martin',
      'Jacqueline Martin',
      'Invité 2',
    ]);
  });

  it('se passe du nom de l’hôte sans inventer', () => {
    const seats = expandSeats([guest({ people: 2, name: null })]);
    expect(seats[1]?.detail).toBe('accompagnant(e)');
  });

  it('ne porte la réserve que sur le siège 0', () => {
    // Trois alertes pour un seul doute feraient trois vérifications.
    const seats = expandSeats([guest({ people: 3, ambiguous: true })]);
    expect(seats.map((seat) => seat.ambiguous)).toEqual([true, false, false]);
  });

  it('hérite du statut annoncé, qui est celui de l’inscription', () => {
    const seats = expandSeats([guest({ people: 2, status: 'declined' })]);
    expect(seats.every((seat) => seat.status === 'declined')).toBe(true);
  });

  it('garde les sièges d’une inscription côte à côte', () => {
    // À une porte, l'hôte et son accompagnant se présentent ensemble.
    const seats = expandSeats([
      guest({ id: 'a', people: 2 }),
      guest({ id: 'b', people: 2 }),
    ]);
    expect(seats.map((seat) => seat.key)).toEqual(['a#0', 'a#1', 'b#0', 'b#1']);
  });

  it('produit des clés uniques', () => {
    const seats = expandSeats([guest({ id: 'a', people: 3 }), guest({ id: 'b', people: 2 })]);
    expect(new Set(seats.map((seat) => seat.key)).size).toBe(seats.length);
  });
});

describe('seatKey / parseSeatKey', () => {
  it('fait l’aller-retour', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(parseSeatKey(seatKey(id, 2))).toEqual({ responseId: id, seat: 2 });
  });

  it('refuse ce qui n’est pas une clé', () => {
    // Une clé forgée arrive par le stockage local : elle ne doit pas lever.
    expect(parseSeatKey('sans-diese')).toBeNull();
    expect(parseSeatKey('#0')).toBeNull();
    expect(parseSeatKey('abc#')).toBeNull();
    expect(parseSeatKey('abc#-1')).toBeNull();
    expect(parseSeatKey('abc#1.5')).toBeNull();
    expect(parseSeatKey('abc#9999')).toBeNull();
  });
});

describe('classement de la liste', () => {
  const rows = [
    guest({ id: 'c', name: 'Zola Émile', detail: 'Ville de Paris', submittedAt: '2026-11-01T10:00:00.000Z' }),
    guest({ id: 'a', name: 'arnaud Bea', detail: 'Spie batignolles', submittedAt: '2026-11-02T10:00:00.000Z' }),
    guest({ id: 'b', name: null, detail: null, submittedAt: '2026-11-03T10:00:00.000Z' }),
  ];

  it('classe par nom, sans tenir compte de la casse ni des accents', () => {
    expect(sortGuests(rows, 'name').map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  it('range les rangées sans nom à la FIN', () => {
    // Une rangée sans nom intercalée au milieu passerait pour un défaut de
    // tri, et on la chercherait là où elle n'est pas.
    expect(sortGuests(rows, 'name').at(-1)?.id).toBe('b');
  });

  it('classe aussi par la précision', () => {
    expect(sortGuests(rows, 'detail').map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  it('rend l’ordre d’inscription quand on le demande', () => {
    expect(sortGuests(rows, 'submitted').map((row) => row.id)).toEqual(['c', 'a', 'b']);
  });

  it('départage les homonymes de façon stable', () => {
    // Deux rangées qui changeraient de place d'un rafraîchissement à l'autre
    // feraient douter de la liste au pire moment.
    const twins = [
      guest({ id: 'tard', name: 'Martin Jean', submittedAt: '2026-11-05T10:00:00.000Z' }),
      guest({ id: 'tot', name: 'Martin Jean', submittedAt: '2026-11-04T10:00:00.000Z' }),
    ];
    expect(sortGuests(twins, 'name').map((row) => row.id)).toEqual(['tot', 'tard']);
  });

  it('ne modifie pas la liste qu’on lui donne', () => {
    const original = [...rows];
    sortGuests(rows, 'name');
    expect(rows).toEqual(original);
  });

  it('garde l’hôte et son accompagnant côte à côte APRÈS classement', () => {
    const seats = expandSeats(
      sortGuests(
        [
          guest({ id: 'z', name: 'Zola Émile', people: 2, companion: 'Zola Alex' }),
          guest({ id: 'a', name: 'Arnaud Bea', people: 2, companion: 'Arnaud Max' }),
        ],
        'name',
      ),
    );
    expect(seats.map((seat) => seat.name)).toEqual([
      'Arnaud Bea',
      'Arnaud Max',
      'Zola Émile',
      'Zola Alex',
    ]);
  });
});

describe('parseDeskOrder', () => {
  it('retombe sur l’alphabétique, qui est le seul défaut raisonnable', () => {
    expect(parseDeskOrder(undefined)).toBe('name');
    expect(parseDeskOrder('n’importe quoi')).toBe('name');
  });

  it('accepte les ordres connus', () => {
    expect(parseDeskOrder('submitted')).toBe('submitted');
    expect(parseDeskOrder('detail')).toBe('detail');
  });
});
