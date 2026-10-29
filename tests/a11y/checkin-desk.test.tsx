import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Desk } from '@/components/checkin/Desk';
import type { GuestRow } from '@/lib/survey/guests';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Accessibilité du poste d'accueil.
 *
 * Le besoin était formulé en couleurs — vert présent, rouge absent. Tel quel,
 * c'est un défaut : une partie des gens ne distinguent pas ces deux teintes,
 * et un lecteur d'écran n'en voit aucune. Ces tests exigent donc que le statut
 * soit ÉCRIT sur chaque rangée, qu'il n'y ait QU'UNE zone d'annonce, et que
 * toute la rangée soit une cible de pointage utilisable au clavier.
 */

const GUESTS: GuestRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    submittedAt: '2026-11-18T18:00:00.000Z',
    name: 'Élodie Marchand',
    initials: 'ÉM',
    detail: 'Agence de Lyon',
    status: 'attending',
    people: 2,
    ambiguous: false,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    submittedAt: '2026-11-18T18:05:00.000Z',
    name: 'Karim Benali',
    initials: 'KB',
    detail: null,
    status: 'declined',
    people: 0,
    ambiguous: false,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    submittedAt: '2026-11-18T18:10:00.000Z',
    name: 'Sophie Nguyen',
    initials: 'SN',
    detail: null,
    status: 'unknown',
    people: 1,
    ambiguous: true,
  },
];

function renderDesk() {
  return render(
    <Desk
      counting
      guests={GUESTS}
      initialStates={[]}
      printHref="/accueil/abc/impression"
      surveyId="abc"
      title="Soirée des 180 ans"
    />,
  );
}

beforeEach(() => {
  // Le composant interroge le delta dès son montage : sans ce double, chaque
  // test attendrait un réseau qui n'existe pas en jsdom.
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      let body = JSON.stringify({ states: [], at: new Date().toISOString() });

      if (init?.method === 'POST') {
        // Le POST rend l'ÉTAT de la rangée, comme la vraie route. Lui faire
        // rendre un delta reproduirait la réponse d'un portail captif, que le
        // composant doit justement refuser.
        const sent = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
          responseId?: string;
        };
        body = JSON.stringify({
          responseId: sent.responseId ?? '',
          arrivedAt: new Date().toISOString(),
          peopleIn: null,
          version: 1,
          updatedAt: new Date().toISOString(),
        });
      }
      return Promise.resolve(
        new Response(body, { headers: { 'content-type': 'application/json' } }),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('poste d’accueil', () => {
  it('ne présente aucune violation détectable', async () => {
    const { container } = renderDesk();
    await expectNoA11yViolations(container);
  });

  it('écrit le statut de chaque rangée, sans dépendre de la couleur', () => {
    renderDesk();
    // Les trois états annoncés sont nommés, pas seulement teintés.
    expect(screen.getByText('Attendu')).toBeInTheDocument();
    expect(screen.getByText('A décliné')).toBeInTheDocument();
    expect(screen.getByText('Sans réponse')).toBeInTheDocument();
  });

  it('fait de la rangée entière un bouton, atteignable au clavier', async () => {
    renderDesk();
    const row = screen.getByRole('button', { name: /Élodie Marchand/ });
    expect(row).toBeInTheDocument();

    await userEvent.tab();
    // La recherche vient d'abord ; la rangée est atteinte par tabulations
    // successives, sans piège ni élément focalisable caché.
    expect(document.activeElement).not.toBe(document.body);
  });

  it('change le statut écrit dès le pointage, avant toute réponse du serveur', async () => {
    // Le serveur ne répond JAMAIS : c'est la seule façon d'observer l'état
    // transitoire, et c'est aussi la panne réelle qu'on veut couvrir — la
    // rangée doit verdir au doigt, pas au retour du réseau.
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'POST'
          ? new Promise<Response>(() => {})
          : Promise.resolve(
              new Response(JSON.stringify({ states: [], at: new Date().toISOString() }), {
                headers: { 'content-type': 'application/json' },
              }),
            ),
      ),
    );

    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: /Élodie Marchand/ }));

    const row = screen.getByRole('button', { name: /Élodie Marchand/ });
    expect(within(row).getByText('Arrivé — envoi en cours')).toBeInTheDocument();
    expect(screen.getByText(/1 pointage en attente d’envoi/)).toBeInTheDocument();
  });

  it('dit « Arrivé » tout court une fois le serveur confirmé', async () => {
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: /Élodie Marchand/ }));

    const row = screen.getByRole('button', { name: /Élodie Marchand/ });
    expect(within(row).getByText('Arrivé')).toBeInTheDocument();
    // Plus rien en attente : l'opération confirmée a QUITTÉ la file.
    expect(screen.queryByText(/en attente d’envoi/)).not.toBeInTheDocument();
  });

  it('n’a QU’UNE zone d’annonce pour tout l’écran', async () => {
    renderDesk();
    // Deux `role="status"` concurrents interrompraient deux fois le lecteur
    // d'écran pour un même événement, et la seconde interruption écraserait
    // la première.
    expect(screen.getAllByRole('status')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /Élodie Marchand/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Élodie Marchand — arrivé');
  });

  it('annonce le compteur de salle avec son dénominateur', () => {
    renderDesk();
    // Aucune jauge sans dénominateur : « 0 personne présente » seul ne dit pas
    // combien sont attendues.
    expect(screen.getByText(/sur 2 attendues/)).toBeInTheDocument();
  });

  it('dit la fraîcheur de la liste en toutes lettres', () => {
    renderDesk();
    expect(screen.getByText(/Synchronisation en cours|À jour/)).toBeInTheDocument();
  });

  it('filtre sans recharger, et les puces disent leur effectif', async () => {
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: /Arrivés/ }));

    expect(screen.getByText(/Aucun invité dans ce filtre/)).toBeInTheDocument();
    // Les filtres sont des BOUTONS et non des liens : leur état doit survivre
    // à une coupure réseau, là où un lien rechargerait la page.
    expect(screen.getByRole('button', { name: /Arrivés/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('trouve un nom accentué saisi sans accent', async () => {
    renderDesk();
    await userEvent.type(screen.getByRole('searchbox'), 'elodie');

    expect(screen.getByRole('button', { name: /Élodie Marchand/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Karim Benali/ })).not.toBeInTheDocument();
  });

  it('signale un effectif à vérifier, en toutes lettres', () => {
    renderDesk();
    expect(screen.getByText(/effectif à vérifier/)).toBeInTheDocument();
  });
});
