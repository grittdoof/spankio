import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  hexToOklch,
  oklchToHex,
  parseOklch,
} from '@/lib/design/color';
import {
  BRAND_HEX,
  CONTRAST_REQUIREMENTS,
  CSS_TOKEN_HEX,
} from '@/lib/design/tokens';

const cssPath = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/** Bloc `:root` uniquement : le thème sombre a ses propres valeurs. */
const rootBlock = (() => {
  const start = css.indexOf(':root {');
  expect(start, 'globals.css doit déclarer un bloc :root').toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
})();

function tokenValue(name: string): string {
  const re = new RegExp(`${name}:\\s*([^;]+);`);
  const match = re.exec(rootBlock);
  if (!match?.[1]) throw new Error(`Token ${name} absent du bloc :root`);
  return match[1].trim();
}

describe('conversions de couleur', () => {
  it('fait un aller-retour hex → oklch → hex sans perte visible', () => {
    for (const hex of Object.values(BRAND_HEX)) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex.toUpperCase());
    }
  });

  it('calcule les ratios de contraste de référence WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // Symétrique
    expect(contrastRatio('#2F6FDB', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#2F6FDB'),
      10,
    );
  });

  it('parse une déclaration oklch CSS', () => {
    expect(parseOklch('oklch(56.08% 0.1782 260.27)')).toEqual({
      l: 0.5608,
      c: 0.1782,
      h: 260.27,
    });
    expect(parseOklch('oklch(23% 0.01 270 / 6%)')).not.toBeNull();
    expect(parseOklch('#2F6FDB')).toBeNull();
  });
});

describe('globals.css est aligné sur la charte', () => {
  it('déclare color-scheme: light (app light-first)', () => {
    expect(rootBlock).toMatch(/color-scheme:\s*light/);
  });

  it("ne câble jamais le thème sombre sur prefers-color-scheme", () => {
    // Le mot peut apparaître en commentaire ; c'est la media query qui est interdite.
    expect(css).not.toMatch(/@media[^{]*prefers-color-scheme/);
  });

  it.each(Object.entries(CSS_TOKEN_HEX))(
    '%s correspond à %s',
    (token, expectedHex) => {
      const value = tokenValue(token);
      const oklch = parseOklch(value);
      expect(oklch, `${token} doit être exprimé en oklch, reçu « ${value} »`).not.toBeNull();
      expect(oklchToHex(oklch!)).toBe(expectedHex.toUpperCase());
    },
  );

  it('respecte les valeurs de forme et de mouvement imposées', () => {
    expect(tokenValue('--sp-radius-lg')).toBe('16px');
    expect(tokenValue('--sp-radius')).toBe('10px');
    expect(tokenValue('--sp-radius-sm')).toBe('8px');
    expect(tokenValue('--sp-ease')).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    expect(tokenValue('--sp-transition')).toBe('0.15s var(--sp-ease)');
    expect(tokenValue('--sp-sidebar-w')).toBe('248px');
    expect(tokenValue('--sp-tap')).toBe('44px');
    expect(tokenValue('--sp-text-body')).toMatch(/^0\.9375rem/); // 15px
    expect(tokenValue('--sp-leading')).toBe('1.5');
  });

  it('déclare Montserrat avec un repli system-ui', () => {
    const font = tokenValue('--sp-font');
    expect(font).toContain('montserrat');
    expect(font).toContain('system-ui');
  });

  it('neutralise les animations sous prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('utilise env(safe-area-inset-*) sur les barres fixes', () => {
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('env(safe-area-inset-top)');
  });

  it('garantit des cibles tactiles de 44px sur les boutons', () => {
    expect(css).toMatch(/\.sp-btn \{[\s\S]*?min-height: var\(--sp-tap\)/);
    expect(css).toMatch(/\.sp-btn \{[\s\S]*?min-width: var\(--sp-tap\)/);
  });
});

describe('contrastes WCAG 2.1 AA', () => {
  it.each(CONTRAST_REQUIREMENTS)(
    '$label ≥ $min:1',
    ({ foreground, background, min }) => {
      const ratio = contrastRatio(foreground, background);
      expect(
        Number(ratio.toFixed(2)),
        `${foreground} sur ${background} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(min);
    },
  );
});
