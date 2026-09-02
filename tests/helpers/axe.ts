import axe, { type AxeResults, type RunOptions } from 'axe-core';
import { expect } from 'vitest';

/**
 * Exécute axe-core sur un conteneur DOM et échoue avec un rapport lisible.
 * Règles WCAG 2.1 A + AA uniquement : c'est la cible déclarée de la plateforme.
 */
export async function expectNoA11yViolations(
  container: Element,
  options: RunOptions = {},
): Promise<AxeResults> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    ...options,
  });

  if (results.violations.length > 0) {
    const report = results.violations
      .map((v) => {
        const nodes = v.nodes.map((n) => `      - ${n.html}`).join('\n');
        return `  [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}\n${nodes}`;
      })
      .join('\n');
    expect.fail(`${results.violations.length} violation(s) d'accessibilité :\n${report}`);
  }

  return results;
}
