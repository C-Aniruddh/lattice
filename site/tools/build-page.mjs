/**
 * Generate the landing page.
 *
 * `site/index.html`, `site/public/llms.txt`, `site/public/api.json` and `site/public/kit.json`
 * are all outputs of this script. None of them is edited by hand, and the reason is the one the
 * brief gives for the API reference: a reference typed out beside the thing it describes drifts
 * from it within a week. Every package, export, invariant and budget on the page comes out of
 * `.lattice/kit.json` — the same file `npm run lint` fails the build over — and every number
 * comes out of `site/data/measured.json`, which carries the command that produced it.
 *
 * Run: `node site/tools/build-page.mjs`
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const repo = join(site, '..');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const kit = read(join(repo, '.lattice/kit.json'));
const measured = read(join(site, 'data/measured.json'));
const gallery = read(join(site, 'data/exhibits.json'));
const example = readFileSync(join(site, 'example/hello.ts'), 'utf8');

/** The only asset this page has, measured rather than remembered. `docs/GALLERY.md` allows the
 *  page a webfont and asks it to hold to the zero-asset rule everywhere else; printing the exact
 *  weight is the honest version of taking the exemption. */
const fontDir = join(site, 'public/fonts');
const fontKb = Math.round(
  readdirSync(fontDir).reduce((n, f) => n + statSync(join(fontDir, f)).size, 0) / 1024,
);

const REPO_URL = kit.repository;
const src = (path) => `${REPO_URL}/blob/main/${path}`;
const tree = (path) => `${REPO_URL}/tree/main/${path}`;

/* ── small helpers ─────────────────────────────────────────────────────────────────────── */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * `.lattice/kit.json` is the single source of this page's prose, and it is printed verbatim.
 *
 * A spelling-correction table used to sit here. `AGENTS.md` requires American spelling "prose
 * and identifiers alike", the manifest had drifted from that in seven places, and this page
 * house-styled them on the way out — a workaround for a bug in a file the page does not own.
 * The manifest has since been fixed at source, so the table is gone and the page prints what
 * it reads. If a British spelling appears on this page again, the bug is in `kit.json` and
 * that is where it gets fixed, rather than corrected here a second time.
 */

/** kB with two decimals, the way `npm run size` prints it. */
const kb = (n) => `${n.toFixed(2)} kB`;
/** Budgets are round numbers and `12.00 kB` reads as a measurement rather than a limit. */
const kbShort = (n) => `${String(n)} kB`;
const commas = (n) => n.toLocaleString('en-US');

const fig = (name) => {
  const f = measured.figures[name];
  if (f === undefined) throw new Error(`measured.json has no figure named ${name}`);
  return f.value;
};

const layerOf = (pkg) => {
  const row = kit.layers.find((l) => l.packages.includes(pkg));
  return row === undefined ? 0 : row.layer;
};

const sizeOf = (pkg) => measured.sizes.find((s) => s.package === pkg);

const budgetOf = (pkg) => kit.budgets.overrides?.[pkg]?.maxGzipKb ?? kit.budgets.maxGzipKbPerPackage;

/** Packages in dependency order — layer first, then alphabetically, which is also the order a
 *  reader should meet them in. */
const packageNames = Object.keys(kit.packages).sort(
  (a, b) => layerOf(a) - layerOf(b) || a.localeCompare(b),
);

/* ── the example, highlighted ──────────────────────────────────────────────────────────── */

const KEYWORDS =
  /\b(import|from|export|const|let|type|interface|return|for|of|in|new|if|else|function|await|async|void|as)\b/g;

/**
 * A four-token highlighter, and deliberately not a parser.
 *
 * Escaping happens first and the comment is split off before any tag is inserted, so a keyword
 * inside a comment cannot be wrapped twice and a `<` in the source cannot become markup. The
 * three classes are the three things a reader scans for: what is a keyword, what came from the
 * kit, and what is prose.
 */
function highlight(code) {
  return code
    .split('\n')
    .map((line) => {
      const at = line.search(/(^|[^:])\/\//);
      const body = at === -1 ? line : line.slice(0, at === 0 ? 0 : at + 1);
      const comment = at === -1 ? '' : line.slice(at === 0 ? 0 : at + 1);
      const lit = esc(body)
        .replace(/&#39;|'/g, "'")
        .replace(/'([^']*)'/g, "<i>'$1'</i>")
        .replace(KEYWORDS, '<b>$1</b>');
      return comment === '' ? lit : `${lit}<u>${esc(comment)}</u>`;
    })
    .join('\n');
}

/** The example minus its own header doc comment — the page has already explained what it is. */
const exampleBody = example.replace(/^\/\*\*[\s\S]*?\*\/\n/, '').trimEnd();

/**
 * The example's code-line count, re-counted here and checked against `measured.json`.
 *
 * The strip prints "a whole world, in lines" as one of the six numbers a visitor is deciding on,
 * and a figure that lives only in a JSON file drifts from the file it describes the first time
 * somebody adds a line to the program. So it is measured from the source on every build and the
 * stored figure is the assertion: `docs/GALLERY.md`'s own line rule, which is the same command the
 * gallery counts an exhibit with, so the page and the repository agree about what a line is.
 */
const exampleCodeLines = example
  .split('\n')
  .filter((l) => !/^[\t ]*($|\/\/|\/\*|\*)/.test(l)).length;


/* ── the page ──────────────────────────────────────────────────────────────────────────── */

const heroSrc = `/x/${gallery.hero.dir}/`;

if (fig('exampleLines') !== exampleCodeLines) {
  throw new Error(
    `site/example/hello.ts is ${exampleCodeLines} code lines and measured.json says ${fig('exampleLines')}. ` +
      'The strip prints that figure. Update site/data/measured.json.figures.exampleLines.',
  );
}

/** The command behind a figure, verbatim from `measured.json`. The reviewer's closing note was
 *  that this page wins arguments with skeptics and then shows the evidence only to agents; every
 *  headline figure carries its own now, on hover and on tap. */
const source = (name) => {
  const f = measured.figures[name];
  if (f === undefined) throw new Error(`measured.json has no figure named ${name}`);
  return f.source;
};

/**
 * The headline, and the two that were written beside it.
 *
 * The page used to sell a TypeScript kit with an agent story attached, and the owner's reframe is
 * that it is the other way round: **the product is the plugin and its skills; the nine libraries
 * are the reason the agent driving them succeeds.** The audience is somebody who wants an
 * isometric game and does not want to write code, draw sprites or make music, so a headline about
 * nine libraries, a dependency count or a gzip total is a spec sheet handed to somebody who did
 * not ask for one.
 *
 * The constraint that did not move: **headline a property that is true today, not a promise.**
 * `/lattice` is specified and not shipped, so a hero implying that a sentence gets you a game
 * right now is the one thing this page cannot ship — Phaser says *"Describe it. Play it."* and can
 * actually do it. What is true today, and checkable in ten seconds by a skeptic, is that there is
 * nothing in this kit for an agent to invent: `find packages -type f` returns 207 `.ts`, 19
 * `.json`, 9 `.md` and **no other kind of file at all**.
 *
 * So the headline is the failure mode it removes, and the three clauses are three things the
 * reader does not have to do. The two alternates are kept here rather than in a report, because
 * the next person to reconsider this should see what was already considered:
 *
 * | | | |
 * |---|---|---|
 * | **shipped** | *Nothing to draw. Nothing to load. Nothing to hallucinate.* | the failure mode named. Echoes the house's proven "No engine. No editor. No loader." cadence, and the third clause is the whole argument in one word |
 * | alternate A | *Isometric games with nothing to draw and nothing to load.* | says the category out loud, which the shipped one leaves to the subhead. Softer, and it drops the agent |
 * | alternate B | *The game is code, all the way down.* | the truest sentence about this kit and the least legible to somebody who does not write code |
 *
 * Swapping one in is this constant and nothing else.
 */
const HEADLINE = 'Nothing to draw. Nothing to load. Nothing to hallucinate.';

/**
 * The strip, and what it leads with now.
 *
 * **`tests` and `public symbols` are gone**, and stay gone. Nobody adopts anything because it has
 * 2,599 tests: working is the assumed baseline, and a number nobody asked for reads as a project
 * arguing with itself. `docs/GALLERY.md`'s copy doctrine names both of them by name; they are
 * still in `/api.json` and `/llms.txt` where an agent auditing the kit has a use for them.
 *
 * **It leads with what the reader is spared rather than with what the kit weighs.** `81.72 kB` was
 * first, and a bundle size is a figure a developer choosing a rendering library weighs — which is
 * not who this page is for any more. `asset files: 0` is the same measurement pointed at the thing
 * the reader actually cares about: there are no sprite sheets to draw, no audio files to license,
 * and no asset paths for an agent to invent.
 *
 * **The first two cells are one claim and are drawn as one.** `81.72 kB` alone invites *"so
 * what"*; next to `0 asset files` it says *the whole game is code*, which is a sentence. They are
 * bracketed in the markup with `data-pair` rather than captioned, because a caption explaining a
 * pairing is the copy doctrine's exact failure.
 *
 * **Every one of them still carries its command.** `from` names the figure in `measured.json`, so
 * the provenance on the page is the same string `/api.json` serves and cannot drift from it — the
 * single most persuasive thing a blind reviewer found here, and nothing above was worth losing it.
 */
const proof = [
  { key: 'asset files', value: String(fig('assetFiles')), unit: '', from: 'assetFiles', pair: 'a' },
  { key: 'gzipped, all nine', value: fig('gzipTotal').toFixed(2), unit: 'kB', from: 'gzipTotal', pair: 'a' },
  { key: 'dependencies', value: String(fig('dependencies')), unit: '', from: 'dependencies' },
  { key: 'worlds running here', value: String(fig('exhibits')), unit: '', from: 'exhibits' },
  { key: 'a world, in lines', value: String(fig('exampleLines')), unit: '', from: 'exampleLines' },
  { key: 'this page, worst 10s', live: 'm-strip', from: 'pageFrame' },
];

/**
 * The three traps, verbatim from the set `/llms.txt` serves.
 *
 * The headline claims the traps are written down, so the page shows three of them rather than
 * saying so again — and they are the evidence for the whole section, because each is a mistake
 * that compiles, runs, and produces a plausible-looking broken game. That is precisely the class
 * of failure a general coding agent cannot get out of on its own, and the reason this kit ships
 * its own.
 *
 * Three rather than six: the full list is one fetch away and a landing page is not a manual.
 */
const traps = [
  ['An animated color is an allocator', 'a color that moves continuously misses the ramp cache every frame and takes every other caller’s entry down with it. Snap it to eight levels; keep position and timing continuous.'],
  ['Tile lookup floors, never rounds', 'and once ground has elevation the projection stops being invertible, so a tap has to be resolved against the terrain. The naive version misses by 1,400 px at the top of a hill.'],
  ['<code>readonly</code> is not a barrier', 'TypeScript ignores property <code>readonly</code> when checking assignability, so a frozen vector flows into a parameter that writes to it. The failure is a <code>TypeError</code> on the one frame that path runs.'],
];

/**
 * The install, as a terminal with tabs.
 *
 * The old line named five packages, wrapped to three lines, and was the longest install command in
 * a comparison of twenty-five developer pages — on the page whose whole argument is *small*. The
 * shape is PlayCanvas's: one visible command, the variants behind tabs, a `$` that cannot be
 * selected, and the command typed in rather than pasted in.
 *
 * The default tab uses **brace expansion**, which is why it fits on one line: `bash`, `zsh` and
 * `fish` all expand `@latticekit/{core,iso}` to the two package names, and the `full` tab is the
 * portable form for anybody whose shell does not — PowerShell, or a CI step that is not a shell at
 * all. Naming the escape hatch `full` rather than hiding it is the honest version of the trick.
 */
const PKGS = ['core', 'iso', 'draw', 'loop', 'input'];
const install = [
  { tab: 'npm', cmd: `npm i @latticekit/{${PKGS.join(',')}}` },
  { tab: 'pnpm', cmd: `pnpm add @latticekit/{${PKGS.join(',')}}` },
  { tab: 'bun', cmd: `bun add @latticekit/{${PKGS.join(',')}}` },
  { tab: 'full', cmd: `npm i ${PKGS.map((p) => `@latticekit/${p}`).join(' ')}` },
];
/** The literal, portable form — what `/llms.txt` and `/api.json` publish, and what `full` shows. */
const INSTALL_PLAIN = install[install.length - 1].cmd;

/**
 * One terminal. `id` scopes the tabs' `aria-controls` so two of them on one page do not collide.
 *
 * `--n` and `--w` are the typewriter: the command is a monospace string, so its width in `ch` is
 * its length in characters exactly, and `steps(--n)` lands one character per step. Both are set
 * here rather than measured at runtime, because the string is known at build time and a layout
 * read on first paint to animate a thing is a jank this page does not need.
 */
const terminal = (id) => `<div class="term js-only" data-term id="${id}">
        <div class="term-tabs" role="tablist" aria-label="Package manager">
${install
  .map(
    (v, i) =>
      `          <button role="tab" type="button" id="${id}-t${String(i)}" aria-controls="${id}-p${String(i)}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${esc(v.tab)}</button>`,
  )
  .join('\n')}
        </div>
        <div class="term-body">
${install
  .map(
    (v, i) =>
      `          <pre class="term-cmd" role="tabpanel" id="${id}-p${String(i)}" aria-labelledby="${id}-t${String(i)}" data-on="${i === 0 ? 'yes' : 'no'}" style="--n:${String(v.cmd.length)};--w:${String(v.cmd.length)}ch"><span class="prompt">$</span> <span class="type"><code data-cmd>${esc(v.cmd)}</code></span><i class="caret"></i></pre>`,
  )
  .join('\n')}
          <button class="term-copy" type="button" data-term-copy>Copy</button>
        </div>
      </div>
      <noscript><pre class="shell-cmd"><span class="prompt">$</span> ${esc(INSTALL_PLAIN)}</pre></noscript>`;

/**
 * A tile's own viewport, and why it is not the tile's size.
 *
 * An exhibit is composed for a screen — `docs/GALLERY.md` scores the opening frame at 1440x900 —
 * so handing its camera a 640-pixel box would show a different picture than the one its author
 * framed, with the world's edges in shot and the HUD covering half of it. So each exhibit runs at
 * the viewport below and the tile scales the whole document down to fit. `dpr` is the price of
 * that: at 0.85 the backing store is 850x531, which is what two of these cost together on a
 * laptop rather than what they would cost at the device ratio.
 */
const TILE_W = 1000;
const TILE_H = 625;

function tileHtml(x) {
  const W = TILE_W;
  const H = TILE_H;
  // `dpr` is chosen at mount time by `page.ts`, because it depends on the visitor's pointer and
  // this file runs at build time. `data-params` is everything the exhibit itself needs.
  //
  // The Run button lives **inside the stage** rather than at the foot of the tile. On a phone the
  // running budget is genuinely one scene, so nine of the ten tiles are a held frame or a
  // placeholder at any moment, and a button pinned to the bottom of the article sat under the
  // caption where nothing suggested it had anything to do with the picture above it. Over the
  // world it is what it is: press this and this one runs.
  //
  // `.cost` is the tile's own frame figure, written by the same meter as the statement panel.
  //
  // **The prompt is the caption now, and the tag is the feature list.**
  //
  // The tile used to carry the exhibit's own panel subtitle — *"Pools that meet without a seam"* —
  // which is a sentence written by somebody who already knows what a light field is, under a world
  // that is showing them one. What replaces it is the sentence somebody would *ask* for this world
  // in, in ordinary voice, with no jargon in it: that is the page's entire argument, made ten
  // times, next to ten worlds that are running rather than ten stills.
  //
  // `tag` earns its own line for a reason worth writing down: it makes the gallery double as the
  // feature list, so the page never has to write one. EROSION, LIGHT POOLS and ELEVATION PICKING
  // scanned down the left of the grid are a capability inventory a reader assembles themselves,
  // and every entry in it is standing over the proof.
  //
  // `caption` and `idea` are both still in `/llms.txt` and `/api.json`, and the tile links to the
  // file, which is where somebody who wants the mechanism is going anyway.
  return `      <article class="tile" data-src="/x/${x.dir}/" data-params="${esc(x.tileParams ?? '')}" data-name="${esc(x.name)}" data-w="${W}" data-h="${H}">
        <div class="stage" style="--w:${W};--h:${H}">
          <button class="tile-run" type="button"><b>Run</b> ${esc(x.name)}</button>
        </div>
        <div class="tile-body">
          <p class="tile-tag">${esc(x.tag)}</p>
          <p class="tile-prompt">${esc(x.prompt)}</p>
          <div class="tile-head">
            <h3>${esc(x.name)}</h3>
            <span>${esc(x.fact)}</span>
          </div>
          <p class="chip js-only"><span class="cost"></span></p>
          <div class="tile-links">
            <a href="/x/${x.dir}/">Open full size</a>
            <a href="${tree(`examples/${x.dir}`)}">Source</a>
            <a href="/x/${x.dir}/?seed=${encodeURIComponent(x.seed)}">Seed &ldquo;${esc(x.seed)}&rdquo;</a>
          </div>
        </div>
      </article>`;
}

function packageHtml(name) {
  const p = kit.packages[name];
  const size = sizeOf(name);
  const entries = new Set(p.entryPoints ?? []);
  const symbols = [...p.exports]
    .sort((a, b) => (entries.has(b) ? 1 : 0) - (entries.has(a) ? 1 : 0) || a.localeCompare(b))
    .map((s) => `<code${entries.has(s) ? ' class="entry"' : ''}>${esc(s)}</code>`)
    .join('');
  const deps = p.dependsOn.length === 0 ? 'nothing' : p.dependsOn.map((d) => `@latticekit/${d}`).join(', ');
  return `        <details class="pkg" id="pkg-${name}">
          <summary>
            <h3>${esc(p.name)}<span class="layer">LAYER ${layerOf(name)}</span></h3>
            <span class="sz">${p.exports.length} exports${size === undefined ? '' : ` &middot; ${esc(kb(size.gzipKb))}`}</span>
            <span class="why">${esc(p.purpose)}</span>
          </summary>
          <div class="pkg-body">
            <div class="scroller"><table>
              <tbody>
                <tr><th>depends on</th><td>${esc(deps)}</td></tr>
                <tr><th>environment</th><td>${esc(p.environment)}</td></tr>
                <tr><th>modules</th><td>${p.modules.map((m) => `<code>${esc(m)}</code>`).join(' ')}</td></tr>
                <tr><th>start here</th><td>${(p.entryPoints ?? []).length === 0 ? '<em>no entry points declared &mdash; this package is used through its types and its overlay, not called first</em>' : p.entryPoints.map((e) => `<code>${esc(e)}</code>`).join(' ')}</td></tr>
                <tr><th>gzipped</th><td>${size === undefined ? '&mdash;' : `${esc(kb(size.gzipKb))} against a ${esc(kbShort(budgetOf(name)))} budget${size.note === undefined ? '' : ` &mdash; ${esc(size.note)}`}`}</td></tr>
              </tbody>
            </table></div>
            <div>
              <h4>What it promises</h4>
              <ul>${p.invariants.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
            </div>
            <div>
              <h4>${p.exports.length} exports &mdash; entry points first</h4>
              <div class="symbols">${symbols}</div>
            </div>
            <p class="note"><a href="${tree(`packages/${name}`)}">packages/${name}</a> &middot; <a href="${src(`packages/${name}/README.md`)}">README</a></p>
          </div>
        </details>`;
}

/* ── the shared chrome ─────────────────────────────────────────────────────────────────── */

/**
 * Everything in `<head>` that both documents need.
 *
 * There are two documents now — the landing page and `/reference/` — and the reference used to be
 * the largest section of the first one. At 2,255 px it was the second-biggest object on a page a
 * newcomer had four seconds for, and it is content for somebody who has already adopted this: an
 * index of names that answers *"which package is `pathSample` in"* and never *"should I use
 * this"*. It is a route now, linked from the rail and the footer, and `appType: 'mpa'` in
 * `vite.config.ts` means it is a real document rather than a client-side tab.
 */
const head = ({ title, description, extra = '' }) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#181410">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 12 60 28 32 44 4 28Z' fill='%23e0a13c'/%3E%3Cpath d='M32 20 46 28 32 36 18 28Z' fill='%23181410'/%3E%3C/svg%3E">

<!-- Machine-readable mirrors of everything below. An agent should read these instead of this page. -->
<link rel="alternate" type="application/json" href="/api.json" title="The kit as JSON: packages, exports, invariants, budgets, measured figures">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="alternate" type="application/json" href="/kit.json" title="The repository's own .lattice/kit.json, verbatim">

<!-- The only inline script on the page, and the only way CSS can know whether the worlds below
     will ever run. Everything that is a live scene, a live number or an instruction to touch one
     is removed by html:not(.js) - see page.css. docs/GALLERY.md asks this page to work without
     JavaScript "not gracefully - just honestly", and honesty here means not printing "drag it"
     over a rectangle that will never move. -->
<script>document.documentElement.classList.add('js')</script>

<link rel="preload" href="/fonts/ibm-plex-mono-500.woff2" as="font" type="font/woff2" crossorigin>
<!-- The wordmark is the first thing painted and the only thing set in this face. Without the
     preload it swaps from Georgia a beat after first paint, in the top-left corner, which is the
     one place on the page a reader is already looking. -->
<link rel="preload" href="/fonts/fraunces-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/src/page.css">
<script type="module" src="/src/page.ts"></script>
${extra}`;

/**
 * The masthead, and the chip beside the wordmark.
 *
 * The version stamp came out of here for a good reason — *"lattice v0.1.0"* made a verdict the
 * second thing a visitor's eye landed on, before they had seen anything to apply it to — and
 * nothing replaced it. Eight of the eleven best-in-class developer pages in the comparison set
 * carry a **dated announcement chip** in exactly this position, and it is the most reliable
 * single marker that a page is maintained: a date is checkable, and a stale one is the reader's
 * evidence rather than the page's claim.
 *
 * So it is a date and a fact, not a version and not a verdict, and both come out of the data
 * files rather than out of this template — `measured.json`'s own measurement date, and the number
 * of rows in `exhibits.json`. A chip nobody has to remember to update is the only kind that stays
 * true.
 */
const chipDate = new Date(`${measured.measuredOn}T00:00:00Z`).toLocaleDateString('en-US', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
});

const topbar = (home = '', current = '') => `<nav class="topbar">
  <div class="masthead">
    <a class="wordmark" href="/">lattice</a>
    <a class="news" href="${home}#gallery"><b>New</b><time datetime="${esc(measured.measuredOn)}">${esc(chipDate)}</time><span>${gallery.live.length} worlds live in the gallery</span></a>
  </div>
  <div class="topnav">
    <a href="${home}#gallery">Gallery</a>
    <a href="${home}#how">How</a>
    <a href="${home}#example">Example</a>
    <a href="/reference/"${current === 'reference' ? ' aria-current="page"' : ''}>Reference</a>
    <a href="/llms.txt">llms.txt</a>
    <a href="${REPO_URL}">GitHub</a>
  </div>
</nav>`;

const footer = () => `<footer class="shell">
  <div class="foot">
    <div>
      <h4>Start</h4>
      <ul>
        <li><a href="${REPO_URL}">Repository</a></li>
        <li><a href="${src('README.md')}">Read me</a></li>
        <li><a href="${src('AGENTS.md')}">The eleven rules</a></li>
        <li><a href="${src('docs/GUIDE.md')}">Guide</a></li>
      </ul>
    </div>
    <div>
      <h4>For agents</h4>
      <ul>
        <li><a href="/llms.txt">llms.txt</a></li>
        <li><a href="/api.json">api.json</a></li>
        <li><a href="/kit.json">kit.json</a></li>
        <li><a href="${src('docs/SKILLS.md')}">The skills spec</a></li>
      </ul>
    </div>
    <div>
      <h4>Deeper</h4>
      <ul>
        <li><a href="/reference/">API reference</a></li>
        <li><a href="${src('docs/ARCHITECTURE.md')}">Architecture</a></li>
        <li><a href="${src('docs/PERFORMANCE.md')}">Performance</a></li>
        <li><a href="${src('docs/GALLERY.md')}">The gallery brief</a></li>
      </ul>
    </div>
    <div class="colophon">
      <h4>Colophon</h4>
      <p style="margin:0"><code>lerpPalette(DUSK, NIGHT, scroll)</code>, repainted <span id="repaints">0</span> times
      so far. Set in IBM Plex and Fraunces, self-hosted &mdash; ${fontKb} kB of font, and the only asset here.
      ${esc(kit.license)}-licensed. Measured at <code>${esc(measured.commit)}</code>, ${esc(measured.measuredOn)}.</p>
    </div>
  </div>
</footer>`;

/* ── the landing page ──────────────────────────────────────────────────────────────────── */

const html = `<!doctype html>
<html lang="en">
<head>
${head({
  title: 'Lattice — isometric games with nothing to draw and nothing to load',
  description: `Isometric games where the art is derived and the sound is synthesized — no sprite sheets, no audio files, nothing for an agent to invent. ${String(gallery.live.length)} worlds running on the page.`,
  extra: `
<script type="application/ld+json">
${JSON.stringify(
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'Lattice',
    alternateName: kit.tagline,
    description:
      'A TypeScript kit for isometric, deterministic, zero-asset games, written to be driven by an agent. Nine composable libraries with no dependencies and no asset files.',
    programmingLanguage: 'TypeScript',
    codeRepository: REPO_URL,
    license: `https://opensource.org/licenses/${kit.license}`,
    version: kit.version,
    keywords: ['isometric', 'game development', 'ai agent', 'deterministic', 'procedural', 'zero-asset', 'typescript'],
  },
  null,
  2,
)}
</script>`,
})}
</head>
<body>

<noscript>
  <p class="banner">Every world on this page renders in your browser as you read, so with JavaScript off there is
  nothing to fall back to. The writing, the figures and the reference are still here.
  Source: <a href="${REPO_URL}">${esc(REPO_URL)}</a></p>
</noscript>

<canvas id="ground" aria-hidden="true"></canvas>

<div class="page">

${topbar()}

<!--
  The hero, and why it is split rather than an overlay.

  ## What it had to fix

  Three findings landed on the same element. The header was **537 px of an 813 px viewport**, so
  the first screen was a cropped world plus the top of a text slab and neither landed. The '<h1>'
  was set over the world on the argument — written into this file — that "the sky in the top-left
  of Lamp Road is the darkest, emptiest region of the frame at every hour", and it was **not**:
  measured, the heading sat at y≈364, in foliage. And at 420 px the whole first screen was world,
  heading and a drag hint, with **no install, no call to action and no mention of the agent** —
  nothing a visitor could act on.

  ## The two options, and which one survived testing

  The first choice was to recompose the shot so that the region the design was justified against
  is genuinely empty sky, which is a thing this project can do precisely because the world is its
  own and procedural. It did not survive: Lamp Road frames itself with 'camera.fitBounds' over the
  road it generated from the seed, in 'examples/demo/src/main.ts', and every lever that would move
  that clearing is in 'examples/', which this page does not own. The seeds reachable from here
  through '?seed=' change the valley but not the composition rule, and none of them holds an empty
  corner at both ends of the day cycle **and** at 390 px, where the exhibit is scaled to fit and
  its own dock arrives in whatever corner is left. The measurements are in the report.

  So: **the split hero, which is the fallback the brief named and the better answer anyway.** Text
  left, world right, full viewport, and no type over the world at all — which retires the whole
  question of scrims, plates and washes rather than answering it. 'docs/GALLERY.md' still gets what
  it asked for: a world, moving, in the first frame, before any text has been read.

  On a phone the two stack with the **world on top and the words under it**, so the first screen is
  a live world, the headline, and the two things a visitor can actually do. The live canvas is kept
  at every width rather than dropped below 750 px, because a page whose one rule is "everything
  here is Lattice, running" cannot open on a phone with nothing running. It is one scene, and the
  running budget in 'page.ts' already spends exactly one there.
-->
<header class="hero" data-src="${heroSrc}" data-name="${esc(gallery.hero.name)}" data-w="900">
  <div class="hero-world">
    <div class="hero-stage"></div>
    <!--
      The drag hint, and why it is a pill that moves rather than a label that does not.

      'DRAG IT' set in the corner is static signage: it names the gesture and demonstrates
      nothing, and it is still there twenty seconds after the reader has dragged. This is
      PlayCanvas's shape — a pill with a hand in it that slides ±11 px on a two-second loop miming
      the gesture, fades in only once the world is actually up so it never floats over an empty
      box, and **deletes itself permanently on the first drag**, because a hint that outlives its
      own instruction is furniture. 'prefers-reduced-motion' keeps the pill and drops the slide.
    -->
    <p class="hint js-only" data-hint="off">
      <svg class="hand" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5V4.5a1.5 1.5 0 0 1 3 0v6"/><path d="M15 11V7a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5.9 5.9 0 0 1-4.6-2.2l-3-3.8a1.6 1.6 0 0 1 2.4-2.1L9 15"/><path d="M9 15V6.5a1.5 1.5 0 0 0-3 0V14"/></svg>
      <b>Drag the world</b>
    </p>
    <!-- Below the world, never over it. A finger has one gesture and the exhibit already owns the
         bottom of its own frame; a play button floating there covers the exhibit's. -->
    <button class="play" id="hero-play" type="button">Tap the world to play</button>
  </div>

  <div class="hero-copy">
    <p class="eyebrow">Isometric games, built with an agent</p>
    <!-- One clause per line, in the markup rather than left to a wrap. It is the same device the
         statement slab used for "No engine. / No editor. / No loader.", it is what makes three
         short sentences read as one figure, and a heading whose line breaks depend on the
         viewport is a heading whose rhythm is an accident. -->
    <h1>${HEADLINE.trim().split(' ').reduce((lines, word) => {
      const last = lines[lines.length - 1];
      if (last === undefined || last.endsWith('.')) lines.push(word);
      else lines[lines.length - 1] = `${last} ${word}`;
      return lines;
    }, []).map(esc).join('<br>')}</h1>
    <p class="hero-sub">Every world is derived from a color and a seed. There are no sprite sheets, no audio files and
    no asset paths &mdash; so there is nothing here for an agent to invent, and nothing you have to make before it
    can start. It reads the whole kit, the rules and the traps at <a href="/llms.txt"><code>/llms.txt</code></a>.</p>
    <div class="hero-cta">
      <a class="cta" href="#gallery">See ${gallery.live.length} of them running</a>
      <a class="cta ghost" href="#how">How it works</a>
    </div>
  </div>
</header>

<!--
  The strip, immediately under the hero.

  It sat about eleven hundred pixels down, behind a full-screen text wall, and it is the most
  credible object on this page: six figures, each carrying the command that produced it, one of
  them measuring the machine it is being read on. It is the second thing now.
-->
<ul class="proof">
${proof
  .map(
    // A live figure has nothing to say with script off, and a cell with a label and no number in
    // it is worse than one fewer cell. The strip is `auto-fit`, so five lay out as five.
    (p) => `  <li${p.live === undefined ? '' : ' class="js-only"'}${p.pair === undefined ? '' : ` data-pair="${p.pair}"`}>
    <button class="fig" type="button" aria-expanded="false">
      <span class="k">${esc(p.key)}</span>
      ${p.live === undefined
        ? `<span class="v">${esc(p.value)}${p.unit === '' ? '' : `<small>${esc(p.unit)}</small>`}</span>`
        : `<span class="v live"><span id="${esc(p.live)}"></span></span>`}
    </button>
    <p class="src"><b>How this was measured</b>${esc(source(p.from))}</p>
  </li>`,
  )
  .join('\n')}
</ul>
<p class="prov-note note">Measured at <code>${esc(measured.commit)}</code>, ${esc(measured.measuredOn)}, ${esc(measured.machine)}.
<span class="js-only">The last one is measuring yours. Hover any of them for the command.</span></p>

<main class="shell">

  <!--
    The gallery is the centre of the page now, not an exhibit of it.

    Phaser's relaunched page pairs a verbatim user sentence with a capability tag against each
    rendered game, and its gallery is headed "Real prompts, and what Phaser AE actually rendered
    for them." The claim they cannot answer is that **ours run where theirs are stills** — so the
    tiles keep every pixel of what they were and gain the two lines that make them an argument
    rather than a portfolio: the capability, and the sentence somebody would ask for that world in.

    The tags double as the feature list, which is why this page never writes one.

    The heading no longer scores the project. "Eighteen specified. Ten built." was one of three
    separate places telling a first-time visitor what had not been built, under ten worlds that
    were running; 'docs/GALLERY.md' deleted that pattern once already as "a page-length apology"
    and it had regrown. The eight are in site/data/readiness-for-readme.md, /llms.txt and
    /api.json, which is where somebody auditing the project looks.
  -->
  <section class="section" id="gallery">
    <div class="marker"><a href="#gallery">/gallery</a></div>
    <div class="body">
      <p class="eyebrow">The gallery</p>
      <h2>${['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen'][gallery.live.length] ?? String(gallery.live.length)} worlds, running right now.</h2>
      <p class="lede">Under each one is the sentence it would be asked for. Above it is that world, live in your
      browser &mdash; a directory under <code>examples/</code>, under 200 lines of logic, seeded from its own URL.</p>

      <p class="note rm-note">You have asked your browser for reduced motion, so nothing on this page starts by
      itself. Every tile below is built and painted once, and stays on that frame until you press <em>Run</em>.</p>

      <div class="grid">
${gallery.live.map(tileHtml).join('\n')}
      </div>
    </div>
  </section>

  <!--
    /how — the old /what and the old /agent, merged, and re-pointed.

    Two sections were making one argument in two places, and the statement slab between them
    ("No engine. No editor. No loader.") was stealing the bottom third of the first screen to make
    a third of it again. They are one section, and its question is not *what is this* but **why
    does the agent get it right**, because that is the thing the reader is deciding.

    Every fact here is the fact that was here before. What changed is what each is for: zero assets
    is not a bundle-size boast, it is the reason the output is not broken; determinism is not a
    purity rule, it is the reason a thing an agent built behaves the same way twice; the traps are
    not documentation, they are the failures that compile.

    The five-step plugin flow is gone. It walked through a build sequence no visitor can run, at
    the top of the page, one section under a hero that must not imply '/lattice' works. It is
    docs/SKILLS.md's content and it is whole there. The plugin's status is stated once, below,
    beside the three files that are shipped.
  -->
  <section class="section" id="how">
    <div class="marker"><a href="#how">/how</a></div>
    <div class="body">
      <p class="eyebrow">How it works</p>
      <h2>Why the agent gets it right.</h2>
      <p class="lede">Ask a general coding agent for a game and it invents a sprite sheet, an asset path and a
      physics constant, and hands you something that compiles and is broken. None of those three exists here.</p>

      <ul class="plain">
        <li><strong>No asset files, so no asset paths.</strong> A solid is one color with its faces derived; a sound
        is synthesized from a declaration. Nothing to draw, nothing to load, nothing to license &mdash; and nothing
        to name wrongly. A recolor is a runtime value.</li>
        <li><strong>Deterministic by rule, not by discipline.</strong> <code>Math.random()</code>,
        <code>Date.now()</code> and <code>performance.now()</code> are lint errors inside a package. Same seed, same
        world, on every machine &mdash; so a bug is reproducible from a link, and a fix can be shown to have worked.</li>
        <li><strong>Nothing owns your <code>main</code>.</strong> No engine, no editor, no loader, no scene format
        and no build step past a bundler. There is no framework shape to get wrong because there is no framework.</li>
      </ul>

      <h3>The traps, written down</h3>
      <p>An agent can read a <code>.d.ts</code>. What it cannot read is the set of failures that are individually
      surprising and jointly the difference between a working game and a plausible-looking broken one. Three of them,
      and the rest at <a href="/llms.txt"><code>/llms.txt</code></a>:</p>
      <ul class="plain traps">
${traps.map(([t, b]) => `        <li><strong>${t}.</strong> ${b}</li>`).join('\n')}
      </ul>

      <h3>The whole kit, without the prose</h3>
      <div class="scroller">
        <table>
          <thead><tr><th>at</th><th>what it holds</th></tr></thead>
          <tbody>
            <tr><td><a href="/llms.txt"><code>/llms.txt</code></a></td><td>the kit as plain text: the rules, all nine packages with entry points and invariants, every exhibit with its source path, the traps, and a program that compiles.</td></tr>
            <tr><td><a href="/api.json"><code>/api.json</code></a></td><td>the same as JSON, plus every measured figure with the command behind it, the cross-package contracts, and what is and is not stable.</td></tr>
            <tr><td><a href="/kit.json"><code>/kit.json</code></a></td><td>the repository's own <code>.lattice/kit.json</code>, verbatim &mdash; the file the build fails over if a package exports a symbol it does not list.</td></tr>
          </tbody>
        </table>
      </div>
      <p class="note">Those three are live. The <code>/lattice</code> plugin that will drive them is specified in
      <a href="${src('docs/SKILLS.md')}">docs/SKILLS.md</a> and is not shipped yet; today you point your own agent at
      the files above.</p>

      <h3>The nine underneath</h3>
      <p><code>core</code> depends on nothing and every other package depends only on the ones below it. All nine are
      ${esc(kb(fig('gzipTotal')))} gzipped and a game imports four or five.</p>
      <div class="scroller">
        <table>
          <thead><tr><th>package</th><th>layer</th><th>what it is for</th><th class="num">gzip</th></tr></thead>
          <tbody>
${packageNames
  .map((n) => {
    const p = kit.packages[n];
    const s = sizeOf(n);
    return `            <tr><td><a href="/reference/#pkg-${n}"><code>${esc(p.name)}</code></a></td><td>${layerOf(n)}</td><td>${esc(p.purpose)}</td><td class="num">${s === undefined ? '&mdash;' : esc(kb(s.gzipKb))}</td></tr>`;
  })
  .join('\n')}
          </tbody>
        </table>
      </div>
      <p class="note">Sizes are <code>npm run size</code> at ${esc(measured.commit)}, exclusive backends charged at the
      heaviest and never summed. Every symbol is at <a href="/reference/">/reference</a>. If you want a game engine
      &mdash; scenes, physics, a loader, a decade of documentation every agent has already read &mdash; use Phaser.</p>

      <div class="js-only meter-bay">
        <dl class="meter">
          <dt>hero worst 10s</dt><dd id="m-hero">&mdash;</dd>
          <dt>page period</dt><dd id="m-cadence">&mdash;</dd>
          <dt>page worst 10s</dt><dd id="m-worst">&mdash;</dd>
          <dt>scenes live</dt><dd id="live">0</dd>
        </dl>
        <p class="note">Worst gap between two painted frames, never frame time.
        <b>Hover any of them for what was running.</b></p>
      </div>
    </div>
  </section>

  <!--
    Untouched, and protected. It is a real file, selectable, and typechecked against the built
    packages before this page is generated — Bevy's equivalent is an SVG image of code.
  -->
  <section class="section" id="example">
    <div class="marker"><a href="#example">/example</a></div>
    <div class="body">
      <p class="eyebrow">A whole program</p>
      <h2>This is all of it.</h2>
      <p class="lede">A seeded town on rolling ground, with a camera you can drag, zoom to the pointer and pinch.
      No config file, no scene format, no build step past a bundler.</p>
      <p class="note">${esc(String(fig('exampleLines')))} code lines, typechecked against the built packages before this
      page is generated &mdash; if a signature moves in the kit, the page fails to build instead of quietly showing
      something that no longer works. It is a real file:
      <a href="${src('site/example/hello.ts')}"><code>site/example/hello.ts</code></a>.</p>
      <div class="codebox">
        <div class="codebar js-only">
          <button type="button" data-code-wrap>Wrap</button>
          <button type="button" data-code-copy>Copy</button>
        </div>
        <pre class="code"><code>${highlight(exampleBody)}</code></pre>
      </div>
    </div>
  </section>

</main>

<!--
  The closing band.

  The page used to end **inside the reference's contract table, on a row about 'stepMs'** — the
  last thing a reader carried out of it was a compatibility constant. One line, the install, and
  the two places to go.
-->
<section class="band">
  <div class="shell band-in">
    <h2>Point an agent at it.</h2>
    <p class="lede">It reads the rules, the invariants and the traps, and writes the game.</p>
    <div class="term-bay">
      ${terminal('t-band')}
    </div>
    <div class="band-links">
      <a class="cta" href="${REPO_URL}">Repository</a>
      <a class="cta ghost" href="/llms.txt">llms.txt</a>
    </div>
  </div>
</section>

${footer()}

</div>
</body>
</html>
`;

/* ── /reference/ ───────────────────────────────────────────────────────────────────────── */

/**
 * The API reference, on a route of its own.
 *
 * It is the same generator it always was — every row still comes out of `.lattice/kit.json`, which
 * `npm run lint` fails the build over — and the only thing that changed is which document it is
 * in. `site/vite.config.ts` names it as a second Rollup input; `appType: 'mpa'` means a link to it
 * is a navigation rather than a router, and a mistyped path under it still 404s.
 */
const referenceHtml = `<!doctype html>
<html lang="en">
<head>
${head({
  title: 'Lattice API reference — every public symbol, from the manifest',
  description: `Every exported name in the nine Lattice packages, generated from .lattice/kit.json: ${commas(fig('publicSymbols'))} symbols, their layer, their invariants and their size budgets.`,
})}
</head>
<body>

<noscript>
  <p class="banner">This page is a table of names and reads fine without JavaScript. The worlds are on
  <a href="/">the front page</a>.</p>
</noscript>

<canvas id="ground" aria-hidden="true"></canvas>

<div class="page">

${topbar('/', 'reference')}

<main class="shell">

  <!-- Deliberately without an 'id'. 'page.ts''s scroll spy walks 'main .section[id]' and writes
       both the rail and 'history.replaceState', so an id here would rewrite this document's URL to
       /reference/#reference the moment it is scrolled — a hash that names the only section on the
       page. The rail's Reference link carries 'aria-current' from the markup instead, which is
       true for the whole document rather than for a scroll position inside it. Deep links still
       work: every '#pkg-*' anchor is on the '<details>', not on this element. -->
  <section class="section">
    <div class="marker"><a href="/">&larr; back</a></div>
    <div class="body">
      <p class="eyebrow">API reference</p>
      <h2>Every public symbol, from the manifest.</h2>
      <p class="lede">Generated from <a href="${src('.lattice/kit.json')}"><code>.lattice/kit.json</code></a>, which
      <code>npm run lint</code> fails the build over. It answers &ldquo;which package, which symbol&rdquo; and never
      &ldquo;how do I call it&rdquo; &mdash; the manifest carries no types. An agent should read
      <a href="/api.json"><code>/api.json</code></a> instead of this.</p>

      <div class="scroller">
        <table>
          <caption class="eyebrow" style="text-align:left;padding-bottom:12px">The budgets it is held to</caption>
          <tbody>
            <tr><th>statements covered</th><td>${(kit.budgets.coverageStatements * 100).toFixed(0)}% per package, ${(kit.budgets.coverageCore * 100).toFixed(0)}% on everything in <code>core</code></td></tr>
            <tr><th>gzipped per package</th><td>${esc(kbShort(kit.budgets.maxGzipKbPerPackage))}, with two declared overrides: ${Object.entries(kit.budgets.overrides ?? {}).map(([n, o]) => `<code>${esc(n)}</code> at ${esc(kbShort(o.maxGzipKb))}`).join(', ')}</td></tr>
            <tr><th>frame budget</th><td>${esc(String(kit.budgets.maxFrameBudgetMs))} ms. The direct draw path spends <strong>${esc(String(fig('spriteDraw')))}</strong> of it on 400 sprites of 42 ops &mdash; 27%, measured, with no sprite bitmap cache anywhere in <code>draw</code><span class="prov">${esc(source('spriteDraw'))}</span></td></tr>
          </tbody>
        </table>
      </div>

${packageNames.map(packageHtml).join('\n')}

      <h3>What holds between packages</h3>
      <p>Claims no single package's suite can check, because each is about two packages agreeing. They live in
      <a href="${tree('test/contracts')}"><code>test/contracts/</code></a> and each records how it breaks.</p>
      <div class="scroller">
        <table>
          <thead><tr><th>claim</th><th>between</th><th>breaks as</th></tr></thead>
          <tbody>
${kit.contracts.map((c) => `            <tr><td>${esc(c.claim)}</td><td>${c.packages.map((p) => `<code>${esc(p)}</code>`).join(' ')}</td><td>${esc(c.breaksAs)}</td></tr>`).join('\n')}
          </tbody>
        </table>
      </div>
    </div>
  </section>

</main>

${footer()}

</div>
</body>
</html>
`;
/* ── llms.txt ──────────────────────────────────────────────────────────────────────────── */

const llms = `# Lattice

> ${kit.tagline} A TypeScript kit for building isometric, deterministic, zero-asset games.
> Nine composable libraries, no dependencies of any kind, no asset files, ${kb(fig('gzipTotal'))} gzipped
> for all of them, and ${commas(fig('tests'))} tests. Repository: ${REPO_URL}

This file is the whole kit in the form an agent wants it. Everything in it is generated from
\`.lattice/kit.json\` and \`site/data/*.json\` at build time, so it cannot disagree with the code.
The same content as JSON is at /api.json; the repository's own manifest is at /kit.json.

## Install

    npm i @latticekit/core @latticekit/iso @latticekit/draw @latticekit/loop @latticekit/input

Add \`@latticekit/audio\`, \`@latticekit/persist\`, \`@latticekit/sim\` and \`@latticekit/ui\` as you need them.
There are no peer dependencies and nothing transitive.

## The rules that bind every package

1. Determinism is a feature. \`Math.random()\`, \`Date.now()\` and \`performance.now()\` are banned
   inside every package's \`src/\`. Randomness comes from a seeded \`Rng\` the caller passes in;
   time arrives as a parameter. It has two tiers: Tier A is \`+ - * /\`, \`sqrt\`, \`imul\` and the
   bitwise operators, which ECMA-262 specifies exactly and which may reach a save file. Tier B is
   \`sin\`, \`cos\`, \`pow\`, \`exp\`, \`log\`, which the spec does not require to be correctly rounded
   and which may reach pixels only. Every Tier B site is marked \`@tier-b\` and is greppable.
2. No dependencies. Not on npm, not on the DOM unless the package name says so, and on each
   other only along the layering below.
3. The dependency graph is a DAG and points one way. \`core\` imports nothing; nothing imports \`ui\`.
4. Pure and impure never mix in one file. A module that touches \`window\`, \`document\`,
   \`AudioContext\` or \`localStorage\` says so in its first doc line.
5. Every public symbol is documented with a *why*, not a *what*.
6. No public API without a test that would fail if it were deleted. ${(kit.budgets.coverageStatements * 100).toFixed(0)}% statements per
   package, ${(kit.budgets.coverageCore * 100).toFixed(0)}% on everything in \`core\`.
7. The hot path allocates nothing. Anything called per frame or per entity takes an output
   parameter or returns a primitive.
8. Zero assets. No images, no audio files, no fonts, no binaries. Art is procedural, sound is
   synthesized.
9. Errors name the caller's mistake, never a bare \`Error\`.
10. Green is not evidence. A UX-affecting change ends with somebody looking at the thing running.
11. An option a caller supplied is a value they can read back.

## Is this ready? What is stable and what is not

Version ${kit.version}. Nothing is published to npm yet.

Stable: the ${commas(fig('publicSymbols'))} exported names (\`npm run lint\` fails the build if a package exports a name
\`.lattice/kit.json\` does not list); their behavior (${commas(fig('tests'))} tests, ${(kit.budgets.coverageStatements * 100).toFixed(0)}% statements per package,
${(kit.budgets.coverageCore * 100).toFixed(0)}% in core); the layering and the determinism rule, both lint-enforced; the per-package size budgets.

Not stable: function signatures, because nothing has shipped to a registry and nothing outside this
repository uses them yet; the \`/lattice\` plugin, which is specified in docs/SKILLS.md and not built;
the gallery, which is ${gallery.live.length} of ${gallery.live.length + gallery.pending.length} exhibits; the API reference, which lists names and not signatures.

Versioning: semver, with the pre-1.0 rule stated — a minor bump may break source compatibility, a
patch never does. The nine packages version and publish in lockstep, one number for the whole kit.
Two kinds of breakage are tracked separately: source breaks, which a compiler finds, and artifact
breaks, which make something already written down invalid (a save, a replay log, a shared seed).
The second kind ships with a migration or it does not ship. docs/SEAMS.md is the list.

## Browser support

Canvas2D. No WebGL, no WebGPU, no WebAssembly, no workers, no OffscreenCanvas. Beyond the canvas:
\`requestAnimationFrame\`, \`ResizeObserver\`, and Pointer Events with \`setPointerCapture\`.
\`@latticekit/persist\` uses \`localStorage\` behind a swappable adapter; \`@latticekit/audio\` uses
\`AudioContext\` and needs a user gesture before it makes a sound. Neither is required by the rest.

Published as ES2022 ES modules, unminified. The newest syntax in the built output is private class
fields and \`Array.prototype.at\`, which puts the floor at about Chrome 92, Edge 92, Firefox 90 and
Safari 15.4 — spring 2022. That floor is read off the compiler target and the built output, not off
a browser test matrix: CI runs the suite in Node on 20.19, 22 and 24 and there is no browser matrix.

## Why not Phaser, Pixi or Three

Each is better than this at what it is for and none of them is for this. Three is a 3D renderer;
an isometric game is a 2D projection with a sorting rule, and a scene graph is a large dependency
for a coordinate transform. Pixi is a fast 2D renderer and nothing else, so the projection, depth
sort, pathfinding, seeded noise, save migrations and sound remain yours to write — which is most of
what these nine packages are. Phaser is the closest and fairest comparison: a complete engine with
scenes, physics, input, audio and a loader, and a decade of documentation. If you want a game
engine, use Phaser.

Three things here are not on that list: determinism by rule rather than by discipline (the clock
and the random source are lint errors inside a package, which is what makes a replay land on the
same pixel); no asset pipeline at all, because art is derived and sound is synthesized; and a kit
written to be handed to an agent, with the manifest, invariants, contracts and known traps
machine-readable at /api.json. If none of those is worth anything to you, use Phaser.

## The layering

${kit.layers.map((l) => `    layer ${l.layer}: ${l.packages.join(', ')}`).join('\n')}

## The packages

${packageNames
  .map((n) => {
    const p = kit.packages[n];
    const s = sizeOf(n);
    return `### ${p.name}${s === undefined ? '' : ` (${kb(s.gzipKb)} gzipped)`}

${p.purpose}

- layer: ${layerOf(n)}; environment: ${p.environment}; depends on: ${p.dependsOn.length === 0 ? 'nothing' : p.dependsOn.join(', ')}
- modules: ${p.modules.join(', ')}
- start with: ${(p.entryPoints ?? []).length === 0 ? '(none declared)' : p.entryPoints.join(', ')}
- invariants:
${p.invariants.map((i) => `  - ${i}`).join('\n')}
- exports (${p.exports.length}): ${p.exports.join(', ')}
`;
  })
  .join('\n')}

## Cross-package contracts

${kit.contracts.map((c) => `- **${c.claim}** (${c.packages.join(' + ')}) — breaks as: ${c.breaksAs}. Tested in \`${c.test}\`.`).join('\n')}

## A program that compiles

${exampleBody
  .split('\n')
  .map((l) => `    ${l}`)
  .join('\n')}

## The gallery

Each exhibit is a complete, runnable page under \`examples/\`, under 200 lines of logic, seeded
from its URL, with a control panel exposing the kit parameters it uses.

- **${gallery.hero.name}** (the hero) — ${gallery.hero.caption} — \`examples/${gallery.hero.dir}\` — uses ${gallery.hero.packages.join(', ')}
${gallery.live.map((x) => `- **${x.name}** — ${x.caption} ${x.idea} — \`examples/${x.dir}\` — measured: ${x.fact} (${x.factFrom})`).join('\n')}

Specified but not yet built: ${gallery.pending.map((p) => `${p.name} (${p.idea})`).join('; ')}.

## Traps that cost this project real time

- **An animated color is an allocator.** \`draw\`'s Canvas2D backend caches each radial ramp
  against the exact color pair it was built from, and the cache evicts wholesale. A color that
  moves continuously — a flame mixed against noise, a palette lerping every frame — misses every
  frame and takes every other call site's entry down with it. Snap the color to eight or twelve
  levels; keep position, scale and timing continuous.
- **\`loop.stats.worstFrameMs\` cannot see a pause between pumps.** Use \`worstGapMs\`. One exhibit
  read 4.6 ms and 69.2 ms from the two at the same instant.
- **A frame readout of 0.0 ms means the tab is hidden**, not that you are fast. Check
  \`document.visibilityState\` before believing a number read through tooling.
- **There is no sprite bitmap cache in \`draw\`.** "Cache it" is not a move available to you; the
  direct path is ${measured.figures.spriteDraw.value} for 400 sprites of 42 ops, 27% of the 8 ms budget.
- **\`readonly\` is not a barrier.** TypeScript ignores property \`readonly\` when checking
  assignability, so a \`Readonly<Vec2>\` flows into a parameter typed \`Vec2\` and the callee writes
  to your frozen constant. Import \`ReadonlyVec2\` from \`@latticekit/core\`; never hand-write
  \`Readonly<Vec2>\` and assume it is the same thing.
- **Tile lookup floors, never rounds**, and once elevation exists the projection is no longer
  invertible, so picking must be terrain-aware — \`screenToTileOnHeights\`, not \`screenToTile\`.
  The naive version misses by over a thousand pixels at the top of a hill.

## Measured figures, and the command behind each

${Object.entries(measured.figures).map(([k, v]) => `- ${k}: ${v.value}${v.unit === '' ? '' : ` ${v.unit}`} — ${v.source}`).join('\n')}

Measured at ${measured.commit} on ${measured.measuredOn}, ${measured.machine}.

## Further reading in the repository

- ${src('AGENTS.md')} — the constitution, and the eleven rules above in full
- ${src('docs/ARCHITECTURE.md')} — how the nine fit together
- ${src('docs/PERFORMANCE.md')} — every benchmark, with the tail argument
- ${src('docs/GALLERY.md')} — what makes an exhibit good, and the scale standard
- ${src('docs/SKILLS.md')} — the agent skills and the \`/lattice\` command
`;

/* ── api.json ──────────────────────────────────────────────────────────────────────────── */

const api = {
  $comment:
    'The landing page as data. Generated from .lattice/kit.json and site/data/*.json at build time; do not edit. The prose equivalent is /llms.txt.',
  generated: new Date().toISOString().slice(0, 10),
  commit: measured.commit,
  name: kit.name,
  tagline: kit.tagline,
  version: kit.version,
  license: kit.license,
  repository: REPO_URL,
  install: 'npm i @latticekit/core @latticekit/iso @latticekit/draw @latticekit/loop @latticekit/input',
  measured: measured.figures,
  sizes: measured.sizes,
  budgets: kit.budgets,
  layers: kit.layers,
  packages: Object.fromEntries(
    packageNames.map((n) => [
      n,
      {
        ...kit.packages[n],
        layer: layerOf(n),
        gzipKb: sizeOf(n)?.gzipKb ?? null,
        budgetKb: budgetOf(n),
        source: tree(`packages/${n}`),
        readme: src(`packages/${n}/README.md`),
      },
    ]),
  ),
  contracts: kit.contracts,
  /** The adopter's four questions, in the same file the agent already reads. They were on the
   *  page in prose and nowhere in the data, which is the mirror image of the reviewer's complaint
   *  about provenance and would have been just as easy to catch. */
  readiness: {
    version: kit.version,
    publishedToNpm: false,
    stable: [
      'the exported names — `npm run lint` fails the build if a package exports a name .lattice/kit.json does not list',
      `their behavior — ${commas(fig('tests'))} tests, ${(kit.budgets.coverageStatements * 100).toFixed(0)}% statements per package and ${(kit.budgets.coverageCore * 100).toFixed(0)}% in core, enforced`,
      'the layering and the determinism rule, both lint-enforced',
      'the per-package gzip budgets',
    ],
    notStable: [
      'function signatures: nothing has shipped to a registry, so nothing outside this repository uses them yet',
      'the /lattice plugin: specified in docs/SKILLS.md, not built',
      `the gallery: ${gallery.live.length} of ${gallery.live.length + gallery.pending.length} exhibits`,
      'the API reference: names, not signatures — the manifest carries no types',
    ],
    versioning: {
      scheme: 'semver',
      preOneRule: 'a minor bump may break source compatibility; a patch never does',
      lockstep: 'the nine packages version and publish together, one number for the whole kit',
      breakageKinds: {
        source: 'a renamed symbol or a changed signature. Loud; the compiler finds every one.',
        artifact:
          'a change that invalidates something already written down — a save, a replay log, a shared seed. Silent. Ships with a migration or does not ship. See docs/SEAMS.md.',
      },
    },
  },
  browsers: {
    renderer: 'Canvas2D',
    requires: ['Canvas2D', 'requestAnimationFrame', 'ResizeObserver', 'PointerEvent', 'setPointerCapture'],
    optional: {
      '@latticekit/persist': 'localStorage, behind a swappable storage adapter',
      '@latticekit/audio': 'AudioContext; needs a user gesture before it makes a sound',
    },
    doesNotUse: ['WebGL', 'WebGPU', 'WebAssembly', 'Web Workers', 'OffscreenCanvas'],
    output: 'ES2022 ES modules, unminified',
    floor: {
      chrome: 92,
      edge: 92,
      firefox: 90,
      safari: 15.4,
      derivedFrom:
        'the compiler target plus the newest syntax actually present in the built output — private class fields and Array.prototype.at. NOT a browser test matrix: CI runs the suite in Node on 20.19, 22 and 24.',
    },
  },
  alternatives: {
    three: 'a 3D renderer. An isometric game is a 2D projection with a sorting rule; a scene graph and a camera stack are a large dependency for a coordinate transform.',
    pixi: 'a fast 2D renderer and nothing else, so the projection, depth sort, pathfinding, seeded noise, save migrations and sound are still yours to write — which is most of what these nine packages are.',
    phaser: 'the closest and fairest comparison: a complete engine with scenes, physics, input, audio and a loader, and a decade of documentation. If you want a game engine, use Phaser.',
    whatIsDifferentHere: [
      'deterministic by rule, not by discipline: the clock and the random source are lint errors inside a package, which is what makes a replay land on the same pixel',
      'no asset pipeline at all: art is derived from one color per solid, sound is synthesized from a declaration',
      'written to be handed to an agent: manifest, invariants, contracts and known traps machine-readable here',
    ],
  },
  gallery: {
    hero: { ...gallery.hero, source: tree(`examples/${gallery.hero.dir}`), live: `/x/${gallery.hero.dir}/` },
    exhibits: gallery.live.map((x) => ({ ...x, source: tree(`examples/${x.dir}`), live: `/x/${x.dir}/` })),
    specifiedNotBuilt: gallery.pending,
  },
  example: { path: 'site/example/hello.ts', source: src('site/example/hello.ts'), code: example },
};

/* ── write ─────────────────────────────────────────────────────────────────────────────── */

mkdirSync(join(site, 'public'), { recursive: true });
mkdirSync(join(site, 'reference'), { recursive: true });
writeFileSync(join(site, 'index.html'), html);
writeFileSync(join(site, 'reference/index.html'), referenceHtml);
writeFileSync(join(site, 'public/llms.txt'), llms);
writeFileSync(join(site, 'public/api.json'), `${JSON.stringify(api, null, 2)}\n`);
writeFileSync(join(site, 'public/kit.json'), readFileSync(join(repo, '.lattice/kit.json')));

const bytes = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} kB`;
console.log(`site/index.html        ${bytes(html)}`);
console.log(`site/reference/index.html ${bytes(referenceHtml)}`);
console.log(`site/public/llms.txt   ${bytes(llms)}`);
console.log(`site/public/api.json   ${bytes(JSON.stringify(api, null, 2))}`);
console.log(`${packageNames.length} packages, ${gallery.live.length} live exhibits, ${Object.values(kit.packages).reduce((n, p) => n + p.exports.length, 0)} export rows`);
