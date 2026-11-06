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
    companion: 'Jacqueline Marchand',
    status: 'attending',
    people: 2,
    ambiguous: false,
    walkIn: false,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    submittedAt: '2026-11-18T18:05:00.000Z',
    name: 'Karim Benali',
    initials: 'KB',
    detail: null,
    companion: null,
    status: 'declined',
    people: 0,
    ambiguous: false,
    walkIn: false,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    submittedAt: '2026-11-18T18:10:00.000Z',
    name: 'Sophie Nguyen',
    initials: 'SN',
    detail: null,
    companion: null,
    status: 'unknown',
    people: 1,
    ambiguous: true,
    walkIn: false,
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
          seat?: number;
        };
        // Le siège est RENDU : le poste vérifie que la réponse parle bien de
        // la personne envoyée, et un double qui l'omettrait ferait réessayer
        // indéfiniment — exactement ce qui arrive derrière un portail captif.
        body = JSON.stringify({
          responseId: sent.responseId ?? '',
          seat: sent.seat ?? 0,
          arrivedAt: new Date().toISOString(),
          giftAt: null,
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
    // Les trois états annoncés sont nommés, pas seulement teintés. « Attendu »
    // apparaît deux fois : Élodie ET son accompagnante, qui a sa propre
    // rangée depuis qu'un pointage vaut une personne.
    expect(screen.getAllByText('Attendu')).toHaveLength(2);
    expect(screen.getByText('A décliné')).toBeInTheDocument();
    expect(screen.getByText('Sans réponse')).toBeInTheDocument();
  });

  it('donne à l’accompagnante sa propre rangée, à son nom', () => {
    renderDesk();
    // C'est le besoin exprimé : Jacqueline se pointe elle-même, et la
    // précision dit de qui elle est l'invitée.
    expect(
      screen.getByRole('button', { name: /Jacqueline Marchand/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/accompagnant\(e\) de Élodie Marchand/)).toBeInTheDocument();
  });

  it('pointe l’accompagnante sans faire entrer son hôte', async () => {
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: /Jacqueline Marchand/ }));

    const host = screen.getByRole('button', { name: /^Élodie Marchand/ });
    expect(within(host).getByText('Attendu')).toBeInTheDocument();
  });

  it('fait de la rangée entière un bouton, atteignable au clavier', async () => {
    renderDesk();
    const row = screen.getByRole('button', { name: /^Élodie Marchand/ });
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
    await userEvent.click(screen.getByRole('button', { name: /^Élodie Marchand/ }));

    const row = screen.getByRole('button', { name: /^Élodie Marchand/ });
    expect(within(row).getByText('Arrivé — envoi en cours')).toBeInTheDocument();
    expect(screen.getByText(/1 pointage en attente d’envoi/)).toBeInTheDocument();
  });

  it('dit « Arrivé » tout court une fois le serveur confirmé', async () => {
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: /^Élodie Marchand/ }));

    const row = screen.getByRole('button', { name: /^Élodie Marchand/ });
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

    await userEvent.click(screen.getByRole('button', { name: /^Élodie Marchand/ }));
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

    expect(screen.getByRole('button', { name: /^Élodie Marchand/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Karim Benali/ })).not.toBeInTheDocument();
  });

  it('signale en toutes lettres un nombre d’accompagnants douteux', () => {
    // La réserve ne porte plus sur « combien sont entrés » — une ligne vaut
    // une personne — mais sur « combien de lignes fallait-il créer ».
    renderDesk();
    expect(screen.getByText(/nombre d’accompagnants à vérifier/)).toBeInTheDocument();
  });
});

describe('ce que le poste retrouve au rechargement', () => {
  /**
   * Défaut signalé en production, et le plus déroutant de la série : une
   * hôtesse pointe, rafraîchit la page, et tout le monde repasse « Attendu ».
   * Repointer donnait alors « un autre poste vient de modifier cette rangée »
   * alors que personne d'autre n'y avait touché — l'écran annonçait la
   * version 0 sur une ligne déjà en version 1.
   *
   * La cause était une indexation recopiée : par `responseId` seul ici, par
   * `réponse#siège` partout ailleurs.
   */
  function renderWith(states: { responseId: string; seat: number }[]) {
    return render(
      <Desk
        counting
        guests={GUESTS}
        initialStates={states.map(({ responseId, seat }) => ({
          responseId,
          seat,
          arrivedAt: '2026-11-18T19:05:00.000Z',
          giftAt: null,
          version: 1,
          updatedAt: '2026-11-18T19:05:00.000Z',
        }))}
        printHref="/accueil/abc/impression"
        surveyId="abc"
        title="Soirée des 180 ans"
      />,
    );
  }

  it('affiche « Arrivé » pour une personne déjà pointée', () => {
    renderWith([{ responseId: GUESTS[0]!.id, seat: 0 }]);
    const row = screen.getByRole('button', { name: /^Élodie Marchand/ });
    expect(within(row).getByText('Arrivé')).toBeInTheDocument();
  });

  it('distingue le siège de l’hôte de celui de son accompagnante', () => {
    // L'accompagnante est pointée, pas l'hôte : confondre les deux sièges
    // ferait entrer quelqu'un qui n'est pas là.
    renderWith([{ responseId: GUESTS[0]!.id, seat: 1 }]);

    const host = screen.getByRole('button', { name: /^Élodie Marchand/ });
    const companion = screen.getByRole('button', { name: /Jacqueline Marchand/ });
    expect(within(host).getByText('Attendu')).toBeInTheDocument();
    expect(within(companion).getByText('Arrivé')).toBeInTheDocument();
  });

  it('compte les arrivées retrouvées dans le compteur de salle', () => {
    renderWith([
      { responseId: GUESTS[0]!.id, seat: 0 },
      { responseId: GUESTS[0]!.id, seat: 1 },
    ]);
    // Le compteur de salle, pas les pastilles de filtre : « 2 » tout seul
    // apparaît à plusieurs endroits de l'écran.
    const counter = screen.getByText(/personnes présentes/).closest('p');
    expect(counter?.textContent).toMatch(/^2\s*personnes présentes/);
  });
});

// ---------------------------------------------------------------------------
// La barre du bas, le mode « Départs » et l'invité de dernière minute
// ---------------------------------------------------------------------------


/** Adresse d'une requête simulée, quelle que soit sa forme. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Corps JSON d'une requête simulée — toujours une chaîne dans ce composant. */
function bodyOf<T>(init: RequestInit | undefined): T {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as T;
}

const WALKIN_FIELDS = [
  { id: 'nom', label: 'Quel est votre nom ?', type: 'text', role: 'identity' },
  { id: 'prenom', label: 'Quel est votre prénom ?', type: 'text', role: 'identity' },
  { id: 'societe', label: 'Société', type: 'text', role: 'detail' },
] as const;

function renderFullDesk(extra: Partial<Parameters<typeof Desk>[0]> = {}) {
  return render(
    <Desk
      counting
      guests={GUESTS}
      initialStates={[]}
      printHref="/accueil/abc/impression"
      surveyId="abc"
      title="Soirée des 180 ans"
      walkinFields={WALKIN_FIELDS}
      {...extra}
    />,
  );
}

describe('barre du bas', () => {
  it('porte la recherche ET le bouton d’ajout, nommé', () => {
    const { container } = renderFullDesk();
    const dock = container.querySelector('.sp-desk__dock')!;
    expect(within(dock as HTMLElement).getByLabelText('Rechercher un invité')).toBeInTheDocument();
    expect(
      within(dock as HTMLElement).getByRole('button', {
        name: 'Ajouter un invité de dernière minute',
      }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('mode « Départs »', () => {
  it('ne présente aucune violation détectable', async () => {
    const { container } = renderFullDesk({ initialMode: 'departures' });
    await expectNoA11yViolations(container);
  });

  it('dit en toutes lettres ce que fait un appui, et le bouton du mode est enfoncé', () => {
    renderFullDesk({ initialMode: 'departures' });
    expect(screen.getByRole('button', { name: 'Départs · cadeau' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByText(/un appui sur une rangée enregistre la remise du cadeau/),
    ).toBeInTheDocument();
  });

  it('un appui remet le cadeau, et n’enregistre AUCUNE arrivée', async () => {
    const sent: unknown[] = [];
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') {
        const body = bodyOf<{ responseId: string; seat: number }>(init);
        sent.push(body);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              responseId: body.responseId,
              seat: body.seat,
              arrivedAt: null,
              giftAt: new Date().toISOString(),
              version: 1,
              updatedAt: new Date().toISOString(),
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ states: [], at: new Date().toISOString() })),
      );
    });

    renderFullDesk({ initialMode: 'departures' });
    await userEvent.click(screen.getByRole('button', { name: /^Élodie Marchand/ }));

    const row = screen.getByRole('button', { name: /^Élodie Marchand/ });
    expect(within(row).getByText('Cadeau remis')).toBeInTheDocument();
    expect(sent).toEqual([expect.objectContaining({ kind: 'gift', arrived: true, seat: 0 })]);
    // La personne n'avait pas été pointée à l'entrée : la sortie le dit.
    expect(within(row).getByText(/non pointé à l’entrée/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Élodie Marchand — cadeau remis');
  });

  it('basculer de mode le dit, et réécrit l’URL sans perdre l’essai à blanc', async () => {
    window.history.replaceState(null, '', '/accueil/abc?essai=1');
    renderFullDesk({ rehearsal: true });
    await userEvent.click(screen.getByRole('button', { name: 'Départs · cadeau' }));

    expect(window.location.search).toBe('?essai=1&mode=departs');
    expect(screen.getByRole('status')).toHaveTextContent(/remise du cadeau/);

    await userEvent.click(screen.getByRole('button', { name: 'Arrivées' }));
    expect(window.location.search).toBe('?essai=1');
  });

  it('en essai à blanc, remettre un cadeau GARDE l’arrivée pointée avant', async () => {
    renderFullDesk({ rehearsal: true });
    await userEvent.click(screen.getByRole('button', { name: /^Élodie Marchand/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Départs · cadeau' }));
    await userEvent.click(screen.getByRole('button', { name: /^Élodie Marchand/ }));

    const row = screen.getByRole('button', { name: /^Élodie Marchand/ });
    expect(within(row).getByText('Cadeau remis')).toBeInTheDocument();
    expect(within(row).queryByText(/non pointé à l’entrée/)).not.toBeInTheDocument();
  });
});

describe('invité de dernière minute', () => {
  it('le (+) ouvre un formulaire nommé, aux intitulés de l’organisation', async () => {
    const { container } = renderFullDesk();
    const add = screen.getByRole('button', { name: 'Ajouter un invité de dernière minute' });
    await userEvent.click(add);

    expect(add).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Invité de dernière minute' })).toBeInTheDocument();
    expect(screen.getByLabelText('Quel est votre nom ?')).toHaveFocus();
    expect(screen.getByLabelText('Quel est votre prénom ?')).toBeInTheDocument();
    expect(screen.getByLabelText('Société')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('Échap referme, et le focus revient au (+)', async () => {
    renderFullDesk();
    const add = screen.getByRole('button', { name: 'Ajouter un invité de dernière minute' });
    await userEvent.click(add);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Invité de dernière minute' })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(add).toHaveFocus());
  });

  it('refuse un ajout sans nom, en nommant la question', async () => {
    renderFullDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un invité de dernière minute' }));
    await userEvent.type(screen.getByLabelText('Société'), 'Atelier Martin');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter et pointer' }));

    expect(screen.getByText('Remplissez au moins « Quel est votre nom ? ».')).toBeInTheDocument();
  });

  it('ajoute la personne à la liste, arrivée, et le dit', async () => {
    const fetchMock = vi.mocked(fetch);
    let posted: unknown = null;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'POST' && urlOf(input).endsWith('/invite')) {
        posted = bodyOf<unknown>(init);
        const id = '44444444-4444-4444-4444-444444444444';
        return Promise.resolve(
          new Response(
            JSON.stringify({
              replayed: false,
              guest: {
                id,
                submittedAt: new Date().toISOString(),
                name: 'Martin Lucie',
                initials: 'ML',
                detail: 'Atelier Martin',
                companion: null,
                status: 'unknown',
                people: 1,
                ambiguous: false,
                walkIn: true,
              },
              state: {
                responseId: id,
                seat: 0,
                arrivedAt: new Date().toISOString(),
                giftAt: null,
                version: 1,
                updatedAt: new Date().toISOString(),
              },
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ states: [], at: new Date().toISOString() })),
      );
    });

    renderFullDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un invité de dernière minute' }));
    await userEvent.type(screen.getByLabelText('Quel est votre nom ?'), 'Martin');
    await userEvent.type(screen.getByLabelText('Quel est votre prénom ?'), 'Lucie');
    await userEvent.type(screen.getByLabelText('Société'), 'Atelier Martin');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter et pointer' }));

    const row = await screen.findByRole('button', { name: /^Martin Lucie/ });
    expect(within(row).getByText('Arrivé')).toBeInTheDocument();
    expect(within(row).getByText(/ajouté à l’entrée/)).toBeInTheDocument();
    const sent = posted as { opId: unknown; values: unknown } | null;
    expect(typeof sent?.opId).toBe('string');
    expect(sent?.values).toEqual({ nom: 'Martin', prenom: 'Lucie', societe: 'Atelier Martin' });
    expect(screen.getByRole('status')).toHaveTextContent('Martin Lucie — ajouté et pointé arrivé');
    expect(screen.queryByRole('region', { name: 'Invité de dernière minute' })).not.toBeInTheDocument();
  });

  it('un échec réseau garde la saisie, et le réessai porte le MÊME identifiant', async () => {
    const fetchMock = vi.mocked(fetch);
    const opIds: string[] = [];
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'POST' && urlOf(input).endsWith('/invite')) {
        opIds.push(bodyOf<{ opId: string }>(init).opId);
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ states: [], at: new Date().toISOString() })),
      );
    });

    renderFullDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un invité de dernière minute' }));
    await userEvent.type(screen.getByLabelText('Quel est votre nom ?'), 'Martin');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter et pointer' }));

    expect(await screen.findByText(/Pas de réseau/)).toBeInTheDocument();
    expect(screen.getByLabelText('Quel est votre nom ?')).toHaveValue('Martin');

    await userEvent.click(screen.getByRole('button', { name: 'Ajouter et pointer' }));
    await vi.waitFor(() => expect(opIds).toHaveLength(2));
    // Sans ce même identifiant, un réessai après coupure créerait un homonyme.
    expect(opIds[1]).toBe(opIds[0]);
  });

  it('une réponse `200` sans rapport — un portail captif — n’ajoute personne', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input, init) =>
      Promise.resolve(
        init?.method === 'POST' && urlOf(input).endsWith('/invite')
          ? new Response('<html>Connexion au wifi</html>')
          : new Response(JSON.stringify({ states: [], at: new Date().toISOString() })),
      ),
    );

    renderFullDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un invité de dernière minute' }));
    await userEvent.type(screen.getByLabelText('Quel est votre nom ?'), 'Martin');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter et pointer' }));

    expect(await screen.findByText(/n’a pas été ajoutée/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Martin/ })).not.toBeInTheDocument();
  });

  it('sans question qui nomme, le (+) explique au lieu de proposer un formulaire', async () => {
    renderFullDesk({ walkinFields: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un invité de dernière minute' }));
    expect(screen.getByText(/Aucune question ne nomme les invités/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter et pointer' })).not.toBeInTheDocument();
  });

  it('une personne ajoutée sur un AUTRE poste apparaît au delta suivant', async () => {
    const fetchMock = vi.mocked(fetch);
    const id = '55555555-5555-5555-5555-555555555555';
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            states: [
              {
                responseId: id,
                seat: 0,
                arrivedAt: '2026-11-18T19:00:00.000Z',
                giftAt: null,
                version: 1,
                updatedAt: '2026-11-18T19:00:00.000Z',
              },
            ],
            guests: [
              {
                id,
                submittedAt: '2026-11-18T19:00:00.000Z',
                name: 'Paul Arnaud',
                initials: 'PA',
                detail: null,
                companion: null,
                status: 'unknown',
                people: 1,
                ambiguous: false,
                walkIn: true,
              },
            ],
            at: new Date().toISOString(),
          }),
        ),
      ),
    );

    renderFullDesk();
    const row = await screen.findByRole('button', { name: /^Paul Arnaud/ });
    expect(within(row).getByText('Arrivé')).toBeInTheDocument();
  });
});
