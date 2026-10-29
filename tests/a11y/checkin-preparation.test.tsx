import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckinReadiness } from '@/components/admin/CheckinReadiness';
import { CheckinStaff } from '@/components/admin/CheckinStaff';
import { Desk } from '@/components/checkin/Desk';
import { checkinReadiness, type StaffMember } from '@/lib/checkin/readiness';
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
        revokeAction={() => undefined}
        staff={STAFF}
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
