import { describe, expect, it } from 'vitest';
import {
  composeEventNote,
  eventLocation,
  eventNote,
  eventTitle,
} from '@/lib/event/calendar-content';

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

describe('note composée automatiquement', () => {
  it('compose ce dont il s’agit, qui organise, et où revenir', () => {
    expect(
      composeEventNote({
        description: 'Soirée des 180 ans du groupe.',
        organiser: 'Spie batignolles',
        url: 'https://exemple.test/s/org/invitation',
      }),
    ).toBe(
      'Soirée des 180 ans du groupe.\n\nOrganisé par Spie batignolles\n\nhttps://exemple.test/s/org/invitation',
    );
  });

  it('n’invente rien quand tout est vide', () => {
    expect(composeEventNote({})).toBeNull();
    expect(composeEventNote({ description: '   ', organiser: null })).toBeNull();
  });

  it('omet l’organisateur absent plutôt que d’écrire « Organisé par »', () => {
    expect(composeEventNote({ description: 'Réunion', organiser: '  ' })).toBe('Réunion');
  });

  it('tronque un texte démesuré sur un espace', () => {
    const long = `${'mot '.repeat(400)}fin`;
    const composed = composeEventNote({ description: long });
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
    expect(composeEventNote({ description: text })).toBe(text);
  });
});

describe('note de l’organisation', () => {
  const context = {
    description: 'Texte de la page.',
    organiser: 'Spie batignolles',
    url: 'https://exemple.test/s/org/invitation',
  };

  it('REMPLACE le texte automatique, elle ne s’y ajoute pas', () => {
    // C'est le contrat le plus prévisible : ce que l'organisation écrit est ce
    // que le répondant lit, sans mention ni lien ajoutés dans son dos.
    expect(eventNote({ ...context, custom: 'Tenue de ville. Accueil dès 19 h.' })).toBe(
      'Tenue de ville. Accueil dès 19 h.',
    );
  });

  it.each([null, undefined, '', '   ', '\n\n'])(
    'retombe sur le texte automatique pour une note vide (%j)',
    (custom) => {
      // Sans cette précaution, un champ effacé produirait un rendez-vous muet,
      // alors que le texte automatique vaut mieux que rien.
      expect(eventNote({ ...context, custom })).toBe(composeEventNote(context));
    },
  );

  it('tronque aussi une note démesurée', () => {
    const note = eventNote({ ...context, custom: `${'mot '.repeat(400)}fin` });
    expect(note!.length).toBeLessThanOrEqual(901);
    expect(note!.endsWith('…')).toBe(true);
  });

  it('rend une note nulle quand il n’y a ni note ni contexte', () => {
    expect(eventNote({})).toBeNull();
  });
});

describe('titre du rendez-vous', () => {
  /**
   * Demande du client. Un titre d'invitation est fait pour être lu SUR une
   * page — « Spie batignolles célèbre ses 180 ans et vous convie à une soirée
   * d'exception » — pas pour tenir dans la case d'un lundi.
   *
   * Le contrat est celui de la note d'agenda, volontairement : ce qui est
   * écrit REMPLACE, et le titre du formulaire reste le seul repli.
   */
  const title = 'Spie batignolles célèbre ses 180 ans et vous convie à une soirée d’exception';

  it('reprend le titre du formulaire à défaut', () => {
    expect(eventTitle({ title })).toBe(title);
    expect(eventTitle({ custom: null, title })).toBe(title);
  });

  it('remplace par le titre écrit, sans rien y ajouter', () => {
    expect(eventTitle({ custom: 'Soirée des 180 ans', title })).toBe('Soirée des 180 ans');
  });

  it('ne compte pas un titre vide ou fait d’espaces', () => {
    // Sans cette précaution, un champ effacé produirait un rendez-vous sans
    // titre — pire qu'un titre trop long.
    for (const custom of ['', '   ', '\n\t']) {
      expect(eventTitle({ custom, title })).toBe(title);
    }
  });

  it('rogne proprement un titre démesuré', () => {
    const long = 'a'.repeat(260);
    const result = eventTitle({ custom: long, title });
    expect(result.length).toBeLessThanOrEqual(201);
    expect(result.endsWith('…')).toBe(true);
  });
});
