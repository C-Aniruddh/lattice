import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The exhibit's dev server.
 *
 * One line of configuration, and it is here because `main.ts` imports the gallery's shared
 * bootstrap from `examples/_shared` — outside this folder and therefore outside Vite's default
 * filesystem allow-list. Without it the boot module 403s and the page is blank with one line in
 * the terminal nobody reads twice.
 *
 * `@lattice/*` is deliberately **not** aliased to package source. The workspace symlinks resolve
 * it to each package's `dist`, which is what a visitor who installed the kit would get. Run
 * `npm run build` at the root first, or `@lattice/audio` resolves to a folder that is not there.
 *
 * Port 5191 because 5173, 5175, 5176, 5177 and 5183 belong to other exhibits and the harness, and
 * running several of them at once is the whole point of the gallery having a port per exhibit.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: { port: 5191, strictPort: true, fs: { allow: [root] } },
});
