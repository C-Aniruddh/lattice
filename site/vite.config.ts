import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The landing page's dev server and build.
 *
 * `@latticekit/*` is deliberately **not** aliased to package source, for the same reason the
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
  /**
   * **A missing page must 404.**
   *
   * Vite's default is `'spa'`, which rewrites every unmatched path to `index.html` and returns
   * it with a `200`. So `/x/nope/` served the entire 68 kB landing page and told the client it
   * had found what it asked for — which is wrong for a crawler, wrong for a link checker, wrong
   * for anybody who mistypes an exhibit name, and actively misleading on a page whose gallery is
   * a set of directory URLs a visitor is invited to edit. This site is what `'mpa'` describes: a
   * set of real HTML documents, one per exhibit, with no client-side router anywhere in it.
   */
  appType: 'mpa',
  server: { port: 5170, strictPort: true, fs: { allow: [root] } },
  preview: { port: 5171, strictPort: true },
  build: {
    outDir: 'dist',
    /**
     * **Two documents, and Rollup has to be told about the second one.**
     *
     * Vite's default input is the single `index.html` at the root, so `/reference/` would build
     * in dev and be missing from `dist` — the worst shape of bug, because the dev server serves
     * it from disk and only the deployed site 404s. The reference is `site/reference/index.html`,
     * written by `tools/build-page.mjs` from the same manifest as everything else.
     *
     * It is a route rather than a section because at 2,255 px it was the second-largest object on
     * a landing page a newcomer has four seconds for, and it is content for somebody who has
     * already adopted this. With `appType: 'mpa'` a link to it is a navigation, not a router.
     */
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        reference: fileURLToPath(new URL('./reference/index.html', import.meta.url)),
      },
    },
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
