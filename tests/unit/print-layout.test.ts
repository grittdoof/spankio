import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Le pied des pages imprimées.
 *
 * Défaut réel signalé à l'usage : le pied était `position: fixed; bottom: 0`.
 * Un élément fixé est positionné par rapport à la ZONE DE PAGE — l'intérieur
 * des marges — et il y est redessiné sur CHAQUE feuille pendant que le tableau
 * continue de s'écouler dessous. Il se superposait donc aux dernières rangées
 * de chaque page, exactement là où l'on cherche un nom, et aucune marge ne
 * pouvait le corriger : le contenu occupe toute la zone de page par
 * définition.
 *
 * Ce que ces tests figent est donc la DÉCISION, pas le pixel : le pied
 * appartient au tableau, où le moteur lui réserve sa place avant de couper la
 * page. jsdom n'a pas de moteur de rendu et encore moins de pagination — il ne
 * peut pas montrer une superposition, et un test qui prétendrait la vérifier
 * ici serait un faux succès de plus. C'est la raison pour laquelle on vérifie
 * la structure et non l'apparence.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const CSS = read('src/app/globals.css');

/** Le bloc de règles d'un sélecteur, accolades comprises. */
function ruleFor(selector: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  let match = pattern.exec(CSS);
  while (match !== null) {
    blocks.push(match[1] ?? '');
    match = pattern.exec(CSS);
  }
  return blocks;
}

const PAGES = [
  'src/app/accueil/[id]/impression/page.tsx',
  'src/app/admin/(impression)/sondages/[id]/presence/page.tsx',
];

describe('le pied d’une page imprimée', () => {
  it('n’est jamais positionné hors du flux', () => {
    const blocks = ruleFor('.sp-print__foot');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/position\s*:\s*(fixed|absolute)/);
    }
  });

  it('se répète par le GROUPE DE PIED du tableau', () => {
    // C'est le seul mécanisme qui tienne les deux promesses à la fois : se
    // répéter en bas de chaque page, et ne rien recouvrir.
    expect(CSS).toMatch(/\.sp-print__table tfoot\s*\{\s*display:\s*table-footer-group/);
  });

  it('respecte une marge physique explicite', () => {
    // Plutôt que celle du navigateur : une liste nominative se range dans un
    // classeur, et le pied a besoin d'air sous lui.
    expect(CSS).toMatch(/@page\s*\{\s*margin:/);
  });

  it.each(PAGES)('%s place son pied dans le tableau', (page) => {
    const source = read(page);
    const foot = source.indexOf('sp-print__foot');
    const open = source.lastIndexOf('<tfoot>', foot);
    const close = source.indexOf('</tfoot>', foot);

    expect(foot).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(foot);
  });
});
