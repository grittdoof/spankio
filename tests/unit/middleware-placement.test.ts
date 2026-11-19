import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Où vit le middleware — et c'est un test de PLACEMENT, pas de comportement.
 *
 * Il existe parce que le fichier a vécu des mois à la racine du dépôt, où Next
 * ne le lit pas : avec un répertoire `src/`, seul `src/middleware.ts` est
 * exécuté. Rien ne le signalait. Le fichier compilait, se typait, passait
 * ESLint ; les espaces protégés paraissaient gardés parce que chaque `layout`
 * redirige de son côté ; et le rafraîchissement de session, lui, n'avait tout
 * simplement jamais lieu. Un middleware au mauvais endroit n'est pas un
 * middleware cassé, c'est un fichier mort qui ressemble à une protection.
 *
 * Aucun test de comportement ne pouvait l'attraper — ils importent la fonction
 * et l'appellent, ce qui marche parfaitement depuis n'importe quel chemin.
 * Celui-ci vérifie la seule chose qui manquait : que Next le trouve.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('le middleware', () => {
  it('est dans `src/`, là où Next le lit', () => {
    expect(existsSync(`${ROOT}src/middleware.ts`)).toBe(true);
  });

  it('n’a pas de sosie à la racine', () => {
    // Deux fichiers du même nom : celui de la racine ne serait pas exécuté, et
    // c'est pourtant celui qu'on ouvrirait pour comprendre un refus.
    expect(existsSync(`${ROOT}middleware.ts`)).toBe(false);
    expect(existsSync(`${ROOT}middleware.js`)).toBe(false);
  });
});
