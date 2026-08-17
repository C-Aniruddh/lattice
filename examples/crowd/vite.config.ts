import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The exhibit's dev server, on a port of its own so the gallery can run several at once.
 *
 * `fs.allow` reaches the repo root because `main.ts` imports `examples/_shared`, which is outside
 * this folder and therefore outside Vite's default allow-list; without it the boot module 403s and
 * the page is blank with one line in the terminal nobody reads twice.
 *
 * `@latticekit/*` is deliberately **not** aliased to package source. The workspace symlinks resolve it
 * to each package's `dist`, which is what a visitor who installed the kit would get. `npm run build`
 * first.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: { port: 5175, strictPort: true, fs: { allow: [root] } },
});
