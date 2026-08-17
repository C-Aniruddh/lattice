import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The exhibit's dev server.
 *
 * `fs.allow` is the whole of it, and it is here for the same reason it is in every other
 * exhibit: `main.ts` imports the gallery's shared bootstrap from `examples/_shared`, which is
 * outside this folder and therefore outside Vite's default filesystem allow-list. Without it the
 * boot module 403s and the page is blank with one line in a terminal nobody reads twice.
 *
 * The port is **not** `strictPort`. Several exhibits are being built in this repo at the same
 * time, and a strict port turns "somebody else is already running theirs" into a crash rather
 * than into a different number in the banner. 5190 because 5173–5178, 5183, 5186 and 5199 are
 * spoken for.
 *
 * `@latticekit/*` is deliberately not aliased to package source: the workspace symlinks resolve it
 * to each package's `dist`, which is what a visitor who installed the kit gets, and an exhibit
 * that only renders against source is one that has never been run the way anyone else will run
 * it. `npm run build` first.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: { port: 5190, fs: { allow: [root] } },
});
