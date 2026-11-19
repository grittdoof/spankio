import { describe, expect, it } from 'vitest';
import type { CheckinState } from '@/lib/checkin/reducer';
import { seatKey } from '@/lib/checkin/seats';
import {
  presenceHeader,
  presenceList,
  presenceRows,
  presenceTime,
} from '@/lib/export/presence';
import type { GuestRow } from '@/lib/survey/guests';

/**
 * La feuille de présence : qui est venu, qui ne l'est pas.
 *
 * Ce que ces tests fixent est surtout ce qu'on refuse de perdre : les refus,
 * qui sont précisément ce qu'on vient chercher ; les accompagnants, qui
 * franchissent la porte eux aussi ; et le fait qu'une absence de pointage se
 * lise « non venu » plutôt que de se deviner.
 */

const TZ = 'Europe/Paris';

function guest(partial: Partial<GuestRow> = {}): GuestRow {
  return {
    id: 'r1',
    submittedAt: '2026-11-01T10:00:00.000Z',
    name: 'Jean Martin',
    initials: 'JM',
    detail: 'ACME',
    companion: null,
    status: 'attending',
    people: 1,
    ambiguous: false,
    walkIn: false,
    ...partial,
  };
}

function state(partial: Partial<CheckinState> & { responseId: string }): CheckinState {
  return {
    seat: 0,
    arrivedAt: null,
    giftAt: null,
    version: 1,
    updatedAt: '2026-11-06T18:00:00.000Z',
    ...partial,
  };
}

describe('presenceList', () => {
  it('donne une ligne par PERSONNE, accompagnants compris', () => {
    const list = presenceList(
      [guest({ people: 2, companion: 'Jacqueline Martin' })],
      [state({ responseId: 'r1', seat: 0, arrivedAt: '2026-11-06T18:02:00.000Z' })],
    );

    expect(list.seats).toHaveLength(2);
    expect(list.seats[0]?.seat.name).toBe('Jean Martin');
    expect(list.seats[0]?.arrivedAt).toBe('2026-11-06T18:02:00.000Z');
    // L'accompagnante n'est pas venue : son siège n'a pas été pointé, et rien
    // dans l'arrivée de son hôte ne dit qu'elle était là.
    expect(list.seats[1]?.seat.name).toBe('Jacqueline Martin');
    expect(list.seats[1]?.arrivedAt).toBeNull();
    expect(list).toMatchObject({ arrived: 1, missing: 1 });
  });

  it('classe de A à Z, le dépliage venant APRÈS', () => {
    const list = presenceList(
      [
        guest({ id: 'r1', name: 'Zoé Durand' }),
        guest({ id: 'r2', name: 'Alice Bernard', people: 2, companion: 'Bob Bernard' }),
      ],
      [],
    );

    // Alice d'abord, et Bob reste collé à Alice : à une porte comme sur un
    // tableur, un couple ne se cherche pas deux fois.
    expect(list.seats.map(({ seat }) => seat.name)).toEqual([
      'Alice Bernard',
      'Bob Bernard',
      'Zoé Durand',
    ]);
  });

  it('garde les refus, que le poste retire de l’écran', () => {
    // C'est l'inverse de `deskRows` : on ne tient pas une porte avec des gens
    // qui ont dit ne pas venir, mais une feuille de présence est faite pour
    // dire qui manque.
    const list = presenceList([guest({ status: 'declined', people: 0 })], []);
    expect(list.seats).toHaveLength(1);
    expect(list.missing).toBe(1);
  });

  it('compte les cadeaux sans les confondre avec une arrivée', () => {
    // Un cadeau remis à quelqu'un que la porte avait oublié reste un cadeau :
    // le rapport le dit, il n'invente pas l'arrivée qui va avec.
    const list = presenceList(
      [guest()],
      [state({ responseId: 'r1', giftAt: '2026-11-06T22:40:00.000Z' })],
    );
    expect(list).toMatchObject({ arrived: 0, missing: 1, gifts: 1 });
  });

  it('ignore un état qui ne désigne aucun siège de la liste', () => {
    // Une correction de réponse change l'identifiant : l'état de l'ancienne
    // ligne ne doit pointer personne plutôt que la première venue.
    const list = presenceList([guest()], [state({ responseId: 'disparu', arrivedAt: '2026-11-06T18:00:00.000Z' })]);
    expect(list.arrived).toBe(0);
    expect(seatKey('r1', 0)).toBe('r1#0');
  });
});

describe('presenceRows', () => {
  const options = { counting: true, timeZone: TZ } as const;

  it('écrit le statut en toutes lettres, jamais une couleur', () => {
    const list = presenceList(
      [
        guest({ id: 'r1', name: 'Alice' }),
        guest({ id: 'r2', name: 'Bruno', status: 'declined' }),
      ],
      [state({ responseId: 'r1', arrivedAt: '2026-11-06T18:02:00.000Z' })],
    );
    const rows = presenceRows(list, options);

    expect(rows[0]).toEqual([
      'Nom',
      'Précision',
      'Annoncé',
      'Présence',
      'Heure d’arrivée',
      'Cadeau remis',
      'Origine',
    ]);
    expect(rows[1]).toEqual(['Alice', 'ACME', 'Présent', 'Venu(e)', '06/11 19:02', '', '']);
    expect(rows[2]).toEqual(['Bruno', 'ACME', 'Décline', 'Non venu(e)', '', '', '']);
  });

  it('dit qu’une personne a été ajoutée à l’entrée', () => {
    // Sans cette mention, son « Sans réponse » passerait pour un oubli de
    // l'organisation plutôt que pour une inscription prise à la porte.
    const list = presenceList(
      [guest({ walkIn: true, status: 'unknown', detail: null, name: 'Chloé' })],
      [state({ responseId: 'r1', arrivedAt: '2026-11-06T19:30:00.000Z' })],
    );
    expect(presenceRows(list, options)[1]).toEqual([
      'Chloé',
      '',
      'Sans réponse',
      'Venu(e)',
      '06/11 20:30',
      '',
      'Ajouté(e) à l’entrée',
    ]);
  });

  it('n’écrit aucun statut annoncé quand la présence n’est pas désignée', () => {
    const list = presenceList([guest()], []);
    expect(presenceHeader({ counting: false, timeZone: TZ })).not.toContain('Annoncé');
    expect(presenceRows(list, { counting: false, timeZone: TZ })[1]).toEqual([
      'Jean Martin',
      'ACME',
      'Non venu(e)',
      '',
      '',
      '',
    ]);
  });

  it('retire la colonne du cadeau pour le papier, jamais pour le fichier', () => {
    const list = presenceList([guest()], []);
    expect(presenceHeader({ ...options, gifts: false })).not.toContain('Cadeau remis');
    expect(presenceRows(list, { ...options, gifts: false })[1]).toHaveLength(6);
    // Le fichier, lui, garde la colonne : les colonnes d'un export dépendent
    // du sondage et jamais des réponses.
    expect(presenceHeader(options)).toContain('Cadeau remis');
    expect(presenceRows(list, options)[1]).toHaveLength(7);
  });
});

describe('presenceTime', () => {
  it('met en forme dans le fuseau DE L’ÉVÉNEMENT', () => {
    // Une soirée à New York annoncée à l'heure de Paris serait fausse de six
    // heures : c'est le défaut déjà corrigé sur la page publique.
    expect(presenceTime('2026-11-06T23:50:00.000Z', 'Europe/Paris')).toBe('07/11 00:50');
    expect(presenceTime('2026-11-06T23:50:00.000Z', 'America/New_York')).toBe('06/11 18:50');
  });

  it('porte le JOUR avec l’heure : une soirée franchit minuit', () => {
    expect(presenceTime('2026-11-06T22:40:00.000Z', TZ)).toBe('06/11 23:40');
  });

  it('reste muet plutôt que faux sur une valeur inexploitable', () => {
    expect(presenceTime(null, TZ)).toBe('');
    expect(presenceTime('pas une date', TZ)).toBe('');
  });
});
