import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogoUpload } from '@/components/admin/LogoUpload';
import { logoPublicUrl } from '@/lib/organisation/logo';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Dépôt du logo : fichier ou lien.
 *
 * Ce qui compte ici est que les DEUX chemins restent praticables au clavier,
 * et que la valeur finalement enregistrée voyage bien dans le formulaire —
 * sinon le composant paraîtrait fonctionner et le profil ne changerait pas.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const SUPABASE = 'https://exemple.supabase.co';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'cle-anonyme-de-test');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://exemple.test');
});

/** Valeur qui partira dans l'action serveur. */
function hiddenValue(container: HTMLElement): string {
  const field = container.querySelector<HTMLInputElement>('input[name="logoUrl"]');
  if (!field) throw new Error('Champ caché logoUrl absent');
  return field.value;
}

describe('choix du mode', () => {
  it('ne signale aucune violation, dans les deux modes', async () => {
    const user = userEvent.setup();
    const { container } = render(<LogoUpload organisationId={ORG} value={null} />);

    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('radio', { name: /Indiquer un lien/ }));
    await expectNoA11yViolations(container);
  });

  it('propose le dépôt par défaut pour une organisation sans logo', () => {
    render(<LogoUpload organisationId={ORG} value={null} />);
    const file: HTMLInputElement = screen.getByRole('radio', { name: /Déposer un fichier/ });
    expect(file.checked).toBe(true);
    expect(screen.getByLabelText(/Fichier du logo/)).toBeTruthy();
  });

  it('rouvre sur le mode « lien » quand le logo actuel est externe', () => {
    // Réafficher le mode « fichier » sur un logo externe laisserait croire
    // qu'il a été déposé ici, et le champ d'adresse serait introuvable.
    render(<LogoUpload organisationId={ORG} value="https://spie.test/logo.png" />);
    const link: HTMLInputElement = screen.getByRole('radio', { name: /Indiquer un lien/ });
    expect(link.checked).toBe(true);
    expect(screen.getByLabelText(/Adresse de l’image/)).toHaveValue(
      'https://spie.test/logo.png',
    );
  });

  it('rouvre sur le mode « fichier » quand le logo est hébergé par la plateforme', () => {
    const url = logoPublicUrl(SUPABASE, `${ORG}/20260906T091530-abc123.png`);
    render(<LogoUpload organisationId={ORG} value={url} />);
    const file: HTMLInputElement = screen.getByRole('radio', { name: /Déposer un fichier/ });
    expect(file.checked).toBe(true);
    expect(screen.getByText('Logo hébergé par la plateforme.')).toBeTruthy();
  });
});

describe('valeur transmise au formulaire', () => {
  it('reporte le lien saisi dans le champ envoyé', async () => {
    const user = userEvent.setup();
    const { container } = render(<LogoUpload organisationId={ORG} value={null} />);

    await user.click(screen.getByRole('radio', { name: /Indiquer un lien/ }));
    await user.type(screen.getByLabelText(/Adresse de l’image/), 'https://spie.test/l.png');

    // Sans ce report, le composant paraîtrait fonctionner et le profil ne
    // changerait pas.
    expect(hiddenValue(container)).toBe('https://spie.test/l.png');
  });

  it('vide le champ envoyé quand le logo est retiré', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LogoUpload organisationId={ORG} value="https://spie.test/logo.png" />,
    );
    expect(hiddenValue(container)).toBe('https://spie.test/logo.png');

    await user.click(screen.getByRole('button', { name: 'Retirer le logo' }));
    expect(hiddenValue(container)).toBe('');
  });
});

describe('contraintes annoncées', () => {
  it('n’accepte pas le SVG, et dit pourquoi', () => {
    render(<LogoUpload organisationId={ORG} value={null} />);
    const input = screen.getByLabelText(/Fichier du logo/);
    expect(input.getAttribute('accept')).toContain('image/png');
    expect(input.getAttribute('accept')).not.toContain('svg');
    expect(screen.getByText(/peut contenir du code/)).toBeTruthy();
  });

  it('avertit que le lien externe expose l’adresse IP des répondants', () => {
    // C'est une conséquence que l'organisation ne peut pas deviner, et qui
    // relève de sa propre conformité.
    render(<LogoUpload organisationId={ORG} value={null} />);
    expect(screen.getByText(/adresse IP de chaque répondant/)).toBeTruthy();
  });
});
