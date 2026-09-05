import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WizardShell } from '@/components/admin/WizardShell';
import { Callout, Example } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { WIZARD_TOTAL, stepLabel } from '@/lib/admin/wizard';
import { LEGAL_BASIS_GUIDE } from '@/lib/survey/consent';
import { LEGAL_BASES } from '@/lib/services/surveys';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Parcours guidé.
 *
 * Un écran « une question à la fois » n'est un progrès que s'il reste
 * praticable : la position doit être annoncée, la sortie atteignable, et la
 * navigation faisable au clavier seul. Sinon on a simplement remplacé un long
 * formulaire par cinq courts, sans rien gagner.
 */

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function Screen({ back = '/admin/sondages?etape=1' }: { back?: string | null } = {}) {
  return (
    <form>
      <WizardShell
        step="informations"
        question="Qu’allez-vous dire aux répondants ?"
        lead="Ces informations sont affichées avant l’envoi et conservées avec chaque réponse."
        backHref={back}
        exitHref="/admin/sondages"
        exitLabel="Terminer plus tard"
        footer={<SubmitButton>Continuer</SubmitButton>}
      >
        <Field id="purpose" label="À quoi servent les réponses ?" required>
          {(attributes) => <textarea {...attributes} className="sp-textarea" name="purpose" />}
        </Field>
        <Callout title="Ce qui se passe ensuite">
          Le texte est repris dans la mention affichée aux répondants.
          <Example>Organiser l’assemblée générale.</Example>
        </Callout>
      </WizardShell>
    </form>
  );
}

describe('coquille du parcours', () => {
  it('ne signale aucune violation', async () => {
    const { container } = render(<Screen />);
    await expectNoA11yViolations(container);
  });

  it('annonce la position, pas seulement une barre', () => {
    render(<Screen />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe(
      `Étape 4 sur ${WIZARD_TOTAL} — ${stepLabel('informations')}`,
    );
    // La position est aussi ÉCRITE dans le corps de l'écran, pour qui ne voit
    // ni la barre ni ne l'atteint au lecteur d'écran.
    expect(screen.getByText(`Étape 4 sur ${WIZARD_TOTAL}`)).toBeTruthy();
  });

  it('donne une seule région principale et un titre de niveau 1', () => {
    render(<Screen />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Qu’allez-vous dire aux répondants ?' }),
    ).toBeTruthy();
  });

  it('offre toujours une sortie, et un retour sauf au premier écran', () => {
    const { unmount } = render(<Screen />);
    expect(screen.getByRole('link', { name: 'Terminer plus tard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour' })).toBeTruthy();
    unmount();

    render(<Screen back={null} />);
    // Un parcours dont on ne peut pas sortir est une impasse, pas un guide.
    expect(screen.getByRole('link', { name: 'Terminer plus tard' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Retour' })).toBeNull();
  });

  it('se parcourt entièrement au clavier, dans l’ordre de lecture', async () => {
    const user = userEvent.setup();
    render(<Screen />);

    // Ordre attendu : sortie, champ, puis navigation basse. L'avancement n'est
    // pas focusable — c'est une indication, pas une commande.
    await user.tab();
    expect(screen.getByRole('link', { name: 'Terminer plus tard' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText(/À quoi servent les réponses/)).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Retour' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Continuer' })).toHaveFocus();
  });
});

describe('choix en grandes cartes', () => {
  it('ne signale aucune violation et reste un groupe de boutons radio', async () => {
    const { container } = render(
      <fieldset className="sp-fieldset">
        <legend>Sur quoi repose cette collecte ?</legend>
        <ul className="sp-picks">
          {LEGAL_BASES.map((basis) => (
            <li key={basis}>
              <label className="sp-pick">
                <input defaultChecked={basis === 'consent'} name="legalBasis" type="radio" value={basis} />
                <span className="sp-pick__text">
                  <span className="sp-pick__name">{LEGAL_BASIS_GUIDE[basis].choice}</span>
                  <span className="sp-pick__desc">{LEGAL_BASIS_GUIDE[basis].when}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>,
    );

    await expectNoA11yViolations(container);
    expect(screen.getAllByRole('radio')).toHaveLength(LEGAL_BASES.length);
  });

  it('nomme chaque choix par son intitulé, pas par sa description entière', () => {
    render(
      <ul className="sp-picks">
        <li>
          <label className="sp-pick">
            <input name="k" type="radio" value="consent" />
            <span className="sp-pick__text">
              <span className="sp-pick__name">Consentement</span>
              <span className="sp-pick__desc">La personne est libre d’accepter.</span>
            </span>
          </label>
        </li>
      </ul>,
    );
    // Le nom accessible réunit intitulé et description : l'annonce commence
    // donc par ce qui distingue le choix.
    const radio = screen.getByRole('radio');
    expect(radio.closest('label')?.textContent?.startsWith('Consentement')).toBe(true);
  });

  it('couvre les six bases légales du RGPD, sans carte vide', () => {
    // Une base sans entrée dans le guide produirait un choix sans libellé.
    for (const basis of LEGAL_BASES) {
      expect(LEGAL_BASIS_GUIDE[basis].choice.length).toBeGreaterThan(2);
      expect(LEGAL_BASIS_GUIDE[basis].when.length).toBeGreaterThan(20);
    }
  });
});
