/**
 * Build the whole landing page, gallery included.
 *
 * ```bash
 * npm run build                 # at the repo root, first — the page bundles packages/*&#47;dist
 * node site/tools/build.mjs     # then this
 * npx vite preview --config site/vite.config.ts
 * ```
 *
 * Four steps, in this order and for a reason:
 *
 * 1. **Typecheck `site/`.** The page prints `site/example/hello.ts` as its worked example, so a
 *    signature that moved in the kit has to fail the page's build rather than quietly turn its
 *    example into a lie. This is the step that makes the claim under the code block true.
 * 2. **Generate.** `build-page.mjs` writes `index.html`, `llms.txt`, `api.json` and a copy of
 *    `kit.json` from the manifest and the measured figures.
 * 3. **Build the page.**
 * 4. **Build each exhibit into `dist/x/<name>/`**, as a page of its own with its own module
 *    graph. `emptyOutDir` is false from here on, because step 3 already owns `dist/`.
 *
 * Nothing outside `site/` is written. The exhibits are built from their own directories with an
 * inline config, so no file under `examples/` is touched.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const repo = join(site, '..');
const gallery = JSON.parse(readFileSync(join(site, 'data/exhibits.json'), 'utf8'));

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const step = (n, what) => console.log(`\n[33m${n}[0m ${what}`);

step('1/4', 'typecheck site/ against packages/*/dist');
execFileSync('npx', ['tsc', '-p', join(site, 'tsconfig.json')], { stdio: 'inherit', cwd: repo });

step('2/4', 'generate index.html, llms.txt, api.json');
execFileSync('node', [join(here, 'build-page.mjs')], { stdio: 'inherit', cwd: repo });

step('3/4', 'bundle the page');
// The one place `dist/` is cleared. Vite's own `emptyOutDir` is off for the page build so that
// rebuilding just the page cannot silently delete the eleven exhibits sitting under `dist/x/`.
if (only.length === 0) rmSync(join(site, 'dist'), { recursive: true, force: true });
await build({ configFile: join(site, 'vite.config.ts') });

const exhibits = [gallery.hero, ...gallery.live].filter((x) => only.length === 0 || only.includes(x.dir));
step('4/4', `bundle ${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'} into dist/x/`);
for (const x of exhibits) {
  await build({
    configFile: false,
    root: join(repo, 'examples', x.dir),
    base: `/x/${x.dir}/`,
    logLevel: 'warn',
    build: {
      outDir: join(site, 'dist/x', x.dir),
      emptyOutDir: true,
      target: 'es2022',
    },
  });
  console.log(`   [32m✓[0m /x/${x.dir}/`);
}

console.log('\nsite/dist is ready. `npx vite preview --config site/vite.config.ts`\n');
