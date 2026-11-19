import { describe, expect, it } from 'vitest';
import { sparkline, TICK_ANGLE } from '@/lib/design/sparkline';

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

/**
 * Les étiquettes d'axe.
 *
 * Défaut réel : les seize tranches d'une soirée écrivaient leurs seize
 * horaires sous une courbe large de 300 unités — « 18:4018:5019:00 ». La
 * réponse est l'INCLINAISON d'abord, le silence ensuite : deux étiquettes
 * penchées sont parallèles, donc leur longueur ne les fait plus se rencontrer.
 */

/** Les seize tranches de dix minutes d'une vraie soirée. */
const SOIREE = Array.from({ length: 16 }, (_, index) => {
  const minutes = 18 * 60 + 40 + index * 10;
  const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`;
  return { count: index, label };
});

describe('étiquettes d’axe', () => {
  it('les écrit toutes quand la place ne manque pas', () => {
    const chart = sparkline(series([1, 2, 3]));
    expect(chart.points.map((point) => point.tick)).toEqual(['p0', 'p1', 'p2']);
  });

  it('écrit les SEIZE horaires d’une soirée dès qu’elles sont penchées', () => {
    // C'est le cas qui a motivé l'inclinaison : à plat, une heure sur deux
    // disparaissait alors que l'affluence se lit tranche par tranche.
    const chart = sparkline(SOIREE, { tickAngle: TICK_ANGLE });
    expect(chart.points.filter((point) => point.tick !== null)).toHaveLength(16);
  });

  it('à plat, la même série en perdrait la moitié', () => {
    const chart = sparkline(SOIREE);
    expect(chart.points.filter((point) => point.tick !== null).length).toBeLessThan(16);
  });

  it('garde toujours la PREMIÈRE : un repère sans origine ne sert à rien', () => {
    for (const length of [2, 7, 16, 31, 60]) {
      const chart = sparkline(series(Array.from({ length }, () => 1)), {
        tickAngle: TICK_ANGLE,
      });
      expect(chart.points[0]!.tick).not.toBeNull();
    }
  });

  it('ne tait JAMAIS une valeur : seul l’axe se raréfie', () => {
    const chart = sparkline(SOIREE, { tickAngle: TICK_ANGLE, width: 60 });
    expect(chart.points.map((point) => point.value)).toEqual(SOIREE.map((s) => s.count));
    expect(chart.points.map((point) => point.label)).toEqual(SOIREE.map((s) => s.label));
  });

  /*
   * La propriété qui compte, vérifiée sur toutes les tailles de série plutôt
   * que sur un cas : deux étiquettes retenues sont séparées d'au moins une
   * hauteur de ligne, mesurée PERPENDICULAIREMENT à leur inclinaison. C'est
   * la seule formulation qui vaille aussi bien à plat que penchée.
   */
  it('laisse toujours une hauteur de ligne entre deux étiquettes retenues', () => {
    const LINE_HEIGHT = 9;
    for (const length of [2, 5, 16, 30, 48, 90]) {
      for (const angle of [0, TICK_ANGLE]) {
        const entries = Array.from({ length }, (_, index) => ({
          count: index,
          label: `${String(index).padStart(2, '0')}:00`,
        }));
        const chart = sparkline(entries, { tickAngle: angle });
        const kept = chart.points.filter((point) => point.tick !== null);
        for (let index = 1; index < kept.length; index += 1) {
          const gap = kept[index]!.x - kept[index - 1]!.x;
          const clearance =
            angle === 0 ? gap : gap * Math.sin((angle * Math.PI) / 180);
          const needed = angle === 0 ? '00:00'.length * 5.4 : LINE_HEIGHT;
          expect(clearance).toBeGreaterThanOrEqual(needed);
        }
      }
    }
  });

  it('rend l’inclinaison retenue, et la borne', () => {
    // Le composant l'applique telle quelle : deux angles, l'un calculé ici et
    // l'autre écrit dans le JSX, finiraient par diverger.
    expect(sparkline(series([1, 2]), { tickAngle: TICK_ANGLE }).tickAngle).toBe(TICK_ANGLE);
    expect(sparkline(series([1, 2]), { tickAngle: -10 }).tickAngle).toBe(0);
    expect(sparkline(series([1, 2]), { tickAngle: 400 }).tickAngle).toBe(90);
    expect(sparkline([], { tickAngle: TICK_ANGLE }).tickAngle).toBe(TICK_ANGLE);
  });
});
