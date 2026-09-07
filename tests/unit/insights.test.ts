import { describe, expect, it } from 'vitest';
import { eventInsights } from '@/lib/survey/insights';
import { responsePace, type Pace } from '@/lib/survey/pace';
import type { AttendanceTotals } from '@/lib/survey/attendance';

/**
 * « À retenir ».
 *
 * Règle testée avant toutes les autres : **un fait, jamais un conseil.** Chaque
 * énoncé doit être vérifiable en recomptant, et n'apparaître que lorsqu'il est
 * vrai — un encadré qui dit toujours quelque chose finit par ne plus rien dire.
 */

const now = new Date('2026-09-07T10:00:00Z');

const emptyPace: Pace = responsePace([], { now, window: '7j', timeZone: 'UTC' });

const totals = (over: Partial<AttendanceTotals> = {}): AttendanceTotals => ({
  attending: 10,
  declined: 2,
  unknown: 0,
  people: 18,
  ambiguous: 0,
  ...over,
});

const keys = (input: Parameters<typeof eventInsights>[0]) =>
  eventInsights(input).map((insight) => insight.key);

describe('capacité', () => {
  const base = { responseCount: 12, pace: emptyPace, countdown: null };

  it('reste muette sans capacité : un pourcentage aurait un dénominateur inventé', () => {
    expect(keys({ ...base, totals: totals(), capacity: null })).not.toContain('places');
  });

  it('annonce les places restantes', () => {
    const [insight] = eventInsights({ ...base, totals: totals(), capacity: 30 });
    expect(insight).toMatchObject({ key: 'places', tone: 'accent', title: '12 places libres sur 30' });
  });

  it('accorde le singulier', () => {
    const [insight] = eventInsights({ ...base, totals: totals(), capacity: 19 });
    expect(insight?.title).toBe('1 place libre sur 19');
  });

  it('dit « complet » plutôt que « 0 place libre »', () => {
    const [insight] = eventInsights({ ...base, totals: totals(), capacity: 18 });
    expect(insight).toMatchObject({ key: 'places', tone: 'success' });
    expect(insight?.title).toBe('Toutes les places sont prises');
  });

  it('signale un dépassement au lieu de l’écrêter à zéro', () => {
    const [insight] = eventInsights({ ...base, totals: totals(), capacity: 12 });
    expect(insight).toMatchObject({ key: 'places', tone: 'danger' });
    expect(insight?.title).toContain('dépasse la capacité de 6');
  });
});

describe('réserves', () => {
  const base = { responseCount: 12, capacity: null, pace: emptyPace, countdown: null };

  it('signale les effectifs indéterminés', () => {
    const found = eventInsights({ ...base, totals: totals({ ambiguous: 3 }) }).find(
      (insight) => insight.key === 'ambigus',
    );
    expect(found).toMatchObject({ tone: 'warning', title: '3 réponses à vérifier' });
  });

  it('signale les réponses qui ont sauté la question de présence', () => {
    const found = eventInsights({ ...base, totals: totals({ unknown: 4 }) }).find(
      (insight) => insight.key === 'sans-reponse',
    );
    expect(found?.note).toContain('ni parmi ceux qui déclinent');
  });

  it('ne signale rien quand il n’y a rien à signaler', () => {
    expect(keys({ ...base, totals: totals() })).not.toContain('ambigus');
    expect(keys({ ...base, totals: totals() })).not.toContain('sans-reponse');
  });

  it('ne parle d’aucune réserve sans comptage configuré', () => {
    const found = keys({ ...base, totals: null });
    expect(found).not.toContain('ambigus');
    expect(found).not.toContain('places');
  });
});

describe('rythme', () => {
  const base = { responseCount: 12, totals: null, capacity: null, countdown: null };

  it('signale un silence : des réponses existent, mais aucune sur la période', () => {
    const found = eventInsights({ ...base, pace: emptyPace }).find(
      (insight) => insight.key === 'silence',
    );
    expect(found?.title).toBe('Aucune réponse sur 7 jours');
  });

  it('ne signale pas de silence quand il n’y a jamais eu de réponse', () => {
    expect(keys({ ...base, responseCount: 0, pace: emptyPace })).not.toContain('silence');
  });

  it('désigne la période la plus active, sans en tirer de recommandation', () => {
    const pace = responsePace(
      [
        { submitted_at: '2026-09-04T10:00:00Z' },
        { submitted_at: '2026-09-04T12:00:00Z' },
      ],
      { now, window: '7j', timeZone: 'UTC' },
    );
    const found = eventInsights({ ...base, pace }).find((insight) => insight.key === 'pointe');
    expect(found?.title).toBe('Pointe de 2 réponses');
    expect(found?.note).toContain('4 septembre');
    // Aucun impératif : ni « relancez », ni « prévoyez ».
    expect(`${found?.title} ${found?.note}`).not.toMatch(/relanc|prévoy|devriez/i);
  });
});

describe('échéance', () => {
  const base = { responseCount: 12, totals: null, capacity: null, pace: emptyPace };

  it('rappelle les jours restants avant l’événement', () => {
    const found = eventInsights({
      ...base,
      countdown: { badge: 'J-12', label: 'Dans 12 jours', days: 12, past: false },
    }).find((insight) => insight.key === 'echeance');
    expect(found?.title).toBe('12 jours avant l’événement');
  });

  it('se taît une fois l’événement passé', () => {
    expect(
      keys({
        ...base,
        countdown: { badge: 'Passé', label: 'hier', days: -1, past: true },
      }),
    ).not.toContain('echeance');
  });
});
