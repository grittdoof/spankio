import { describe, expect, it } from 'vitest';
import { countdown, countdownParts, daysUntil } from '@/lib/event/countdown';

/**
 * Compte à rebours.
 *
 * L'enjeu : « J-1 » doit vouloir dire « demain », pas « dans 24 heures ». Une
 * soirée qui commence à 19 h serait annoncée « Jour J » dès la veille au soir
 * si l'on divisait un écart de millisecondes par 86 400 000.
 */

describe('jours restants', () => {
  const now = new Date('2026-09-07T22:00:00Z');

  it('compte des jours de CALENDRIER, non des tranches de 24 heures', () => {
    // Le 8 à 6 h du matin, c'est demain — bien qu'il y ait moins de 24 h.
    expect(daysUntil('2026-09-08T06:00:00Z', { now, timeZone: 'UTC' })).toBe(1);
  });

  it('vaut zéro le jour même', () => {
    expect(daysUntil('2026-09-07T06:00:00Z', { now, timeZone: 'UTC' })).toBe(0);
  });

  it('devient négatif après', () => {
    expect(daysUntil('2026-09-05T18:00:00Z', { now, timeZone: 'UTC' })).toBe(-2);
  });

  it('compte dans le fuseau de l’ÉVÉNEMENT', () => {
    // À 22 h UTC le 7, il est déjà minuit passé le 8 à Paris : un événement le
    // 8 est donc « aujourd'hui » sur place, et « demain » en UTC.
    expect(daysUntil('2026-09-08T17:00:00Z', { now, timeZone: 'Europe/Paris' })).toBe(0);
    expect(daysUntil('2026-09-08T17:00:00Z', { now, timeZone: 'UTC' })).toBe(1);
  });

  it('ne devine rien sans date, ni avec une date illisible', () => {
    expect(daysUntil(null, { now })).toBeNull();
    expect(daysUntil('pas une date', { now })).toBeNull();
  });

  it('retombe sur UTC plutôt que d’échouer sur un fuseau inconnu', () => {
    expect(daysUntil('2026-09-09T06:00:00Z', { now, timeZone: 'Mars/Olympus' })).toBe(2);
  });
});

describe('pastille', () => {
  const now = new Date('2026-09-07T10:00:00Z');
  const at = (iso: string) => countdown(iso, { now, timeZone: 'UTC' });

  it('dit « J-12 » à douze jours, et l’écrit en clair à côté', () => {
    expect(at('2026-09-19T18:00:00Z')).toEqual({
      badge: 'J-12',
      label: 'Dans 12 jours',
      days: 12,
      past: false,
    });
  });

  it('accorde le singulier', () => {
    expect(at('2026-09-08T18:00:00Z')?.label).toBe('Dans 1 jour');
  });

  it('dit « Jour J » le jour même', () => {
    expect(at('2026-09-07T18:00:00Z')?.badge).toBe('Jour J');
  });

  it('dit « Passé » après, et compte les jours écoulés', () => {
    expect(at('2026-09-01T18:00:00Z')).toEqual({
      badge: 'Passé',
      label: 'L’événement a eu lieu il y a 6 jours',
      days: -6,
      past: true,
    });
  });

  it('n’existe pas sans date', () => {
    expect(countdown(null, { now })).toBeNull();
  });
});

describe('décompte détaillé', () => {
  const now = new Date('2026-09-07T10:00:00Z');

  it('décompose l’écart en jours, heures, minutes et secondes', () => {
    // 2 jours, 3 heures, 4 minutes, 5 secondes plus tard.
    expect(countdownParts('2026-09-09T13:04:05Z', now)).toMatchObject({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
      reached: false,
    });
  });

  it('raisonne en INSTANTS, pas en jours de calendrier', () => {
    // Un compteur qui affiche des secondes ne peut pas arrondir au jour :
    // dans 23 h 30, il reste zéro jour, pas un.
    expect(countdownParts('2026-09-08T09:30:00Z', now)).toMatchObject({
      days: 0,
      hours: 23,
      minutes: 30,
    });
  });

  it('omet les secondes de la phrase écrite', () => {
    // Une zone annoncée qui change chaque seconde rendrait la page
    // inutilisable au lecteur d’écran.
    const parts = countdownParts('2026-09-09T13:04:05Z', now);
    expect(parts?.label).toBe('Dans 2 jours, 3 heures');
    expect(parts?.label).not.toMatch(/seconde/);
  });

  it('descend à la minute le dernier jour', () => {
    expect(countdownParts('2026-09-07T11:45:00Z', now)?.label).toBe(
      'Dans 1 heure, 45 minutes',
    );
  });

  it('signale l’échéance atteinte plutôt que de compter à l’envers', () => {
    expect(countdownParts('2026-09-07T09:59:00Z', now)).toMatchObject({
      reached: true,
      days: 0,
      seconds: 0,
    });
  });

  it('ne devine rien sans date, ni avec une date illisible', () => {
    expect(countdownParts(null, now)).toBeNull();
    expect(countdownParts('hier', now)).toBeNull();
  });
});
