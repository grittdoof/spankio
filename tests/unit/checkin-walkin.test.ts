import { describe, expect, it } from 'vitest';
import { mergeGuests, rehearsalGuest, walkinData, walkinFields } from '@/lib/checkin/walkin';
import { deskModeHref, parseDeskMode } from '@/lib/checkin/mode';
import { deskList, giftStatusLabel } from '@/lib/checkin/rows';
import { expandSeats } from '@/lib/checkin/seats';
import { deskReducer, EMPTY_DESK } from '@/lib/checkin/reducer';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import type { GuestRow } from '@/lib/survey/guests';

/**
 * L'invité de dernière minute et le mode « Départs ».
 *
 * Ce qui compte ici : l'écran ne demande que ce que l'ORGANISATION a désigné,
 * rien n'est inventé dans ce qui part en base, et un appui en mode
 * « Départs » ne fait arriver personne.
 */

const schema: SurveySchema = (() => {
  const result = validateSurveySchema({
    version: 1,
    steps: [
      {
        id: 'etape_1',
        fields: [
          { id: 'nom', type: 'text', label: 'Quel est votre nom ?', required: true },
          { id: 'prenom', type: 'text', label: 'Quel est votre prénom ?', required: true },
          { id: 'societe', type: 'text', label: 'Société', required: false },
          {
            id: 'presence',
            type: 'radio',
            label: 'Serez-vous présent ?',
            required: true,
            options: [
              { value: 'oui', label: 'Oui' },
              { value: 'non', label: 'Non' },
            ],
          },
          {
            id: 'agence',
            type: 'select',
            label: 'Agence',
            required: false,
            options: [{ value: 'lyon', label: 'Lyon' }],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error('schéma de test invalide');
  return result.schema;
})();

function guest(partial: Partial<GuestRow> & { id: string }): GuestRow {
  return {
    submittedAt: '2026-11-18T18:00:00.000Z',
    name: `Invité ${partial.id}`,
    initials: 'IN',
    detail: null,
    companion: null,
    status: 'attending',
    people: 1,
    ambiguous: false,
    walkIn: false,
    ...partial,
  };
}

describe('walkinFields', () => {
  it('demande les questions qui NOMMENT, dans l’ordre choisi, puis celle qui précise', () => {
    const fields = walkinFields(schema, {
      identityFields: ['prenom', 'nom'],
      detailField: 'societe',
    });
    expect(fields.map((field) => [field.id, field.role])).toEqual([
      ['prenom', 'identity'],
      ['nom', 'identity'],
      ['societe', 'detail'],
    ]);
    expect(fields[0]!.label).toBe('Quel est votre prénom ?');
  });

  it('n’offre pas une liste fermée : on n’y écrit pas un libellé libre', () => {
    const fields = walkinFields(schema, { identityFields: ['nom'], detailField: 'agence' });
    expect(fields.map((field) => field.id)).toEqual(['nom']);
  });

  it('sans question qui nomme, ne propose RIEN — pas même la précision', () => {
    expect(walkinFields(schema, { detailField: 'societe' })).toEqual([]);
    expect(walkinFields(schema, { identityFields: ['disparue'] })).toEqual([]);
  });

  it('lit encore la désignation au singulier', () => {
    expect(walkinFields(schema, { identityField: 'nom' }).map((field) => field.id)).toEqual([
      'nom',
    ]);
  });
});

describe('walkinData', () => {
  const fields = walkinFields(schema, {
    identityFields: ['nom', 'prenom'],
    detailField: 'societe',
  });

  it('nettoie et ne garde que les questions proposées', () => {
    const outcome = walkinData(fields, {
      nom: '  Martin ',
      prenom: 'Lucie',
      societe: '',
      presence: 'oui',
      inconnue: 'x',
    });
    // La présence n'est PAS écrite : la personne n'a rien annoncé.
    expect(outcome).toEqual({ ok: true, data: { nom: 'Martin', prenom: 'Lucie' } });
  });

  it('exige un NOM : une société seule ne se retrouverait pas à la porte', () => {
    const outcome = walkinData(fields, { societe: 'Atelier Martin' });
    expect(outcome).toEqual({
      ok: false,
      message: 'Remplissez au moins « Quel est votre nom ? ».',
    });
  });

  it('borne la longueur comme la base', () => {
    const outcome = walkinData(fields, { nom: 'x'.repeat(500) });
    expect(outcome.ok && outcome.data['nom']!.length).toBe(200);
  });

  it('dit pourquoi l’ajout est impossible quand rien ne nomme les invités', () => {
    const outcome = walkinData([], { nom: 'Martin' });
    expect(outcome.ok).toBe(false);
  });
});

describe('mergeGuests et rehearsalGuest', () => {
  it('n’ajoute pas deux fois la même personne — réponse de l’ajout PUIS delta', () => {
    const base = [guest({ id: 'a' })];
    const merged = mergeGuests(base, [guest({ id: 'b' }), guest({ id: 'a' }), guest({ id: 'b' })]);
    expect(merged.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('compose une rangée d’essai comme la liste : questions qui nomment, dans l’ordre', () => {
    const fields = walkinFields(schema, {
      identityFields: ['prenom', 'nom'],
      detailField: 'societe',
    });
    const row = rehearsalGuest('x', fields, { nom: 'Martin', prenom: 'Lucie', societe: 'AM' }, 'now');
    expect(row).toMatchObject({
      name: 'Lucie Martin',
      initials: 'LM',
      detail: 'AM',
      status: 'unknown',
      walkIn: true,
    });
  });
});

describe('mode du poste', () => {
  it('lit l’URL avec tolérance', () => {
    expect(parseDeskMode('departs')).toBe('departures');
    expect(parseDeskMode('n’importe quoi')).toBe('arrivals');
    expect(parseDeskMode(undefined)).toBe('arrivals');
  });

  it('écrit le mode sans perdre l’essai à blanc', () => {
    expect(deskModeHref('/accueil/x', '?essai=1', 'departures')).toBe(
      '/accueil/x?essai=1&mode=departs',
    );
    expect(deskModeHref('/accueil/x', '?essai=1&mode=departs', 'arrivals')).toBe(
      '/accueil/x?essai=1',
    );
    expect(deskModeHref('/accueil/x', '', 'arrivals')).toBe('/accueil/x');
  });
});

describe('le cadeau dans la liste du poste', () => {
  it('un cadeau en vol ne fait arriver personne', () => {
    const state = deskReducer(EMPTY_DESK, {
      type: 'tap',
      opId: 'op',
      responseId: 'a',
      seat: 0,
      kind: 'gift',
      value: true,
    });
    const { rows, totals } = deskList(expandSeats([guest({ id: 'a' })]), state);
    expect(rows[0]).toMatchObject({ gift: true, giftPending: true, arrived: false, pending: false });
    expect(totals).toMatchObject({ gifts: 1, inRoom: 0, pending: 1 });
    expect(giftStatusLabel(rows[0]!)).toBe('Cadeau remis — envoi en cours');
  });

  it('un refus d’arrivée n’est pas effacé par un cadeau sur la même personne', () => {
    let state = deskReducer(EMPTY_DESK, {
      type: 'tap',
      opId: 'op-1',
      responseId: 'a',
      seat: 0,
      kind: 'arrival',
      value: true,
    });
    state = deskReducer(state, { type: 'refused', opId: 'op-1', message: 'Refusé' });
    state = deskReducer(state, {
      type: 'tap',
      opId: 'op-2',
      responseId: 'a',
      seat: 0,
      kind: 'gift',
      value: true,
    });
    const { rows } = deskList(expandSeats([guest({ id: 'a' })]), state);
    expect(rows[0]!.refused).toEqual({ opId: 'op-1', message: 'Refusé' });
  });

  it('lit le cadeau de l’état serveur, séparément de l’arrivée', () => {
    const state = deskReducer(EMPTY_DESK, {
      type: 'delta',
      at: 0,
      states: [
        {
          responseId: 'a',
          seat: 0,
          arrivedAt: null,
          giftAt: '2026-11-18T23:00:00.000Z',
          version: 1,
          updatedAt: '2026-11-18T23:00:00.000Z',
        },
      ],
    });
    const { rows } = deskList(expandSeats([guest({ id: 'a' })]), state);
    expect(rows[0]).toMatchObject({ gift: true, arrived: false });
  });

  it('garde un statut COURT : la pastille tient à côté du nom', () => {
    const { rows } = deskList(expandSeats([guest({ id: 'a' })]), EMPTY_DESK);
    expect(giftStatusLabel(rows[0]!)).toBe('Sans cadeau');
  });
});
