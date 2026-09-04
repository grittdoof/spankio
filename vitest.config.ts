import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcAlias = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': srcAlias },
  },
  // tsconfig déclare `jsx: preserve` pour Next ; Vitest doit transformer le JSX.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
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
