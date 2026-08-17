import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The landing page's dev server and build.
 *
 * `@lattice/*` is deliberately **not** aliased to package source, for the same reason the
 * exhibits do not alias it: the workspace symlinks resolve to each package's `dist`, which is
 * what somebody who ran `npm i` would get. `npm run build` at the repo root first, or the page
 * bundles nothing.
 *
 * `fs.allow` reaches the repo root because that is where `packages/*&#47;dist` and the exhibits live,
 * both of them outside this root. Without it the dev server 403s the imports and the page paints
 * a dark rectangle with one line in a terminal nobody reads twice.
 *
 * The gallery is served from `/x/<exhibit>/` and each of those is a **separate Vite build** —
 * see `site/tools/build.mjs`. They are not entry points here, because an exhibit is a page in
 * its own right with its own module graph, and rolling eleven of them into one bundle would
 * defeat the whole point of a tile that is not paid for until it is looked at.
 */
const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  publicDir: 'public',
  server: { port: 5170, strictPort: true, fs: { allow: [root] } },
  preview: { port: 5171, strictPort: true },
  build: {
    outDir: 'dist',
    // **False on purpose.** The gallery is built into `dist/x/<exhibit>/` by
    // `site/tools/build.mjs` after this step, and an `emptyOutDir: true` here deletes all eleven
    // of them the next time somebody rebuilds only the page — which reads as ten tiles that
    // suddenly 404 and no error anywhere. `build.mjs` clears `dist/` itself, once, up front.
    emptyOutDir: false,
    target: 'es2022',
    // The page is one HTML file and one small module. Splitting it would cost a round trip to
    // save nothing.
    assetsInlineLimit: 0,
  },
});
