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
 * `@latticekit/*` is deliberately **not** aliased to package source. The workspace symlinks resolve
 * it to each package's `dist`, which is what a visitor who installed the kit would get, and an
 * exhibit that only renders against source is an exhibit that has never been run the way anyone
 * else will run it. `npm run build` first.
 *
 * Port 5188, and the whole point of a port per exhibit is that a reviewer can have four of them
 * open at once. 5173 is `examples/demo`, 5176 and 5177 are taken, 5183 is the shared harness and
 * 5199 is spoken for.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: { port: 5188, strictPort: true, fs: { allow: [root] } },
});
