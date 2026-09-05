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

/**
 * Cascade : un défaut d'élément ne doit jamais l'emporter sur un composant.
 *
 * Ce bloc existe à cause d'un défaut réel. Les tokens étaient tous conformes —
 * « blanc sur azur foncé » passait les 4,5:1 — mais `a:hover` (spécificité
 * 0,1,1) battait `.sp-btn` (0,1,0) : au survol, le libellé d'un bouton plein
 * était repeint en `--sp-accent-hover` sur un fond `--sp-accent-hover`, soit
 * un rapport de 1:1 mesuré dans un navigateur. Un bouton vide.
 *
 * Vérifier des paires de couleurs ne suffit donc pas : il faut vérifier QUI
 * gagne. La règle structurelle retenue est la plus simple qui ferme la
 * famille entière de ce défaut — tout défaut d'élément portant une couleur
 * doit être enveloppé dans `:where()`, donc de spécificité nulle.
 */
describe('cascade : les composants l’emportent sur les défauts d’élément', () => {
  /** Règles de premier niveau, `@media` aplaties. */
  const rules = (() => {
    const flat = css
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/@media[^{]*\{/g, ' ');
    const found: Array<{ selector: string; body: string }> = [];
    const re = /([^{}]+)\{([^{}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(flat)) !== null) {
      found.push({ selector: match[1]!.trim(), body: match[2]!.trim() });
    }
    return found;
  })();

  it('trouve bien les règles du fichier', () => {
    // Garde-fou du garde-fou : une analyse qui ne lit rien passerait toujours.
    expect(rules.length).toBeGreaterThan(80);
    expect(rules.some((rule) => rule.selector === '.sp-btn')).toBe(true);
  });

  /**
   * `html` et `body` sont admis : aucun composant `sp-` ne s'applique à eux,
   * et `body` porte les couleurs héritées de toute la page.
   */
  const ALLOWED_BARE = new Set(['html', 'body']);

  /** Sélecteur d'élément nu, éventuellement suivi de pseudo-classes. */
  const BARE_ELEMENT = /^[a-z][a-zA-Z0-9]*(?::{1,2}[a-zA-Z-]+(?:\([^)]*\))?)*$/;

  /**
   * Découpe une liste de sélecteurs sur les virgules de PREMIER niveau.
   * Un `split(',')` naïf ferait de `:where(h1, h2)` deux sélecteurs nus `h1`
   * et `h2` — et signalerait comme défaut exactement ce qui le corrige.
   */
  function topLevelParts(selector: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of selector) {
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;

      if (character === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += character;
    }
    if (current.trim() !== '') parts.push(current.trim());
    return parts;
  }

  const colouringBareRules = rules.flatMap((rule) =>
    topLevelParts(rule.selector)
      .filter(
        (part) =>
          BARE_ELEMENT.test(part) &&
          !ALLOWED_BARE.has(part) &&
          /(?:^|;|\s)(?:color|background(?:-color)?)\s*:/.test(rule.body),
      )
      .map((part) => `${part} { ${rule.body} }`),
  );

  it('aucun sélecteur d’élément nu ne peint une couleur', () => {
    expect(
      colouringBareRules,
      'Ces règles peuvent battre un composant `sp-` dès qu’une pseudo-classe ' +
        's’y ajoute. Envelopper le sélecteur dans `:where()`.',
    ).toEqual([]);
  });

  it('le défaut de lien reste à spécificité nulle', () => {
    // Le défaut d'origine, nommé : `a:hover` non enveloppé rendait invisible
    // le libellé de tout bouton plein rendu comme un lien.
    expect(css).toMatch(/:where\(a\)\s*\{/);
    expect(css).toMatch(/:where\(a:hover\)\s*\{/);
    expect(css).not.toMatch(/(?:^|\n)a:hover\s*\{/);
    expect(css).not.toMatch(/(?:^|\n)a\s*\{/);
  });

  it('le texte des boutons pleins n’est défini que par leur propre classe', () => {
    // `.sp-btn` fixe `color: var(--_fg)` ; aucune variante ne doit redéfinir
    // la couleur du texte d'un bouton PLEIN, dont la charte impose le blanc.
    const filled = rules.filter(
      (rule) =>
        /^\.sp-btn(--(?:danger|sm|lg|block))?(:[a-z-]+)*$/.test(rule.selector) &&
        /--_fg\s*:/.test(rule.body),
    );
    for (const rule of filled) {
      expect(
        rule.body,
        `${rule.selector} redéfinit le texte d’un bouton plein`,
      ).toMatch(/--_fg:\s*var\(--sp-on-accent\)/);
    }
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
