import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArrivalsPanel } from '@/components/admin/ArrivalsPanel';
import { arrivalFacts, arrivalReport, type ArrivalRow } from '@/lib/checkin/report';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Accessibilité de la vue « Arrivées ».
 *
 * Deux exigences, les mêmes que pour les autres écrans chiffrés : la courbe
 * ne porte RIEN — elle est `aria-hidden` et chaque valeur est énumérée à
 * côté — et aucun chiffre n'est dit deux fois au lecteur d'écran.
 */

const TZ = 'Europe/Paris';

function row(partial: Partial<ArrivalRow> & { id: string }): ArrivalRow {
  return {
    expected: 'attending',
    announced: 1,
    arrivedAt: null,
    peopleIn: null,
    ...partial,
  };
}

const ROWS: ArrivalRow[] = [
  row({ id: 'a', announced: 2, arrivedAt: '2026-11-18T18:02:00.000Z' }),
  row({ id: 'b', arrivedAt: '2026-11-18T18:07:00.000Z' }),
  row({ id: 'c', arrivedAt: '2026-11-18T18:14:00.000Z', peopleIn: 1 }),
  row({ id: 'd' }),
  row({ id: 'e', expected: 'declined', arrivedAt: '2026-11-18T18:31:00.000Z' }),
];

const REPORT = arrivalReport(ROWS, TZ);

function renderPanel() {
  return render(
    <ArrivalsPanel
      counting
      facts={arrivalFacts(REPORT, TZ)}
      preparationHref="/admin/sondages/abc/accueil"
      report={REPORT}
    />,
  );
}

describe('vue « Arrivées »', () => {
  it('ne présente aucune violation détectable', async () => {
    const { container } = renderPanel();
    await expectNoA11yViolations(container);
  });

  it('cache la courbe au lecteur d’écran et écrit les mêmes chiffres', () => {
    const { container } = renderPanel();
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');

    // Chaque tranche est énumérée en toutes lettres juste en dessous.
    for (const slice of REPORT.slices) {
      expect(screen.getByText(slice.fullLabel)).toBeInTheDocument();
    }
  });

  it('dit le compteur avec son dénominateur', () => {
    renderPanel();
    // Aucune jauge sans dénominateur. Le dénominateur compte des PERSONNES,
    // pas des rangées : quatre inscriptions annoncent venir, mais l'une
    // d'elles annonce deux personnes.
    expect(screen.getByText(/sur 5 annoncées/)).toBeInTheDocument();
  });

  it('nomme les écarts entre annoncé et constaté', () => {
    renderPanel();
    expect(screen.getByText('Annoncées, non venues')).toBeInTheDocument();
    expect(screen.getByText('Venues sans l’avoir annoncé')).toBeInTheDocument();
    expect(screen.getByText('Effectifs corrigés à l’entrée')).toBeInTheDocument();
  });

  it('n’énonce AUCUN impératif dans les faits', () => {
    renderPanel();
    const faits = screen.getByRole('list');
    expect(faits.textContent).not.toMatch(
      /\b(relancez|ouvrez|pensez|prévoyez|augmentez|anticipez)\b/i,
    );
  });

  it('propose la préparation plutôt qu’un écran vide, avant la soirée', () => {
    const vide = arrivalReport([row({ id: 'a' })], TZ);
    render(
      <ArrivalsPanel
        counting
        facts={arrivalFacts(vide, TZ)}
        preparationHref="/admin/sondages/abc/accueil"
        report={vide}
      />,
    );
    // Cette vue est légitimement vide pendant les trois semaines qui
    // précèdent : elle doit dire pourquoi, et où aller.
    expect(screen.getByText(/Rien à rapporter pour le moment/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Préparer l’accueil/ })).toBeInTheDocument();
  });
});
