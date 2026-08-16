import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The harness's dev server. Not part of any exhibit's build.
 *
 * `@lattice/*` is aliased to package **source** rather than to `dist`, exactly as the test
 * runner does it, so this folder can be worked on against a package another agent is editing
 * without a build step in between — and so a stale `dist` can never make the shared boot look
 * correct when it is not.
 *
 * Port 5183 because 5173 belongs to `examples/demo` and running both at once is the whole point
 * of having a harness.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: { port: 5183, strictPort: true, fs: { allow: [root] } },
  resolve: {
    alias: [{ find: /^@lattice\/([a-z0-9-]+)$/, replacement: `${root}packages/$1/src/index.ts` }],
  },
});
