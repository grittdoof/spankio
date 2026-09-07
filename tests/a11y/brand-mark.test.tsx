import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandMark } from '@/components/ui/BrandMark';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Marque d'une organisation.
 *
 * Ce qui compte : que le logo remplace bien l'initiale quand il existe, et
 * qu'aucune des deux formes ne soit annoncée — le nom écrit juste à côté
 * porte déjà l'information, et le répéter ferait entendre
 * « S Spie batignolles ».
 */

describe('sans logo', () => {
  it('affiche l’initiale du nom', () => {
    const { container } = render(
      <BrandMark className="sp-sidebar__mark" name="Spie batignolles" />,
    );
    expect(container.textContent).toBe('S');
  });

  it('n’annonce rien', async () => {
    const { container } = render(
      <p>
        <BrandMark className="sp-sidebar__mark" name="Spie batignolles" />
        Spie batignolles
      </p>,
    );
    // Une seule occurrence du nom pour un lecteur d'écran.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await expectNoA11yViolations(container);
  });

  it.each([
    ['une chaîne vide', '', '·'],
    ['des espaces seuls', '   ', '·'],
    ['un nom accentué', 'École des Mines', 'É'],
    ['un nom en minuscule', 'spie', 'S'],
  ])('se replie proprement sur %s', (_label, name, expected) => {
    const { container } = render(<BrandMark className="m" name={name} />);
    expect(container.textContent).toBe(expected);
  });

  it('prend le premier CARACTÈRE, pas le premier octet', () => {
    // Un emoji ou un caractère hors du plan de base occupe deux unités de
    // code : `name[0]` en couperait la moitié et afficherait un losange.
    const { container } = render(<BrandMark className="m" name="🌱 Graine" />);
    expect(container.textContent).toBe('🌱');
  });
});

describe('avec logo', () => {
  const LOGO = 'https://exemple.test/logo.png';

  it('remplace l’initiale par l’image', () => {
    const { container } = render(
      <BrandMark className="sp-sidebar__mark" logoUrl={LOGO} name="Spie batignolles" />,
    );
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(LOGO);
    expect(container.textContent).toBe('');
  });

  it('reste décoratif : aucun texte de remplacement', async () => {
    // Le nom est écrit à côté. Décrire le logo le ferait entendre deux fois.
    const { container } = render(
      <p>
        <BrandMark className="sp-sidebar__mark" logoUrl={LOGO} name="Spie batignolles" />
        Spie batignolles
      </p>,
    );
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
    await expectNoA11yViolations(container);
  });

  it('garde la classe de dimensionnement, que le CSS distingue par l’élément', () => {
    const { container } = render(
      <BrandMark className="sp-sidebar__mark" logoUrl={LOGO} name="Org" />,
    );
    expect(container.querySelector('img.sp-sidebar__mark')).not.toBeNull();
  });

  it.each([null, undefined, '', '   '])(
    'retombe sur l’initiale pour une URL vide (%s)',
    (logoUrl) => {
      const { container } = render(
        <BrandMark className="m" logoUrl={logoUrl} name="Spie batignolles" />,
      );
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe('S');
    },
  );
});
