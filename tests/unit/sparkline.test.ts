import { describe, expect, it } from 'vitest';
import { sparkline } from '@/lib/design/sparkline';

/**
 * Géométrie d'une courbe.
 *
 * Une courbe fausse ressemble à une courbe : c'est précisément pourquoi la
 * géométrie est une fonction pure plutôt qu'un chemin composé dans du JSX. Ces
 * tests fixent l'échelle, et surtout le fait qu'elle part de ZÉRO — un axe
 * tronqué exagérerait la moindre variation.
 */

const series = (counts: readonly number[]) =>
  counts.map((count, index) => ({ count, label: `p${index}` }));

describe('échelle', () => {
  it('part de zéro : la valeur nulle touche la ligne de base', () => {
    const chart = sparkline(series([0, 10]), { width: 100, top: 0, bottom: 100, inset: 0 });
    expect(chart.points[0]!.y).toBe(100);
  });

  it('laisse respirer le sommet plutôt que de le coller au bord', () => {
    const chart = sparkline(series([0, 10]), { width: 100, top: 0, bottom: 100, inset: 0 });
    // Plafond = ceil(10 × 1,15) = 12, donc le sommet est à 100 − 10/12 × 100.
    expect(chart.ceiling).toBe(12);
    expect(chart.points[1]!.y).toBeCloseTo(16.7, 1);
  });

  it('garde un plafond non nul quand tout est à zéro', () => {
    const chart = sparkline(series([0, 0, 0]));
    expect(chart.ceiling).toBe(1);
    expect(chart.points.every((point) => point.y === 92)).toBe(true);
  });

  it('répartit les abscisses régulièrement, marge comprise', () => {
    const chart = sparkline(series([1, 1, 1]), { width: 100, inset: 10 });
    expect(chart.points.map((point) => point.x)).toEqual([10, 50, 90]);
  });

  it('centre un point unique : une division par zéro n’aurait pas d’abscisse', () => {
    const chart = sparkline(series([4]), { width: 100 });
    expect(chart.points[0]!.x).toBe(50);
  });
});

describe('chemins', () => {
  it('refermé sur la ligne de base pour l’aplat, ouvert pour la courbe', () => {
    const chart = sparkline(series([0, 10]), { width: 100, top: 0, bottom: 100, inset: 0 });
    expect(chart.line).toBe('M0 100 L100 16.7');
    expect(chart.area).toBe('M0 100 L100 16.7 L100 100 L0 100 Z');
  });

  it('ne produit aucun chemin sans donnée : un « M » seul serait un point fantôme', () => {
    const chart = sparkline([]);
    expect(chart.line).toBe('');
    expect(chart.area).toBe('');
    expect(chart.points).toEqual([]);
  });

  it('reprend valeur et étiquette de chaque seau, pour la restitution écrite', () => {
    const chart = sparkline(series([3, 5]));
    expect(chart.points.map((point) => [point.label, point.value])).toEqual([
      ['p0', 3],
      ['p1', 5],
    ]);
  });
});
