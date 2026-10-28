import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcAlias = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': srcAlias },
  },
  // tsconfig déclare `jsx: preserve` pour Next ; le transformateur de Vitest
  // doit donc être instruit explicitement.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },

  test: {
    globals: false,
    // Les suites PGlite montent chacune leur base : on sérialise les fichiers.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['./tests/helpers/setup-node.ts'],
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          setupFiles: ['./tests/helpers/setup-node.ts'],
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'rls',
          environment: 'node',
          setupFiles: ['./tests/helpers/setup-node.ts'],
          include: ['tests/rls/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'a11y',
          environment: 'jsdom',
          include: ['tests/a11y/**/*.test.tsx'],
          setupFiles: ['./tests/helpers/setup-dom.ts'],
          // axe-core balaye un arbre rendu entier, en jsdom, sans moteur de
          // rendu : c'est lent par nature, et proportionnel à la taille du
          // composant. Le défaut de 5 s suffisait sur un poste de
          // développement et pas sur un runner partagé — `admin-event`, le
          // plus gros des douze fichiers, a fini par déborder. Un test vert ou
          // rouge selon la charge de la machine ne prouve rien, dans un sens
          // comme dans l'autre.
          //
          // 30 s, comme `integration` et `rls`, qui montent chacun une base
          // PGlite pour la même raison : ce sont des suites lentes, pas des
          // suites qui attendent indéfiniment.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
