import { describe, expect, it } from 'vitest';
import { KEYBOARD_THRESHOLD, viewportMetrics } from '@/lib/checkin/viewport';

/**
 * La position de la barre du bas, clavier ouvert.
 *
 * Défaut réel, sur iPhone : le clavier se pose PAR-DESSUS la page sans la
 * rétrécir. Une barre accrochée au bas de la page restait derrière lui ou
 * laissait voir la liste entre les deux. Ces cas fixent le signe et les
 * bornes du calcul, qui ne se vérifieraient sinon qu'à l'œil.
 */

describe('viewportMetrics', () => {
  it('sans clavier, la barre reste au bas de l’écran', () => {
    expect(viewportMetrics({ innerHeight: 812, height: 812, offsetTop: 0 })).toEqual({
      lift: 0,
      top: 0,
      height: 812,
      keyboard: false,
    });
  });

  it('clavier ouvert : la barre est relevée exactement de ce qu’il recouvre', () => {
    const metrics = viewportMetrics({ innerHeight: 812, height: 476, offsetTop: 0 });
    expect(metrics.lift).toBe(336);
    expect(metrics.keyboard).toBe(true);
  });

  it('clavier ouvert ET page défilée : la barre suit la zone visible', () => {
    // Safari a fait glisser la zone visible de 200 px vers le bas : le bas de
    // cette zone n'est plus qu'à 136 px du bas de la page.
    const metrics = viewportMetrics({ innerHeight: 812, height: 476, offsetTop: 200 });
    expect(metrics.lift).toBe(136);
    expect(metrics.top).toBe(200);
  });

  it('ne relève jamais la barre en négatif, même sur un rebond élastique', () => {
    expect(viewportMetrics({ innerHeight: 812, height: 812, offsetTop: 12 }).lift).toBe(0);
  });

  it('une barre d’adresse qui se replie n’est pas un clavier', () => {
    const metrics = viewportMetrics({
      innerHeight: 812,
      height: 812 - (KEYBOARD_THRESHOLD - 40),
      offsetTop: 0,
    });
    expect(metrics.keyboard).toBe(false);
  });

  it('arrondit au pixel : une demi-valeur ferait trembler la barre', () => {
    expect(viewportMetrics({ innerHeight: 812, height: 475.5, offsetTop: 0.25 })).toMatchObject({
      lift: 336,
      height: 476,
      top: 0,
    });
  });
});
