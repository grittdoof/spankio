import { describe, expect, it } from 'vitest';
import { eventDescription, eventLocation } from '@/lib/event/calendar-content';

/**
 * Ce que le répondant retrouvera dans son agenda.
 *
 * L'enjeu n'est pas cosmétique : un rendez-vous rouvert trois semaines plus
 * tard doit dire où aller et qui organise, sinon son destinataire retourne
 * fouiller ses courriels — ce que l'ajout à l'agenda devait précisément
 * éviter.
 */

describe('lieu', () => {
  it('réunit le nom du lieu et l’adresse', () => {
    expect(
      eventLocation({
        locationLabel: 'Musée Jacquemart-André',
        address: '158 Bd Haussmann, 75008 Paris',
      }),
    ).toBe('Musée Jacquemart-André, 158 Bd Haussmann, 75008 Paris');
  });

  it('ne redouble pas un nom déjà présent dans l’adresse', () => {
    expect(
      eventLocation({
        locationLabel: 'Musée Jacquemart-André',
        address: 'Musée Jacquemart-André, 158 Bd Haussmann',
      }),
    ).toBe('Musée Jacquemart-André, 158 Bd Haussmann');
  });

  it.each([
    [{ locationLabel: 'Salle des fêtes', address: null }, 'Salle des fêtes'],
    [{ locationLabel: null, address: '12 rue des Lilas' }, '12 rue des Lilas'],
    [{ locationLabel: '  ', address: '  ' }, null],
    [{}, null],
  ])('se contente de ce qui existe (%o)', (place, expected) => {
    expect(eventLocation(place)).toBe(expected);
  });
});

describe('description', () => {
  it('compose ce dont il s’agit, qui organise, et où revenir', () => {
    expect(
      eventDescription({
        description: 'Soirée des 180 ans du groupe.',
        organiser: 'Spie batignolles',
        url: 'https://exemple.test/s/org/invitation',
      }),
    ).toBe(
      'Soirée des 180 ans du groupe.\n\nOrganisé par Spie batignolles\n\nhttps://exemple.test/s/org/invitation',
    );
  });

  it('place les précisions de l’événement AVANT la description du formulaire', () => {
    // Les précisions ont été écrites pour l'agenda ; la description l'a été
    // pour la page. La première est plus utile dans un rendez-vous.
    const composed = eventDescription({
      description: 'Texte de la page.',
      details: 'Tenue de ville. Accueil dès 19 h.',
    });
    expect(composed?.indexOf('Tenue de ville')).toBeLessThan(
      composed?.indexOf('Texte de la page.') ?? 0,
    );
  });

  it('ne répète pas un texte identique', () => {
    const composed = eventDescription({ description: 'Même texte', details: 'Même texte' });
    expect(composed).toBe('Même texte');
  });

  it('n’invente rien quand tout est vide', () => {
    expect(eventDescription({})).toBeNull();
    expect(eventDescription({ description: '   ', organiser: null })).toBeNull();
  });

  it('omet l’organisateur absent plutôt que d’écrire « Organisé par »', () => {
    expect(eventDescription({ description: 'Réunion', organiser: '  ' })).toBe('Réunion');
  });

  it('tronque un texte démesuré sur un espace', () => {
    const long = `${'mot '.repeat(400)}fin`;
    const composed = eventDescription({ description: long });
    expect(composed!.length).toBeLessThanOrEqual(901);
    expect(composed!.endsWith('…')).toBe(true);

    // Coupé entre deux mots : le texte conservé est un préfixe exact de
    // l'original, et ce qui suit dans l'original commence par une espace.
    const kept = composed!.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long.charAt(kept.length)).toBe(' ');
  });

  it('garde un texte juste sous la limite intact', () => {
    const text = 'a'.repeat(900);
    expect(eventDescription({ description: text })).toBe(text);
  });
});
