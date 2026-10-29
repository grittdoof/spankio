import { describe, expect, it } from 'vitest';
import {
  deskReducer,
  expectedVersionOf,
  nextOp,
  retryDelay,
  EMPTY_DESK,
  RETRY_MAX_MS,
  type CheckinState,
  type DeskState,
} from '@/lib/checkin/reducer';
import { deskList, deskStatusLabel } from '@/lib/checkin/rows';
import { freshness, STALE_AFTER_MS } from '@/lib/checkin/freshness';
import type { GuestRow } from '@/lib/survey/guests';

/**
 * Le réducteur du poste d'accueil.
 *
 * C'est lui qui décide ce qu'une hôtesse voit, debout, à l'entrée d'une salle.
 * Il est pur exactement pour pouvoir être mis en défaut ici plutôt que ce
 * soir-là.
 */

function guest(partial: Partial<GuestRow> & { id: string }): GuestRow {
  return {
    submittedAt: '2026-11-18T18:00:00.000Z',
    name: `Invité ${partial.id}`,
    initials: 'IN',
    detail: null,
    status: 'attending',
    people: 1,
    ambiguous: false,
    ...partial,
  };
}

function serverState(partial: Partial<CheckinState> & { responseId: string }): CheckinState {
  return {
    arrivedAt: null,
    peopleIn: null,
    version: 1,
    updatedAt: '2026-11-18T19:00:00.000Z',
    ...partial,
  };
}

function tap(state: DeskState, responseId: string, arrived: boolean, opId = 'op-1'): DeskState {
  return deskReducer(state, { type: 'tap', opId, responseId, arrived, peopleIn: null });
}

describe('ce que le geste fait AVANT le réseau', () => {
  it('verdit la rangée au doigt, sans attendre le serveur', () => {
    const after = tap(EMPTY_DESK, 'r1', true);
    const { rows } = deskList([guest({ id: 'r1' })], after);

    expect(rows[0]!.arrived).toBe(true);
    expect(rows[0]!.pending).toBe(true);
    expect(deskStatusLabel(rows[0]!)).toBe('Arrivé — envoi en cours');
  });

  it("compte la personne dans la salle dès le geste, pas à la confirmation", () => {
    const after = tap(EMPTY_DESK, 'r1', true);
    expect(deskList([guest({ id: 'r1' })], after).totals.inRoom).toBe(1);
  });

  it('retient l’effectif ANNONCÉ tant que personne ne l’a corrigé', () => {
    const after = tap(EMPTY_DESK, 'r1', true);
    const { totals } = deskList([guest({ id: 'r1', people: 3 })], after);

    // Trois personnes annoncées, non démenties : trois dans la salle. Retenir
    // une seule ferait disparaître deux personnes présentes ; inventer un
    // chiffre serait pire encore.
    expect(totals.inRoom).toBe(3);
    expect(totals.corrected).toBe(0);
  });
});

describe('ce qu’un refus fait, et ce qu’il ne fait pas', () => {
  it('rend la rangée à l’état serveur, avec son message', () => {
    const hydrated = deskReducer(EMPTY_DESK, {
      type: 'hydrate',
      states: [serverState({ responseId: 'r1' })],
      at: 1000,
    });
    const tapped = tap(hydrated, 'r1', true);
    const refused = deskReducer(tapped, {
      type: 'refused',
      opId: 'op-1',
      message: 'Un autre poste vient de modifier cette rangée.',
    });

    const row = deskList([guest({ id: 'r1' })], refused).rows[0]!;
    // La rangée REVIENT à l'absence : laisser le vert afficherait un présent
    // qui n'en est pas un, et c'est ce chiffre qu'on viendra chercher.
    expect(row.arrived).toBe(false);
    expect(row.pending).toBe(false);
    expect(row.refused?.message).toContain('autre poste');
  });

  it('ne disparaît pas tout seul : il faut l’avoir lu', () => {
    const refused = deskReducer(tap(EMPTY_DESK, 'r1', true), {
      type: 'refused',
      opId: 'op-1',
      message: 'Refusé',
    });
    expect(deskList([guest({ id: 'r1' })], refused).totals.refused).toBe(1);

    const dismissed = deskReducer(refused, { type: 'dismiss', opId: 'op-1' });
    expect(deskList([guest({ id: 'r1' })], dismissed).totals.refused).toBe(0);
  });

  it('est remplacé dès qu’on reprend la main sur la même rangée', () => {
    const refused = deskReducer(tap(EMPTY_DESK, 'r1', true), {
      type: 'refused',
      opId: 'op-1',
      message: 'Refusé',
    });
    const again = tap(refused, 'r1', true, 'op-2');

    // Un seul élément en file : le refus périmé n'a plus d'objet, et deux
    // messages contradictoires sur la même rangée seraient illisibles.
    expect(again.queue).toHaveLength(1);
    expect(again.queue[0]!.opId).toBe('op-2');
  });
});

describe('la file, et l’ordre dans lequel elle part', () => {
  it('n’envoie qu’une opération à la fois', () => {
    const two = tap(tap(EMPTY_DESK, 'r1', true, 'op-1'), 'r2', true, 'op-2');
    const sending = deskReducer(two, { type: 'sending', opId: 'op-1' });

    // Tant qu'une opération est en vol, aucune autre ne part : deux pointages
    // concurrents sur la même rangée annonceraient une version déjà périmée.
    expect(nextOp(sending)).toBeNull();
  });

  it('reprend la suivante une fois la précédente appliquée', () => {
    const two = tap(tap(EMPTY_DESK, 'r1', true, 'op-1'), 'r2', true, 'op-2');
    const sending = deskReducer(two, { type: 'sending', opId: 'op-1' });
    const applied = deskReducer(sending, {
      type: 'applied',
      opId: 'op-1',
      state: serverState({ responseId: 'r1', arrivedAt: '2026-11-18T19:05:00.000Z' }),
    });

    expect(nextOp(applied)?.opId).toBe('op-2');
    // L'opération appliquée QUITTE la file : la garder la ferait grossir
    // toute la soirée.
    expect(applied.queue).toHaveLength(1);
  });

  it('lit la version à l’ENVOI, ce qui rend un double appui possible', () => {
    const hydrated = deskReducer(EMPTY_DESK, {
      type: 'hydrate',
      states: [serverState({ responseId: 'r1', version: 0 })],
      at: 1000,
    });
    expect(expectedVersionOf(hydrated, 'r1')).toBe(0);

    const applied = deskReducer(hydrated, {
      type: 'applied',
      opId: 'op-1',
      state: serverState({ responseId: 'r1', version: 1, arrivedAt: '2026-11-18T19:05:00.000Z' }),
    });

    // Le second appui annoncera 1, pas 0 : une version figée au doigt ferait
    // échouer en PT409 un simple « présent puis absent ».
    expect(expectedVersionOf(applied, 'r1')).toBe(1);
  });

  it('annonce 0 pour une rangée que personne n’a jamais touchée', () => {
    expect(expectedVersionOf(EMPTY_DESK, 'inconnue')).toBe(0);
  });

  it('espace les reprises, et plafonne', () => {
    expect(retryDelay(0)).toBe(0);
    expect(retryDelay(1)).toBe(1000);
    expect(retryDelay(3)).toBe(4000);
    expect(retryDelay(50)).toBe(RETRY_MAX_MS);
  });
});

describe('le delta ne peut pas faire reculer la liste', () => {
  it('ignore une version plus ancienne que celle déjà connue', () => {
    const hydrated = deskReducer(EMPTY_DESK, {
      type: 'hydrate',
      states: [
        serverState({ responseId: 'r1', version: 5, arrivedAt: '2026-11-18T19:05:00.000Z' }),
      ],
      at: 1000,
    });

    // Le delta et la réponse d'une écriture se croisent : la plus récente des
    // deux gagne, sinon une arrivée confirmée clignoterait en absence.
    const stale = deskReducer(hydrated, {
      type: 'delta',
      states: [serverState({ responseId: 'r1', version: 2, arrivedAt: null })],
      at: 2000,
    });

    expect(deskList([guest({ id: 'r1' })], stale).rows[0]!.arrived).toBe(true);
  });

  it('avance le curseur sur le plus grand horodatage reçu', () => {
    const after = deskReducer(EMPTY_DESK, {
      type: 'delta',
      states: [
        serverState({ responseId: 'r1', updatedAt: '2026-11-18T19:01:00.000Z' }),
        serverState({ responseId: 'r2', updatedAt: '2026-11-18T19:07:00.000Z' }),
      ],
      at: 2000,
    });
    expect(after.cursor).toBe('2026-11-18T19:07:00.000Z');
  });
});

describe('les totaux que l’écran affiche', () => {
  const guests = [
    guest({ id: 'r1', people: 2 }),
    guest({ id: 'r2' }),
    guest({ id: 'r3', status: 'declined' }),
    guest({ id: 'r4', status: 'unknown' }),
  ];

  it('n’attend que ceux qui ont annoncé venir', () => {
    const { totals } = deskList(guests, EMPTY_DESK);
    expect(totals.expected).toBe(2);
    expect(totals.expectedPeople).toBe(3);
    expect(totals.inRoom).toBe(0);
  });

  it('compte dans la salle quiconque est pointé, même s’il avait décliné', () => {
    // Quelqu'un qui avait dit non et qui vient quand même est DANS la salle :
    // le traiteur et la sécurité comptent des corps, pas des intentions.
    const { totals } = deskList(guests, tap(EMPTY_DESK, 'r3', true));
    expect(totals.inRoom).toBe(1);
    expect(totals.arrived).toBe(1);
  });
});

describe('le statut est ÉCRIT, jamais seulement coloré', () => {
  it('nomme chacun des quatre états', () => {
    const rows = deskList(
      [
        guest({ id: 'r1' }),
        guest({ id: 'r2', status: 'declined' }),
        guest({ id: 'r3', status: 'unknown' }),
      ],
      EMPTY_DESK,
    ).rows;

    expect(rows.map(deskStatusLabel)).toEqual(['Attendu', 'A décliné', 'Sans réponse']);
    expect(deskStatusLabel(deskList([guest({ id: 'r1' })], tap(EMPTY_DESK, 'r1', true)).rows[0]!))
      .toBe('Arrivé — envoi en cours');
  });
});

describe('la fraîcheur se dit en toutes lettres', () => {
  it('dit « à jour » quand le delta vient de revenir', () => {
    const result = freshness(10_000, 13_000, true);
    expect(result.tone).toBe('fresh');
    expect(result.text).toBe('À jour il y a 3 s');
  });

  it('dit que la liste est FIGÉE quand le serveur ne répond plus', () => {
    const result = freshness(0, STALE_AFTER_MS + 5_000, true);
    expect(result.tone).toBe('stale');
    // Le mot compte : une liste périmée qui a l'air vivante est la pire panne
    // possible à une porte.
    expect(result.text).toContain('figée');
  });

  it('dit hors ligne, et que les pointages ne sont pas perdus', () => {
    const result = freshness(0, 40_000, false);
    expect(result.tone).toBe('offline');
    expect(result.text).toContain('Hors ligne depuis 40 s');
    expect(result.text).toContain('retour du réseau');
  });

  it('ne prétend rien quand rien n’est encore arrivé', () => {
    expect(freshness(null, 1000, true).tone).toBe('never');
    expect(freshness(null, 1000, false).text).toContain('jamais synchronisée');
  });
});
