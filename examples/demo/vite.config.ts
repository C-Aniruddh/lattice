import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The exhibit's dev server.
 *
 * One line of configuration, and it is here because `main.ts` imports the gallery's shared
 * bootstrap from `examples/_shared` — which is outside this folder, and therefore outside Vite's
 * default filesystem allow-list. Without it the boot module 403s and the page is blank with one
 * line in the terminal nobody reads twice.
 *
 * `@lattice/*` is deliberately **not** aliased to package source here. The workspace symlinks
 * resolve it to each package's `dist`, which is what a visitor who installed the kit would get,
 * and an exhibit that only renders against source is an exhibit that has never been run the way
 * anyone else will run it. `npm run build` first.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: { port: 5173, strictPort: true, fs: { allow: [root] } },
});
