import { describe, expect, it } from 'vitest';
import {
  availableTimeZones,
  instantToWallClock,
  isKnownTimeZone,
  isWallClock,
  isoToWallClock,
  wallClockToInstant,
  wallClockToIso,
} from '@/lib/event/time';

/**
 * Conversion heure locale ↔ instant absolu.
 *
 * L'enjeu n'est pas cosmétique : un décalage d'une heure envoie les répondants
 * au mauvais moment, via un fichier d'agenda qu'ils ne rouvriront pas pour
 * vérifier. Les frontières de changement d'heure sont donc testées
 * explicitement, avec le comportement RÉELLEMENT observé — pas celui qu'on
 * aimerait.
 */

describe('reconnaissance des entrées', () => {
  it('accepte une heure de calendrier bien formée', () => {
    expect(isWallClock('2026-07-14T18:30')).toBe(true);
  });

  it.each(['2026-07-14', '2026-07-14T18:30:00', '2026-7-14T18:30', '', 'demain'])(
    'refuse « %s »',
    (value) => {
      expect(isWallClock(value)).toBe(false);
    },
  );

  it('refuse un fuseau inventé', () => {
    expect(isKnownTimeZone('Europe/Atlantide')).toBe(false);
    expect(isKnownTimeZone('Europe/Paris')).toBe(true);
  });
});

describe('aller-retour', () => {
  const cases: Array<[string, string]> = [
    ['2026-07-14T18:30', 'Europe/Paris'],
    ['2026-01-14T18:30', 'Europe/Paris'],
    ['2026-06-01T09:00', 'America/New_York'],
    ['2026-06-01T09:00', 'Pacific/Auckland'],
    ['2026-06-01T09:00', 'UTC'],
    ['2026-12-31T23:59', 'Pacific/Kiritimati'],
  ];

  it.each(cases)('%s dans %s revient identique', (wallClock, timeZone) => {
    const instant = wallClockToInstant(wallClock, timeZone);
    expect(instant).not.toBeNull();
    expect(instantToWallClock(instant!, timeZone)).toBe(wallClock);
  });
});

describe('fuseaux et saisons', () => {
  it('applique l’heure d’été et l’heure d’hiver, pas un décalage constant', () => {
    // Le même horaire de calendrier ne donne PAS le même instant selon la
    // saison : c'est précisément ce qu'un décalage figé raterait.
    expect(wallClockToIso('2026-07-14T18:30', 'Europe/Paris')).toBe('2026-07-14T16:30:00.000Z');
    expect(wallClockToIso('2026-01-14T18:30', 'Europe/Paris')).toBe('2026-01-14T17:30:00.000Z');
  });

  it('résout une heure ambiguë vers l’occurrence en heure d’hiver', () => {
    // Le 25 octobre 2026, 02 h 30 est jouée deux fois à Paris : à 00:30Z en
    // heure d'été, puis à 01:30Z en heure d'hiver. La seconde est retenue.
    expect(wallClockToIso('2026-10-25T02:30', 'Europe/Paris')).toBe('2026-10-25T01:30:00.000Z');
  });

  it('fait glisser une heure inexistante d’une heure', () => {
    // Le 29 mars 2026, 02 h 30 n'existe pas à Paris (02 h → 03 h).
    const instant = wallClockToInstant('2026-03-29T02:30', 'Europe/Paris');
    expect(instant?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(instantToWallClock(instant!, 'Europe/Paris')).toBe('2026-03-29T03:30');
  });
});

describe('refus', () => {
  it.each([
    ['2026-07-14T18:30', 'Europe/Atlantide'],
    ['pas une date', 'Europe/Paris'],
    ['', 'Europe/Paris'],
  ])('ne convertit pas « %s » / « %s »', (wallClock, timeZone) => {
    expect(wallClockToInstant(wallClock, timeZone)).toBeNull();
    expect(wallClockToIso(wallClock, timeZone)).toBeNull();
  });

  it('ne rend pas d’heure pour un instant invalide', () => {
    expect(instantToWallClock(new Date('pas une date'), 'Europe/Paris')).toBeNull();
  });
});

describe('remplissage d’un champ', () => {
  it('rend une chaîne vide quand rien n’est enregistré', () => {
    expect(isoToWallClock(null, 'Europe/Paris')).toBe('');
  });

  it('rend l’heure du fuseau de l’événement, pas celle du poste', () => {
    expect(isoToWallClock('2026-07-14T16:30:00.000Z', 'Europe/Paris')).toBe('2026-07-14T18:30');
    expect(isoToWallClock('2026-07-14T16:30:00.000Z', 'America/New_York')).toBe(
      '2026-07-14T12:30',
    );
  });
});

describe('liste des fuseaux', () => {
  it('propose au moins les fuseaux courants', () => {
    const zones = availableTimeZones();
    expect(zones.length).toBeGreaterThan(5);
    expect(zones).toContain('Europe/Paris');
  });

  it('ne propose que des fuseaux réellement connus du moteur', () => {
    for (const zone of availableTimeZones()) {
      expect(isKnownTimeZone(zone)).toBe(true);
    }
  });
});
