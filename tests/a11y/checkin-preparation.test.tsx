import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckinReadiness } from '@/components/admin/CheckinReadiness';
import { CheckinInvitations } from '@/components/admin/CheckinInvitations';
import { CheckinStaff } from '@/components/admin/CheckinStaff';
import { CheckinAccountForm } from '@/components/admin/CheckinAccountForm';
import { CheckinShare } from '@/components/admin/CheckinShare';
import { CheckinPrint } from '@/components/admin/CheckinPrint';
import { Desk } from '@/components/checkin/Desk';
import { checkinReadiness, type StaffMember } from '@/lib/checkin/readiness';
import type { StaffAccountState } from '@/lib/checkin/account';
import type { GuestRow } from '@/lib/survey/guests';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Accessibilité de l'écran de préparation, et du mode répétition.
 *
 * Ce qui est réellement vérifié au-delà d'axe : qu'aucun état n'est porté par
 * la seule couleur. « Prêt », « À savoir » et « Bloquant » sont trois pastilles
 * vert, ambre et rouge — exactement le cas où un écran devient muet pour une
 * partie des gens si le mot n'est pas écrit.
 */

const STAFF: StaffMember[] = [
  {
    profileId: '11111111-1111-1111-1111-111111111111',
    name: 'Camille Roux',
    email: 'camille@test.local',
    expiresAt: '2026-11-20T23:59:59.000Z',
    firstSeenAt: '2026-11-17T09:00:00.000Z',
    lastSeenAt: '2026-11-17T18:30:00.000Z',
  },
  {
    profileId: '22222222-2222-2222-2222-222222222222',
    name: 'Sacha Lemoine',
    email: 'sacha@test.local',
    expiresAt: null,
    firstSeenAt: null,
    lastSeenAt: null,
  },
];

const READINESS = checkinReadiness({
  moduleGranted: true,
  staff: STAFF,
  attendance: { identityField: 'nom' },
  responses: 12,
  startsAt: '2026-11-18T18:00:00.000Z',
});

describe('état de préparation', () => {
  it('ne présente aucune violation détectable', async () => {
    const { container } = render(
      <CheckinReadiness items={READINESS} settingsHref="/admin/sondages/abc/evenement" />,
    );
    await expectNoA11yViolations(container);
  });

  it('écrit l’état de chaque ligne, sans dépendre de la couleur', () => {
    render(<CheckinReadiness items={READINESS} settingsHref="/x" />);
    expect(screen.getAllByText('Prêt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('À savoir').length).toBeGreaterThan(0);
  });

  it('dit ce que chaque manque COÛTERA le soir même', () => {
    render(<CheckinReadiness items={READINESS} settingsHref="/x" />);
    // Une liste de manques sans conséquence se lit comme une liste de
    // corvées, et se remet à plus tard.
    expect(screen.getByText(/19 h 50/)).toBeInTheDocument();
    expect(screen.getByText(/sans dénominateur/)).toBeInTheDocument();
  });
});

describe('personnes affectées', () => {
  function renderStaff() {
    return render(
      <CheckinStaff
        assignAction={() => undefined}
        assignable={[
          {
            profileId: '33333333-3333-3333-3333-333333333333',
            name: 'Inès Berger',
            email: 'ines@test.local',
            role: 'host',
          },
        ]}
        deskUrl="https://exemple.test/accueil/abc"
        eventTitle="Soirée des 180 ans"
        identifierHost="accueil.exemple.test"
        resetAction={() => Promise.resolve({ status: 'idle' as const })}
        revokeAction={() => undefined}
        staff={STAFF}
        suggestedPassword="bako-tire-muso-47"
        surveyId="abc"
      />,
    );
  }

  it('ne présente aucune violation détectable', async () => {
    const { container } = renderStaff();
    await expectNoA11yViolations(container);
  });

  it('écrit qui s’est connecté et qui ne l’a jamais fait', () => {
    renderStaff();
    // Le fait qui vaut l'écran entier, et il doit se lire sans interpréter
    // une couleur.
    expect(screen.getByText(/Ne s’est jamais connectée/)).toBeInTheDocument();
    expect(screen.getByText(/S’est connectée/)).toBeInTheDocument();
  });

  it('nomme la personne dans le bouton de retrait', () => {
    renderStaff();
    // « Retirer » répété trois fois ne dit rien à qui n'a pas la rangée sous
    // les yeux.
    expect(
      screen.getByRole('button', { name: /Retirer l’affectation de Camille Roux/ }),
    ).toBeInTheDocument();
  });

  it('propose une option vide explicite dans la liste des personnes', () => {
    renderStaff();
    const select = screen.getByLabelText(/Personne à affecter/);
    // Un `select` dont la valeur ne correspond à aucune option affiche la
    // première : sans option vide, l'écran annoncerait quelqu'un qu'on n'a
    // pas choisi.
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: /Choisir une personne/ })).toBeInTheDocument();
  });
});

describe('essai à blanc', () => {
  const GUESTS: GuestRow[] = [
    {
      id: '44444444-4444-4444-4444-444444444444',
      submittedAt: '2026-11-18T18:00:00.000Z',
      name: 'Élodie Marchand',
      initials: 'ÉM',
      detail: null,
      status: 'attending',
      people: 1,
      ambiguous: false,
    },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('aucun réseau en répétition'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('se signale, et n’envoie rien', async () => {
    render(
      <Desk
        counting
        guests={GUESTS}
        initialStates={[]}
        printHref="/accueil/abc/impression"
        rehearsal
        surveyId="abc"
        title="Soirée des 180 ans"
      />,
    );

    expect(screen.getByText(/Essai à blanc/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Élodie Marchand/ }));

    // Pointé en local, et « Arrivé » tout court : laisser « envoi en cours »
    // afficherait indéfiniment un envoi qui n'aura jamais lieu.
    expect(screen.getByText('Arrivé')).toBeInTheDocument();
    expect(screen.queryByText(/en attente d’envoi/)).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('invitations à usage unique', () => {
  const NOW = '2026-11-18T10:00:00.000Z';

  function renderInvitations() {
    return render(
      <CheckinInvitations
        invitations={[
          {
            id: '55555555-5555-5555-5555-555555555555',
            email: 'camille@traiteur.test',
            expiresAt: '2026-11-25T10:00:00.000Z',
            staffExpiresAt: null,
            createdAt: '2026-11-17T09:00:00.000Z',
            claimedAt: null,
          },
          {
            id: '66666666-6666-6666-6666-666666666666',
            email: 'sacha@traiteur.test',
            expiresAt: '2026-11-25T10:00:00.000Z',
            staffExpiresAt: null,
            createdAt: '2026-11-16T09:00:00.000Z',
            claimedAt: '2026-11-16T10:30:00.000Z',
          },
          {
            id: '77777777-7777-7777-7777-777777777777',
            email: 'perime@traiteur.test',
            expiresAt: '2026-11-01T10:00:00.000Z',
            staffExpiresAt: null,
            createdAt: '2026-10-25T09:00:00.000Z',
            claimedAt: null,
          },
        ]}
        inviteAction={() => undefined}
        now={NOW}
        revokeAction={() => undefined}
        surveyId="abc"
      />,
    );
  }

  it('ne présente aucune violation détectable', async () => {
    const { container } = renderInvitations();
    await expectNoA11yViolations(container);
  });

  it('écrit les trois états, sans dépendre de la couleur', () => {
    renderInvitations();
    expect(screen.getByText(/En attente — expire le/)).toBeInTheDocument();
    expect(screen.getByText(/Utilisée le/)).toBeInTheDocument();
    expect(screen.getByText(/Expirée le/)).toBeInTheDocument();
  });

  it('n’affiche AUCUN jeton', () => {
    const { container } = renderInvitations();
    // Le lien n'existe en clair qu'au moment de l'envoi. S'il réapparaissait
    // ici, il se retrouverait dans un rendu serveur, donc potentiellement
    // dans un cache ou un journal.
    expect(container.textContent).not.toMatch(/jeton=/);
  });

  it('dit que le lien ne peut pas être réaffiché', () => {
    renderInvitations();
    // Un lien qu'on croit pouvoir retrouver plus tard est un lien qu'on ne
    // renvoie pas à temps.
    expect(screen.getByText(/ne peut pas être réaffiché/)).toBeInTheDocument();
  });

  it('dit pourquoi l’adresse compte', () => {
    renderInvitations();
    expect(screen.getByText(/lien transféré/)).toBeInTheDocument();
  });

  it('nomme la personne dans le bouton de retrait', () => {
    renderInvitations();
    expect(
      screen.getByRole('button', { name: /Retirer l’invitation de camille@traiteur.test/ }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Comptes de pointage, partage et listing
// ---------------------------------------------------------------------------

describe('créer un compte de pointage', () => {
  const DESK = 'https://exemple.test/accueil/abc';

  function renderForm(
    action: (state: StaffAccountState, formData: FormData) => Promise<StaffAccountState>,
  ) {
    return render(
      <CheckinAccountForm
        action={action}
        deskUrl={DESK}
        eventTitle="Soirée des 180 ans"
        suggestedPassword="bako-tire-muso-47"
        surveyId="abc"
      />,
    );
  }

  it('ne présente aucune violation détectable', async () => {
    const { container } = renderForm(() => Promise.resolve({ status: 'idle' as const }));
    await expectNoA11yViolations(container);
  });

  it('propose un mot de passe prêt à dicter, modifiable', () => {
    renderForm(() => Promise.resolve({ status: 'idle' as const }));
    const field = screen.getByLabelText('Mot de passe');
    expect(field).toHaveValue('bako-tire-muso-47');
    // En clair, délibérément : celui qui crée le compte doit le lire pour le
    // transmettre. Un champ masqué l'obligerait à le retaper ailleurs.
    expect(field).toHaveAttribute('type', 'text');
  });

  it('ne demande aucune adresse électronique', () => {
    // C'est tout l'intérêt : l'hôtesse n'a rien à fournir.
    renderForm(() => Promise.resolve({ status: 'idle' as const }));
    expect(screen.queryByLabelText(/adresse/i)).toBeNull();
  });

  it('remet le couple complet sous les yeux après création', async () => {
    const user = userEvent.setup();
    renderForm(() =>
      Promise.resolve({
        status: 'created' as const,
        label: 'Marie',
        identifier: 'marie.k3rt@accueil.exemple.test',
        password: 'bako-tire-muso-47',
      }),
    );

    await user.type(screen.getByLabelText('Nom du poste ou de la personne'), 'Marie');
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }));

    // Le message est composé une seule fois, par la même fonction que partout
    // ailleurs : lien, identifiant et mot de passe, prêts à être transmis.
    const message = await screen.findByText(/marie\.k3rt@accueil\.exemple\.test/);
    expect(message.textContent).toContain(DESK);
    expect(message.textContent).toContain('bako-tire-muso-47');
  });

  it('dit que le mot de passe ne se réaffichera pas', async () => {
    const user = userEvent.setup();
    renderForm(() =>
      Promise.resolve({
        status: 'created' as const,
        label: 'Marie',
        identifier: 'marie.k3rt@accueil.exemple.test',
        password: 'bako-tire-muso-47',
      }),
    );
    await user.type(screen.getByLabelText('Nom du poste ou de la personne'), 'Marie');
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }));

    expect(await screen.findByText(/ne se réaffichera pas/)).toBeInTheDocument();
  });
});

describe('partage et listing', () => {
  it('écrit toujours le lien du poste, sans dépendre du presse-papier', async () => {
    // Un bouton « Copier » qui serait le seul chemin rendrait le lien
    // inaccessible là où le presse-papier manque — c'est-à-dire souvent.
    const { container } = render(
      <CheckinShare deskUrl="https://exemple.test/accueil/abc" hasAccounts />,
    );
    expect(screen.getByText('https://exemple.test/accueil/abc')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('fait choisir le classement AVANT de générer', async () => {
    const { container } = render(
      <CheckinPrint
        defaultSort="nom"
        empty={false}
        options={[
          { value: 'inscription', label: 'Ordre d’inscription' },
          { value: 'nom', label: 'Nom' },
          { value: 'societe', label: 'Société' },
        ]}
        surveyId="abc"
      />,
    );

    expect(screen.getByLabelText('Classer les invités par')).toHaveValue('nom');
    expect(screen.getByRole('button', { name: 'Imprimer le listing' })).toBeEnabled();
    await expectNoA11yViolations(container);
  });

  it('n’offre pas d’imprimer une liste vide', () => {
    render(
      <CheckinPrint
        defaultSort="inscription"
        empty
        options={[{ value: 'inscription', label: 'Ordre d’inscription' }]}
        surveyId="abc"
      />,
    );
    expect(screen.getByRole('button', { name: 'Imprimer le listing' })).toBeDisabled();
  });
});
