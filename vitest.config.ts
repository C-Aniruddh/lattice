import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Tests run against `src`, not `dist`.
 *
 * This alias is the whole reason an agent can change `@lattice/core` and watch the
 * `@lattice/iso` suite react without a build step in between. `npm run build` still
 * exercises the real project-reference graph, so the shape we publish is never inferred
 * from a bundler's guess about it.
 */
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@lattice\/([a-z0-9-]+)$/, replacement: `${root}packages/$1/src/index.ts` }],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'examples/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    benchmark: { include: ['packages/*/test/**/*.bench.ts'] },
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/index.ts'],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
