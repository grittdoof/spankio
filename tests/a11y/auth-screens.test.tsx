import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInForm } from '@/components/auth/SignInForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import {
  NewPasswordForm,
  PasswordResetRequestForm,
} from '@/components/auth/PasswordResetForm';
import { MembershipRequestForm } from '@/components/auth/MembershipRequestForm';
import { MembershipDecision } from '@/components/super-admin/MembershipDecision';
import { fr } from '@/lib/i18n/fr';
import { expectNoA11yViolations } from '../helpers/axe';

const noop = () => {};

const organisations = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Organisation Alpha' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Organisation Bêta' },
];

const pendingRequest = {
  id: '33333333-3333-3333-3333-333333333333',
  requesterName: 'Camille Martin',
  requesterEmail: 'camille@exemple.test',
  organisationLabel: 'Organisation Alpha',
  createsOrganisation: true,
  requestedRole: 'editor',
  message: 'Je gère les inscriptions.',
  createdAt: '2026-09-01T10:00:00.000Z',
};

const modules = [
  { key: 'core', name: 'Sondages', isCore: true },
  { key: 'event', name: 'Événements et inscriptions', isCore: false },
];

describe('accessibilité des écrans d’authentification', () => {
  it('connexion : aucune violation axe', async () => {
    const { container } = render(<SignInForm action={noop} />);
    await expectNoA11yViolations(container);
  });

  it('connexion avec erreur : le message est annoncé comme alerte', async () => {
    const { container } = render(
      <SignInForm action={noop} error={fr.errors.invalidCredentials} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(fr.errors.invalidCredentials);
    await expectNoA11yViolations(container);
  });

  it('connexion avec confirmation : le message est annoncé comme état', () => {
    render(<SignInForm action={noop} notice={fr.auth.newPassword.updated} />);
    expect(screen.getByRole('status')).toHaveTextContent(fr.auth.newPassword.updated);
  });

  it('inscription : aucune violation axe', async () => {
    const { container } = render(<SignUpForm action={noop} />);
    await expectNoA11yViolations(container);
  });

  it('mot de passe oublié : aucune violation axe', async () => {
    const { container } = render(<PasswordResetRequestForm action={noop} />);
    await expectNoA11yViolations(container);
  });

  it('nouveau mot de passe : aucune violation axe', async () => {
    const { container } = render(<NewPasswordForm action={noop} />);
    await expectNoA11yViolations(container);
  });

  it('demande de rattachement : aucune violation axe', async () => {
    const { container } = render(
      <MembershipRequestForm action={noop} organisations={organisations} />,
    );
    await expectNoA11yViolations(container);
  });

  it('décision de rattachement : aucune violation axe', async () => {
    const { container } = render(
      <ul>
        <MembershipDecision
          request={pendingRequest}
          modules={modules}
          approveAction={noop}
          rejectAction={noop}
        />
      </ul>,
    );
    await expectNoA11yViolations(container);
  });
});

describe('étiquetage des champs', () => {
  it('chaque champ de connexion est atteignable par son libellé', () => {
    render(<SignInForm action={noop} />);
    expect(screen.getByLabelText(/Adresse électronique/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/Mot de passe/)).toHaveAttribute('type', 'password');
  });

  it('les champs portent les bons attributs d’auto-remplissage', () => {
    render(<SignInForm action={noop} />);
    expect(screen.getByLabelText(/Adresse électronique/)).toHaveAttribute(
      'autocomplete',
      'email',
    );
    expect(screen.getByLabelText(/Mot de passe/)).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
  });

  it('l’aide et l’erreur sont reliées au champ, pas seulement affichées', () => {
    render(<SignUpForm action={noop} />);
    const password = screen.getByLabelText(/Mot de passe/);
    const describedBy = password.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      fr.auth.signUp.passwordHint,
    );
  });

  it('les listes déroulantes sont de vraies <select> natives', () => {
    render(<MembershipRequestForm action={noop} organisations={organisations} />);
    const select = screen.getByLabelText(fr.auth.membershipRequest.existingOrganisationLabel);
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Organisation Alpha' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: fr.auth.membershipRequest.newOrganisationOption }),
    ).toBeInTheDocument();
  });

  it('le module core est présenté comme non décochable', () => {
    render(
      <ul>
        <MembershipDecision
          request={pendingRequest}
          modules={modules}
          approveAction={noop}
          rejectAction={noop}
        />
      </ul>,
    );
    const core = screen.getByRole('checkbox', { name: /Sondages/ });
    expect(core).toBeChecked();
    expect(core).toBeDisabled();

    const event = screen.getByRole('checkbox', { name: /Événements/ });
    expect(event).not.toBeChecked();
    expect(event).toBeEnabled();
  });

  it('le groupe de modules est un vrai fieldset avec légende', () => {
    render(
      <ul>
        <MembershipDecision
          request={pendingRequest}
          modules={modules}
          approveAction={noop}
          rejectAction={noop}
        />
      </ul>,
    );
    expect(
      screen.getByRole('group', { name: /Modules autorisés pour ce compte/ }),
    ).toBeInTheDocument();
  });
});

describe('navigation clavier', () => {
  it('parcourt les champs de connexion dans l’ordre visuel', async () => {
    const user = userEvent.setup();
    render(<SignInForm action={noop} />);

    // Le formulaire est rendu seul ici : le lien d'évitement appartient à la
    // mise en page racine. On part donc du premier champ.
    await user.tab();
    expect(screen.getByLabelText(/Adresse électronique/)).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText(/Mot de passe/)).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: fr.auth.signIn.submit })).toHaveFocus();
  });

  it('permet de saisir et d’envoyer entièrement au clavier', async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <SignInForm
        action={() => {
          submitted = true;
        }}
      />,
    );

    await user.click(screen.getByLabelText(/Adresse électronique/));
    await user.keyboard('camille@exemple.test');
    await user.tab();
    await user.keyboard('motdepassetreslong');
    await user.tab();
    await user.keyboard('{Enter}');

    expect(submitted).toBe(true);
  });

  it('sélectionne une organisation au clavier', async () => {
    const user = userEvent.setup();
    render(<MembershipRequestForm action={noop} organisations={organisations} />);
    const select = screen.getByLabelText(fr.auth.membershipRequest.existingOrganisationLabel);

    await user.selectOptions(select, organisations[1]!.id);
    expect(select).toHaveValue(organisations[1]!.id);
  });
});

describe('parcours sans rattachement', () => {
  it('annonce clairement qu’une demande est déjà en attente', () => {
    render(<MembershipRequestForm action={noop} organisations={organisations} pending />);
    expect(screen.getByRole('status')).toHaveTextContent(fr.auth.membershipRequest.pending);
    // Aucun formulaire proposé : rien à soumettre deux fois.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('n’emploie aucun vocabulaire sectoriel', () => {
    const { container } = render(
      <MembershipRequestForm action={noop} organisations={organisations} />,
    );
    expect(container.textContent).not.toMatch(/mairie|commune|citoyen|administré|élu/i);
  });
});
