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

/* ── the page ──────────────────────────────────────────────────────────────────────────── */

const heroSrc = `/x/${gallery.hero.dir}/`;

const proof = [
  { key: 'packages', value: String(fig('packages')), unit: '' },
  { key: 'dependencies', value: '0', unit: '' },
  { key: 'asset files', value: '0', unit: '' },
  { key: 'gzipped, all nine', value: fig('gzipTotal').toFixed(2), unit: 'kB' },
  { key: 'tests', value: commas(fig('tests')), unit: '' },
  { key: 'public symbols', value: commas(fig('publicSymbols')), unit: '' },
];

const flow = [
  ['01', 'Preflight', 'Node, a writable directory, and one question that is not about the game: whether Claude in Chrome is present. Without a browser the agent cannot look at what it built, and the kit&rsquo;s tenth rule is that green is not evidence. It warns, asks once, and does not refuse.'],
  ['02', 'Choose the shape', 'The idea maps to an archetype, a starting exhibit and a set of specialist skills. The choice is announced in one line, not put to a vote. Every question asked of the user is a failure to have chosen a default.'],
  ['03', 'Scaffold and install', 'This is the step where somebody would otherwise have to know that <code>draw</code> depends on <code>iso</code>, and they must never find out.'],
  ['04', 'Build to a running screen', 'A visibly working thing that is missing features beats a complete thing that appears at the end. The first screen should arrive inside a minute and already be recognizably theirs.'],
  ['05', 'Look at it', 'Open it, screenshot it, judge it, fix what is wrong, repeat. Reporting success on a build nobody has seen is the one thing the orchestrator may never do.'],
];

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
  return `      <article class="tile" data-src="/x/${x.dir}/" data-params="${esc(x.tileParams ?? '')}" data-name="${esc(x.name)}" data-w="${W}" data-h="${H}">
        <div class="stage" style="--w:${W};--h:${H}"></div>
        <button class="tile-run" type="button">Run ${esc(x.name)}</button>
        <div class="tile-body">
          <div class="tile-head">
            <h3>${esc(x.name)}</h3>
            <span>${esc(x.fact)}</span>
          </div>
          <p>${esc(x.caption)}</p>
          <p class="note">${esc(x.idea)}</p>
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

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Lattice &mdash; isometric, deterministic, zero-asset games in TypeScript</title>
<meta name="description" content="A TypeScript kit for isometric games. Nine libraries, no dependencies, no asset files, ${esc(kb(fig('gzipTotal')))} gzipped and ${commas(fig('tests'))} tests. Everything on this page is the kit running, not a picture of it.">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#141a38">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 12 60 28 32 44 4 28Z' fill='%23e0a13c'/%3E%3Cpath d='M32 20 46 28 32 36 18 28Z' fill='%23141a38'/%3E%3C/svg%3E">

<!-- Machine-readable mirrors of everything below. An agent should read these instead of this page. -->
<link rel="alternate" type="application/json" href="/api.json" title="The kit as JSON: packages, exports, invariants, budgets, measured figures">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="alternate" type="application/json" href="/kit.json" title="The repository's own .lattice/kit.json, verbatim">

<!-- The only inline script on the page, and the only way CSS can know whether the worlds below
     will ever run. Everything that is a live scene, a live number or an instruction to touch one
     is hidden by html:not(.js) - see page.css. docs/GALLERY.md asks this page to work without
     JavaScript "not gracefully - just honestly", and honesty here means not printing "drag it"
     over a rectangle that will never move. -->
<script>document.documentElement.classList.add('js')</script>

<link rel="preload" href="/fonts/ibm-plex-mono-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/src/page.css">
<script type="module" src="/src/page.ts"></script>

<script type="application/ld+json">
${JSON.stringify(
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'Lattice',
    alternateName: kit.tagline,
    description:
      'A TypeScript kit for isometric, deterministic, zero-asset games. Nine composable libraries with no dependencies.',
    programmingLanguage: 'TypeScript',
    codeRepository: REPO_URL,
    license: `https://opensource.org/licenses/${kit.license}`,
    version: kit.version,
    keywords: ['isometric', 'game development', 'deterministic', 'procedural', 'zero-asset', 'typescript'],
  },
  null,
  2,
)}
</script>
</head>
<body>

<noscript>
  <p class="banner">This page is a live demonstration: every world on it renders in your browser as you read.
  With JavaScript off you get the writing, the numbers and the complete API reference below, and none of the worlds.
  Nothing here is a screenshot, so there is nothing to fall back to. Source: <a href="${REPO_URL}">${esc(REPO_URL)}</a></p>
</noscript>

<canvas id="ground" aria-hidden="true"></canvas>

<div class="page">

<nav class="topbar">
  <a class="wordmark" href="/">lattice <small>v${esc(kit.version)}</small></a>
  <div class="topnav">
    <a href="#gallery">Gallery</a>
    <a href="#example">Example</a>
    <a href="#reference">Reference</a>
    <a href="/llms.txt">llms.txt</a>
    <a href="${REPO_URL}">GitHub</a>
  </div>
</nav>

<!-- data-w is the logical viewport the hero falls back to on a narrow screen; see Scene.scaledNow. -->
<header class="hero" data-src="${heroSrc}" data-name="${esc(gallery.hero.name)}" data-w="840">
  <div class="hero-stage"></div>
  <div class="hero-chrome">
    <p class="hint" style="margin:0">This header is a game &mdash; <b>drag it</b></p>
  </div>
</header>

<div class="statement">
  <div>
    <!-- Below the world, never over it. A finger has one gesture and the exhibit already owns
         the bottom of its own frame; a play button floating there covers the exhibit's. -->
    <button class="play" id="hero-play" type="button">Tap the world to play</button>
    <h1 class="hero-title">The grid<br>underneath.</h1>
    <p class="hero-sub">A TypeScript kit for isometric, deterministic, zero&#8209;asset games. Nine libraries, no
    dependencies, no asset files.<span class="js-only"> The valley above is
    <a href="${tree(`examples/${gallery.hero.dir}`)}">${esc(gallery.hero.name)}</a>, built from nothing but them &mdash;
    and it is <em>running</em>, not playing back. Everything on this page is.</span></p>
  </div>
  <div class="js-only" style="display:grid;gap:12px;justify-items:start">
    <dl class="meter">
      <dt>hero pump</dt><dd id="m-frame">&mdash;</dd>
      <dt>page cadence</dt><dd id="m-cadence">&mdash;</dd>
      <dt>page worst 10s</dt><dd id="m-worst">&mdash;</dd>
      <dt>scenes live</dt><dd id="live">0</dd>
    </dl>
    <p class="note" style="max-width:34ch">This page measures itself with <code>@latticekit/loop</code>. The worst figure is
    <code>worstGapMs</code>, not <code>worstFrameMs</code> &mdash; a pump that is fast between long pauses is not a page
    that is fast. It reads <code>hidden</code> in a background tab, because a frame time of 0.0&nbsp;ms means
    <code>requestAnimationFrame</code> stopped, not that anything got quicker.</p>
  </div>
</div>

<dl class="proof">
${proof.map((p) => `  <div><dt>${esc(p.key)}</dt><dd>${esc(p.value)}${p.unit === '' ? '' : `<small>${esc(p.unit)}</small>`}</dd></div>`).join('\n')}
</dl>

<main class="shell">

  <section class="section" id="what">
    <div class="marker"><a href="#what">/what</a></div>
    <div class="body">
      <p class="eyebrow">What it is</p>
      <h2>Nine libraries that compose, and nothing else in the tree.</h2>
      <p class="lede">Lattice is a kit, not an engine. There is no scene graph you have to adopt, no editor,
      no runtime that owns your <code>main</code>. You import the two or three packages you need and call
      them from your own loop.</p>
      <p>It installs with <strong>no transitive dependencies at all</strong>. <code>@latticekit/core</code> depends
      on nothing; every other package depends only on the ones below it, and the graph is a DAG that points one
      way. All nine together are <strong>${esc(kb(fig('gzipTotal')))} gzipped</strong> &mdash; smaller than the hero
      image on most framework sites.</p>
      <p>There are <strong>no asset files anywhere in it</strong>, and no loader. Art is drawn: a solid is
      described by one color and its faces are derived, shadows cool and highlights warm. Sound is synthesized
      from declarative definitions. Everything you can see and hear on this page was computed on the way to
      the screen, which is also why a Lattice game is a few dozen kilobytes, recolorable at runtime, and
      diffable in review.</p>
      <p>And it is <strong>deterministic on purpose</strong>. <code>Math.random()</code>, <code>Date.now()</code>
      and <code>performance.now()</code> are banned inside every package &mdash; randomness comes from a seeded
      <code>Rng</code> you pass in, and time arrives as a parameter. Same seed, same world, on every machine.
      That single constraint is what buys the shareable link, the replay that lands on the same pixel, and a
      scrub bar that re-runs a million years of erosion instead of looking it up.</p>

      <div class="scroller">
        <table>
          <caption class="eyebrow" style="text-align:left;padding-bottom:12px">The nine</caption>
          <thead><tr><th>package</th><th>layer</th><th>what it is for</th><th class="num">gzip</th></tr></thead>
          <tbody>
${packageNames
  .map((n) => {
    const p = kit.packages[n];
    const s = sizeOf(n);
    return `            <tr><td><a href="#pkg-${n}"><code>${esc(p.name)}</code></a></td><td>${layerOf(n)}</td><td>${esc(p.purpose)}</td><td class="num">${s === undefined ? '&mdash;' : esc(kb(s.gzipKb))}</td></tr>`;
  })
  .join('\n')}
          </tbody>
        </table>
      </div>
      <p class="note">Sizes are <code>npm run size</code> at ${esc(measured.commit)}. Exclusive backends are charged at
      the heaviest bundle, never summed &mdash; a browser game builds the Canvas2D surface, a headless replay builds the
      recording one, and nobody ships both.</p>
    </div>
  </section>

  <section class="section" id="agent">
    <div class="marker"><a href="#agent">/agent</a></div>
    <div class="body">
      <p class="eyebrow">The agent story</p>
      <h2>Built to be handed to an agent.</h2>
      <p class="lede">Lattice is written for agents first and humans second, because that is who reads it most.
      The hard-won part of this kit is not its API &mdash; an agent can read a <code>.d.ts</code>. It is the set of
      failures that are individually surprising and jointly the difference between a working game and a
      plausible-looking broken one.</p>

      <p>So those ship too, as skills, in one command:</p>
      <p class="shell-cmd"><span class="prompt">/lattice</span> <span class="arg">a game where you rebuild a lighthouse and the light pushes back the fog</span></p>
      <p>Everything after <code>/lattice</code> is the game. There is no flag, no subcommand and no mode, and nothing
      with a right answer the agent could have worked out is put to the user. What happens next:</p>

      <ol class="flow">
${flow.map(([n, title, body]) => `        <li><b>${n}</b><div><strong>${title}</strong><span>${body}</span></div></li>`).join('\n')}
      </ol>
      <p class="note">The plugin is the last thing this project ships and is in flight now. The flow above is its
      specification, from <a href="${src('docs/SKILLS.md')}">docs/SKILLS.md</a>, rather than a promise about a build.
      The test that decides whether it shipped is one run: somebody who has never seen the repository installs it,
      types one sentence about a game, touches nothing else, and ends up looking at that game in a browser.</p>

      <h3 style="margin-top:44px;font-size:19px;letter-spacing:-.02em">And this page is readable by an agent too</h3>
      <p>An agent that lands here with no other context can get the whole kit without parsing a single
      paragraph of marketing:</p>
      <div class="scroller">
        <table>
          <thead><tr><th>at</th><th>what it holds</th></tr></thead>
          <tbody>
            <tr><td><a href="/llms.txt"><code>/llms.txt</code></a></td><td>the kit in one plain-text file: what it is, the rules that bind it, all nine packages with their entry points and invariants, every exhibit with its source path, and a program that compiles.</td></tr>
            <tr><td><a href="/api.json"><code>/api.json</code></a></td><td>the same thing as JSON: every package, all ${commas(fig('publicSymbols'))} public symbols, the invariants, the cross-package contracts, the size budgets, and the measured figures with the command that produced each one.</td></tr>
            <tr><td><a href="/kit.json"><code>/kit.json</code></a></td><td>the repository's own <code>.lattice/kit.json</code>, verbatim &mdash; the file the build fails over if a package exports a symbol that is not in it.</td></tr>
            <tr><td>this page</td><td>real headings with stable ids, a table per package, and every code block liftable as text. The reference below is generated from <code>kit.json</code> at build time, so it cannot drift from the kit it describes.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section" id="gallery">
    <div class="marker"><a href="#gallery">/gallery</a></div>
    <div class="body">
      <p class="eyebrow">The gallery</p>
      <h2>${['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen'][gallery.live.length] ?? String(gallery.live.length)} worlds, running on this page right now.</h2>
      <p class="lede">Not screenshots. Not video. Each tile is the exhibit itself, rendering live at its own
      viewport and scaled into the grid. It starts when it comes near your screen and its loop is
      <em>stopped</em> the moment it leaves &mdash; which is how a page with this many live scenes on it stays
      affordable on a phone.</p>
      <p>Every one takes its seed from the URL, so the world you are looking at is a link you can send. Every one
      ships a control panel that moves the kit's real parameters, with the wrong end of each slider marked. And
      every one links to its source, because a visitor who likes a tile wants the file.</p>

      <p class="note rm-note">You have asked your browser for reduced motion, so nothing on this page starts by
      itself. Every tile below is built and painted once, and stays on that frame until you press <em>Run</em>.</p>

      <div class="grid">
${gallery.live.map(tileHtml).join('\n')}
      </div>

      <p class="note"><a href="${src('docs/GALLERY.md')}">docs/GALLERY.md</a> specifies eighteen exhibits and one hero.
      ${gallery.live.length} are built and above; the hero is the header. Not yet built:
      ${gallery.pending.map((p) => esc(p.name)).join(', ')}. They are named here rather than left out because a
      gallery that quietly ships fewer than it promised is the one thing a gallery must not do.</p>
    </div>
  </section>

  <section class="section" id="example">
    <div class="marker"><a href="#example">/example</a></div>
    <div class="body">
      <p class="eyebrow">A whole program</p>
      <h2>This is all of it.</h2>
      <p class="lede">A seeded town on rolling ground, with a camera you can drag, zoom to the pointer and pinch.
      No config file, no scene format, no build step past a bundler.</p>
      <pre class="code"><code>${highlight(exampleBody)}</code></pre>
      <p class="note">That is a real file &mdash; <a href="${src('site/example/hello.ts')}"><code>site/example/hello.ts</code></a> &mdash;
      and the page's build typechecks it against the built packages before printing it. If a signature in the kit
      changes, this page fails to build instead of quietly showing something that no longer works.</p>
      <p class="shell-cmd"><span class="prompt">npm i</span> <span class="arg">@latticekit/core @latticekit/iso @latticekit/draw @latticekit/loop @latticekit/input</span></p>
    </div>
  </section>

  <section class="section" id="reference">
    <div class="marker"><a href="#reference">/reference</a></div>
    <div class="body">
      <p class="eyebrow">API reference</p>
      <h2>Every public symbol, from the manifest.</h2>
      <p class="lede">Generated from <a href="${src('.lattice/kit.json')}"><code>.lattice/kit.json</code></a> at build
      time. <code>npm run lint</code> fails the repository's build if a package exports a symbol that file does not
      list, so this reference cannot drift from the kit &mdash; it is the same file the agents read.</p>

      <div class="scroller">
        <table>
          <caption class="eyebrow" style="text-align:left;padding-bottom:12px">The budgets it is held to</caption>
          <tbody>
            <tr><th>statements covered</th><td>${(kit.budgets.coverageStatements * 100).toFixed(0)}% per package, ${(kit.budgets.coverageCore * 100).toFixed(0)}% on everything in <code>core</code></td></tr>
            <tr><th>gzipped per package</th><td>${esc(kbShort(kit.budgets.maxGzipKbPerPackage))}, with two declared overrides: ${Object.entries(kit.budgets.overrides ?? {}).map(([n, o]) => `<code>${esc(n)}</code> at ${esc(kbShort(o.maxGzipKb))}`).join(', ')}</td></tr>
            <tr><th>frame budget</th><td>${esc(String(kit.budgets.maxFrameBudgetMs))} ms. The direct draw path spends <strong>${esc(String(fig('spriteDraw')))}</strong> of it on 400 sprites of 42 ops &mdash; 27%, measured, with no sprite bitmap cache anywhere in <code>draw</code></td></tr>
            <tr><th>tests</th><td>${commas(fig('tests'))} across ${commas(fig('testFiles'))} files, all green at <code>${esc(measured.commit)}</code></td></tr>
          </tbody>
        </table>
      </div>

${packageNames.map(packageHtml).join('\n')}

      <h3 style="margin-top:44px;font-size:19px;letter-spacing:-.02em">What holds between packages</h3>
      <p>Four claims no single package's test suite can check, because each of them is about two packages
      agreeing. They live in <a href="${tree('test/contracts')}"><code>test/contracts/</code></a> and each one
      records how it breaks, so a failure names a symptom rather than an assertion.</p>
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

<footer class="shell">
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
        <li><a href="${src('docs/ARCHITECTURE.md')}">Architecture</a></li>
        <li><a href="${src('docs/PERFORMANCE.md')}">Performance</a></li>
        <li><a href="${src('docs/GALLERY.md')}">The gallery brief</a></li>
        <li><a href="${src('docs/SEAMS.md')}">Seams</a></li>
      </ul>
    </div>
    <div class="colophon">
      <h4>Colophon</h4>
      <p style="margin:0">This page draws its own background with <code>@latticekit/draw</code> and lights itself with
      <code>lerpPalette(DUSK, NIGHT, scroll)</code> &mdash; the kit's day cycle, running on a document instead of a
      canvas, repainted <span id="repaints">0</span> times so far. Set in IBM Plex, self-hosted &mdash; ${fontKb} kB of font, and the only asset this page has.
      ${esc(kit.license)}-licensed. Figures measured at <code>${esc(measured.commit)}</code> on ${esc(measured.measuredOn)}.</p>
    </div>
  </div>
</footer>

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
  gallery: {
    hero: { ...gallery.hero, source: tree(`examples/${gallery.hero.dir}`), live: `/x/${gallery.hero.dir}/` },
    exhibits: gallery.live.map((x) => ({ ...x, source: tree(`examples/${x.dir}`), live: `/x/${x.dir}/` })),
    specifiedNotBuilt: gallery.pending,
  },
  example: { path: 'site/example/hello.ts', source: src('site/example/hello.ts'), code: example },
};

/* ── write ─────────────────────────────────────────────────────────────────────────────── */

mkdirSync(join(site, 'public'), { recursive: true });
writeFileSync(join(site, 'index.html'), html);
writeFileSync(join(site, 'public/llms.txt'), llms);
writeFileSync(join(site, 'public/api.json'), `${JSON.stringify(api, null, 2)}\n`);
writeFileSync(join(site, 'public/kit.json'), readFileSync(join(repo, '.lattice/kit.json')));

const bytes = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} kB`;
console.log(`site/index.html        ${bytes(html)}`);
console.log(`site/public/llms.txt   ${bytes(llms)}`);
console.log(`site/public/api.json   ${bytes(JSON.stringify(api, null, 2))}`);
console.log(`${packageNames.length} packages, ${gallery.live.length} live exhibits, ${Object.values(kit.packages).reduce((n, p) => n + p.exports.length, 0)} export rows`);
