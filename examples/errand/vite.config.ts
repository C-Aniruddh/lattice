import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The exhibit's dev server.
 *
 * One line of configuration, and it is here for the reason every other exhibit's is: `main.ts`
 * imports the gallery's shared bootstrap from `examples/_shared`, which is outside this folder and
 * therefore outside Vite's default filesystem allow-list. Without it the boot module 403s and the
 * page is blank with one line in the terminal nobody reads twice.
 *
 * `@lattice/*` is deliberately **not** aliased to package source. The workspace symlinks resolve it
 * to each package's `dist`, which is what a visitor who installed the kit would get. `npm run
 * build` at the repo root first.
 *
 * Port 5192, because 5173–5178, 5181–5183, 5186, 5190, 5191 and 5199 are other exhibits' and the
 * whole point of a port per exhibit is being able to run several at once.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: { port: 5192, strictPort: true, fs: { allow: [root] } },
});
