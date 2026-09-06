import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Callout, Example } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Steps } from '@/components/ui/Steps';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Primitives de la refonte.
 *
 * Ces composants existent pour rendre l'interface plus accueillante ; s'ils la
 * rendaient moins praticable au clavier ou au lecteur d'écran, ils échoueraient
 * à leur raison d'être. D'où des tests qui portent sur le COMPORTEMENT — ouvrir,
 * fermer, annoncer — et pas seulement sur l'absence de violation axe.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/admin' }));

describe('aide contextuelle', () => {
  it('ne signale aucune violation, ouverte comme fermée', async () => {
    const { container } = render(
      <p>
        Durée de conservation{' '}
        <Tooltip label="durée de conservation">
          Au-delà de ce délai, les réponses sont effacées automatiquement.
        </Tooltip>
      </p>,
    );
    await expectNoA11yViolations(container);

    await userEvent.setup().click(screen.getByRole('button'));
    await expectNoA11yViolations(container);
  });

  it('s’ouvre au clavier, pas seulement à la souris', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="durée de conservation">Les réponses sont ensuite effacées.</Tooltip>,
    );

    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await user.tab();
    expect(button).toHaveFocus();
    // Le focus suffit : une aide qui n'apparaîtrait qu'au survol serait
    // inatteignable au clavier et au toucher.
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('note')).toBeTruthy();
  });

  it('se referme par Échap sans déplacer le focus (WCAG 1.4.13)', async () => {
    const user = userEvent.setup();
    render(<Tooltip label="aide">Contenu de l’aide.</Tooltip>);

    const button = screen.getByRole('button');
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button).toHaveFocus();
  });

  it('s’ouvre au clic à la souris, et ne se referme pas aussitôt', async () => {
    // Défaut réel corrigé : le focus provoqué par le clic ouvrait la bulle,
    // puis le clic la refermait dans le même geste — le bouton paraissait
    // inerte à la souris.
    const user = userEvent.setup();
    render(<Tooltip label="aide">Contenu.</Tooltip>);

    const button = screen.getByRole('button');
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    // Un second clic désépingle. La bulle reste visible tant que le pointeur
    // est sur le bouton — c'est le survol qui la tient, et c'est voulu : la
    // faire disparaître sous le pointeur serait déroutant.
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    await user.unhover(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('reste ouverte quand le pointeur s’écarte d’une bulle épinglée', async () => {
    const user = userEvent.setup();
    render(<Tooltip label="aide">Contenu à lire.</Tooltip>);

    const button = screen.getByRole('button');
    await user.click(button);
    await user.unhover(button);

    // Le survol et l'épinglage sont indépendants : sinon la bulle
    // disparaîtrait dès qu'on écarte le pointeur pour la lire.
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('annonce ce que l’aide décrit, pas un « ? » isolé', () => {
    render(<Tooltip label="durée de conservation">Contenu.</Tooltip>);
    expect(screen.getByRole('button', { name: 'Aide : durée de conservation' })).toBeTruthy();
  });
});

describe('avancement', () => {
  it('écrit la position au lieu de la porter par la seule longueur', () => {
    render(<Steps current={2} total={5} label="Informations légales" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('Étape 2 sur 5 — Informations légales');
    expect(screen.getByText('2 / 5')).toBeTruthy();
  });

  it.each([
    [0, 5, '1'],
    [9, 5, '5'],
    [3, 0, '1'],
  ])('borne une position hors limites (%s sur %s → %s)', (current, total, expected) => {
    render(<Steps current={current} total={total} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(expected);
  });

  it('ne signale aucune violation', async () => {
    const { container } = render(<Steps current={1} total={4} label="Titre" />);
    await expectNoA11yViolations(container);
  });
});

describe('en-tête, encadré et état vide', () => {
  it('ne signale aucune violation sur un en-tête complet', async () => {
    const { container } = render(
      <PageHeader
        title="Formulaires"
        lead="Créez un formulaire, publiez-le, suivez les réponses."
        crumbs={[{ label: 'Espace', href: '/admin' }, { label: 'Formulaires' }]}
        meta={<span className="sp-badge">Brouillon</span>}
        actions={<button className="sp-btn" type="button">Nouveau</button>}
      />,
    );
    await expectNoA11yViolations(container);
    expect(screen.getByRole('heading', { level: 1, name: 'Formulaires' })).toBeTruthy();

    // Un seul lien de retour, vers le parent — pas la chaîne entière. Un fil
    // d'Ariane complet est une phrase qu'il faut lire pour en extraire un mot,
    // alors que ce qu'on cherche est presque toujours « remonter d'un cran ».
    const back = screen.getByRole('link', { name: 'Espace' });
    expect(back).toHaveAttribute('href', '/admin');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('ne rend aucun retour quand le parent n’a pas d’adresse', () => {
    // Un « retour » qui ne mène nulle part est pire qu'un retour absent.
    render(<PageHeader title="Formulaires" crumbs={[{ label: 'Formulaires' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('n’annonce pas un encadré explicatif comme un message d’état', async () => {
    // Un encadré est du contenu permanent : lui donner `role="alert"`
    // interromprait le lecteur d'écran à chaque affichage de la page.
    const { container } = render(
      <Callout title="À quoi ça sert">
        Cette durée déclenche l’effacement automatique.
        <Example>365 jours pour une inscription à un événement.</Example>
      </Callout>,
    );
    await expectNoA11yViolations(container);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('propose une issue plutôt que de constater l’absence', async () => {
    const { container } = render(
      <EmptyState
        title="Aucun formulaire pour l’instant"
        lead="Créez-en un pour commencer : vierge, ou à partir d’un modèle."
        action={<button className="sp-btn" type="button">Nouveau formulaire</button>}
      />,
    );
    await expectNoA11yViolations(container);
    expect(screen.getByRole('button', { name: 'Nouveau formulaire' })).toBeTruthy();
  });
});

describe('bouton d’envoi', () => {
  it('reste un bouton d’envoi ordinaire hors envoi', async () => {
    const { container } = render(
      <form>
        <SubmitButton>Créer</SubmitButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Créer' });
    expect(button.getAttribute('type')).toBe('submit');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await expectNoA11yViolations(container);
  });
});
