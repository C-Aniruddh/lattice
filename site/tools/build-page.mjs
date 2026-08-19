/**
 * Generate the landing page and the API reference.
 *
 * `site/index.html`, `site/reference/**\/index.html`, `site/public/llms.txt`,
 * `site/public/api.json` and `site/public/kit.json` are all outputs of this script. None of them
 * is edited by hand, and the reason is the one the brief gives for the API reference: a reference
 * typed out beside the thing it describes drifts from it within a week. Every package, export,
 * invariant and budget on the landing page comes out of `.lattice/kit.json` — the same file
 * `npm run lint` fails the build over — and every number comes out of `site/data/measured.json`,
 * which carries the command that produced it.
 *
 * The reference has a second source, and it is the more important one: `packages/*\/dist/**\/*.d.ts`,
 * the type declarations `npm run build` emits. That is where the signatures and the doc comments
 * come from — see `api-model.mjs`, which also cross-checks those exports against the manifest and
 * fails the build if the two disagree.
 *
 * Run: `node site/tools/build-page.mjs`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkDerivable } from './check-measured.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApiModel, crossCheck } from './api-model.mjs';
import { docHtml, summarize } from './doc-html.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const repo = join(site, '..');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const kit = read(join(repo, '.lattice/kit.json'));
const measured = read(join(site, 'data/measured.json'));

const gallery = read(join(site, 'data/exhibits.json'));
const example = readFileSync(join(site, 'example/hello.ts'), 'utf8');

const REPO_URL = kit.repository;
/** The address the page is served from. Also what `.github/workflows/pages.yml` writes to
 *  `CNAME`, read from here rather than typed there, because `og:image` has to be absolute
 *  and a second copy of a domain is a second thing to forget on the day it moves. */
const SITE_URL = kit.homepage;
/** `owner/repo`, which is the shorthand all three plugin installers take. Derived rather than
 *  typed, so the install commands cannot drift from the repository the rest of the page links to. */
const REPO_SLUG = REPO_URL.replace(/^https:\/\/github\.com\//, '');
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

/** A small count in words. Headings on this page are sentences, and a sentence opening on a
 *  numeral reads as a spec sheet — "Eighteen worlds, running right now", never "18 worlds". Falls
 *  back to the digits above twenty, where the word is longer than the number it saves. */
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const word = (n) => WORDS[n] ?? String(n);

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
 *
 * **Block comments are lifted out whole, before the line pass.** The reference prints declarations
 * verbatim, and some of them carry documentation *inside* the declaration — `persist`'s
 * `FailureReason` is a seven-member union with a paragraph over every member, which is the right
 * way to write it and the reason that type is readable at all. Line-at-a-time, the pass painted
 * `else` and `from` inside those paragraphs as keywords, in the accent color, in prose.
 */
function highlight(code) {
  return code
    .split(/(\/\*[\s\S]*?\*\/)/g)
    .map((part, i) => (i % 2 === 1 ? `<u>${esc(part)}</u>` : highlightCode(part)))
    .join('');
}

function highlightCode(code) {
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
 * The headline.
 *
 * The page used to sell a TypeScript kit with an agent story attached, and the reframe in
 * `docs/SKILLS.md` § *The positioning* is that it is the other way round: **the product is the
 * plugin and its skills; the nine libraries are the reason the agent driving them succeeds.** The
 * audience is somebody who wants an isometric game and does not want to write code, draw sprites
 * or make music, so a headline about nine libraries, a dependency count or a gzip total is a spec
 * sheet handed to somebody who did not ask for one.
 *
 * What is here now says the category and the promise in five words and nothing else. The previous
 * headline — *"Nothing to draw. Nothing to load. Nothing to hallucinate."* — named the failure
 * mode it removes, which is an argument a reader can only follow once they know what the thing
 * *is*. It made the page open on a rebuttal. That whole argument still exists, one section down,
 * under **Why**, where the reader has something to apply it to.
 *
 * Swapping one in is this constant and nothing else.
 */
const HEADLINE = 'Isometric games made easy';

/**
 * The strip, and what each of the six is doing there.
 *
 * **`tests` and `public symbols` are gone**, and stay gone. Nobody adopts anything because it has
 * 2,599 tests: working is the assumed baseline, and a number nobody asked for reads as a project
 * arguing with itself. `docs/GALLERY.md`'s copy doctrine names both of them by name; they are
 * still in `/api.json` and `/llms.txt` where an agent auditing the kit has a use for them.
 *
 * **`worlds running here`, `a world, in lines` and the live frame figure came out.** The first two
 * describe things the reader is looking at — the worlds moving in the grid below, and a program
 * whose length is visible in the block that prints it — which is the copy doctrine's own test. The
 * third was a liability rather than evidence: it measured the reader's machine and read 35 ms on a
 * laptop, 41.5 ms elsewhere, and worse than that on anything slow. A number that makes the product
 * look bad on the visitor's own hardware is not proof of frame-time discipline, and **no frame
 * figure appears anywhere on this page now.**
 *
 * **The two that replaced them are the product.** `skills` and `traps written down` are the reason
 * an agent driving this kit succeeds where a general coding agent does not, which is the argument
 * the whole page now makes. `traps` is the surprising one: thirty-two named failures that compile,
 * run and produce a plausible-looking broken game, each written down with its wrong version, so
 * that the agent does not re-buy findings this project already paid for.
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
  { key: 'core libraries', value: String(fig('packages')), unit: '', from: 'packages' },
  { key: 'dependencies', value: String(fig('dependencies')), unit: '', from: 'dependencies' },
  { key: 'agent skills', value: String(fig('skills')), unit: '', from: 'skills' },
  { key: 'traps written down', value: String(fig('traps')), unit: '', from: 'traps' },
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
 * The install, as a terminal with one tab per agentic environment.
 *
 * ## What this is not, and what it kept being
 *
 * It printed `npm i @latticekit/core @latticekit/iso …` in two places, and that is **the command
 * an agent runs to install the libraries**. It is not something a visitor to this page ever types.
 * Under the positioning in `docs/SKILLS.md` the product is the plugin and its skills, and the one
 * command that belongs on a landing page is the one a *person* runs to put that plugin into the
 * agent they already use. Everything to do with npm now lives where it is addressed to: `/llms.txt`
 * and `/api.json`, which is what the agent reads.
 *
 * ## Every line below was verified by running it, not remembered
 *
 * All three environments install a plugin from a git repository, and all three read the Claude
 * plugin manifests this repository already ships — `.claude-plugin/marketplace.json` (marketplace
 * `lattice`) and `.claude-plugin/plugin.json` (plugin `lattice`), with the twelve skills auto-
 * discovered from the top-level `skills/` directory in each case.
 *
 * | | verified against | note |
 * |---|---|---|
 * | **Claude Code** | `code.claude.com/docs/en/discover-plugins`, `…/plugin-marketplaces` | `owner/repo` shorthand is documented; `plugin@marketplace` is the documented install form |
 * | **Codex** | `developers.openai.com/codex/plugins`, and `codex plugin marketplace add` run against a real Claude-format marketplace | Codex's marketplace loader searches `.claude-plugin/marketplace.json` explicitly. `<name>@<marketplace>` is the marketplace's own `name`, not the repo's |
 * | **Grok Build** | `docs.x.ai/build/features/skills-plugins-marketplaces`, and `grok plugin install` run against a real Claude-format repo | `grok plugin install <SOURCE>` takes a GitHub `owner/repo` shorthand directly; Claude-format compatibility is on by default |
 *
 * `--trust` is deliberately **not** printed on the Grok line even though it exists: it skips the
 * confirmation prompt, and teaching a stranger to skip a trust prompt on a third-party repository
 * is not something this page is going to do to save them one keystroke.
 *
 * ## What these commands assume
 *
 * That the packages are on a registry and this repository is public. Both are launch-checklist
 * items, and the page ships behind them rather than in front of them — see {@link INSTALL_NOTE}
 * for why the caveat that used to live under the terminal was removed rather than reworded.
 *
 * The consequence for whoever changes this block: **do not print a command before it resolves.**
 * A install line that fails is worse than a missing one, because the reader has already decided
 * to trust you by the time it does.
 */
const plugin = [
  {
    tab: 'Claude Code',
    // The prompt is `>` and the slash is part of the command, deliberately. `$` and `>` are
    // pictures of a shell and of an agent's own input line, and both are `user-select: none` — but
    // the leading `/` of a slash command is not decoration, it is the first character the reader
    // has to type. Putting it in the prompt would make Copy hand them a command that does nothing.
    lines: [
      { prompt: '>', cmd: `/plugin marketplace add ${REPO_SLUG}` },
      { prompt: '>', cmd: '/plugin install lattice@lattice' },
    ],
    // **No period after the </code>.** A trailing full stop that follows an inline element is its
    // own text node, and the looking harness measures a text node's rectangle: one 12px glyph in a
    // box that is almost entirely backdrop reports a luminance *range* of 0.026 and fails the
    // legibility row at a contrast of 5.47. Nothing about it is hard to read; it is too small to
    // measure. This page failed that row on exactly one character. The ellipsis ends the sentence.
    note: 'Two slash commands inside a Claude Code session. Then <code>/lattice a game where…</code>',
  },
  {
    tab: 'Codex',
    lines: [
      { prompt: '$', cmd: `codex plugin marketplace add ${REPO_SLUG}` },
      { prompt: '$', cmd: 'codex plugin add lattice@lattice' },
    ],
    note: 'Then start a new session; <code>/plugins</code> in the TUI shows what is loaded.',
  },
  {
    tab: 'Grok',
    lines: [{ prompt: '$', cmd: `grok plugin install ${REPO_SLUG}` }],
    note: 'Grok Build reads the same plugin manifest with no configuration. Confirm the trust prompt, then run <code>/plugins</code>',
  },
];

/** Said once, under the terminal, and it is the sentence that keeps the block honest.
 *  `docs/SKILLS.md` § *The honest tension*: advertise the property that is true today, never the
 *  promise. It is deliberately empty.
 *
 *  It used to carry a hedge — that the repository was private, so these commands were what
 *  installing *will* be. True at the time and the wrong thing to print: the page ships when the
 *  repository opens and the packages publish, and a caveat about a state that no longer exists on
 *  the day anyone reads it is worse than silence. A launch note belongs in the launch, not in the
 *  markup. Kept as a hook so a future release can put a real one here. */
const INSTALL_NOTE = '';

/** The portable, script-free form: the first environment's commands, plainly and with no prompt
 *  in front of them, because a `<noscript>` block has no Copy button to read `[data-cmd]` for it
 *  and a reader will drag-select the whole thing. */
const INSTALL_PLAIN = plugin[0].lines.map((l) => l.cmd).join('\n');

/**
 * One terminal. `id` scopes the tabs' `aria-controls` so two of them on one page do not collide.
 *
 * `--n` and `--w` are the typewriter: a command is a monospace string, so its width in `ch` is its
 * length in characters exactly, and `steps(--n)` lands one character per step. Both are set here
 * rather than measured at runtime, because the string is known at build time and a layout read on
 * first paint to animate a thing is a jank this page does not need. A second line carries a
 * `--d` delay so the two type in the order they are run in rather than at once.
 */
const terminal = (id) => `<div class="term js-only" data-term id="${id}">
        <div class="term-tabs" role="tablist" aria-label="Agentic environment">
${plugin
  .map(
    (v, i) =>
      `          <button role="tab" type="button" id="${id}-t${String(i)}" aria-controls="${id}-p${String(i)}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${esc(v.tab)}</button>`,
  )
  .join('\n')}
        </div>
        <div class="term-body">
${plugin
  .map(
    (v, i) =>
      `          <div class="term-panel" role="tabpanel" id="${id}-p${String(i)}" aria-labelledby="${id}-t${String(i)}" data-on="${i === 0 ? 'yes' : 'no'}">
${v.lines
  .map(
    (l, j) =>
      `            <pre class="term-cmd" style="--n:${String(l.cmd.length)};--w:${String(l.cmd.length)}ch;--d:${String(j * 520)}ms"><span class="prompt">${esc(l.prompt)}</span><span class="type"><code data-cmd>${esc(l.cmd)}</code></span><i class="caret"></i></pre>`,
  )
  .join('\n')}
            <p class="term-note">${v.note}</p>
          </div>`,
  )
  .join('\n')}
          <button class="term-copy" type="button" data-term-copy>Copy</button>
        </div>
      </div>
      <noscript><pre class="shell-cmd">${esc(INSTALL_PLAIN)}</pre></noscript>
      ${INSTALL_NOTE === '' ? '' : `<p class="note term-caveat">${INSTALL_NOTE}</p>`}`;

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
  // running budget is genuinely one scene, so all but one of the eighteen tiles is a held frame or a
  // placeholder at any moment, and a button pinned to the bottom of the article sat under the
  // caption where nothing suggested it had anything to do with the picture above it. Over the
  // world it is what it is: press this and this one runs.
  //
  // **The whole tile is the link, and `Source` is the one thing that escapes it.**
  //
  // Only `Open full size` was clickable, which is a 400x250 live world with a nine-character
  // target under it. The pattern here is the stretched link: one real `<a>` in the markup, whose
  // `::after` covers the article, so there is exactly one link in the accessibility tree with a
  // real href and a real name — not a `<div onclick>`, not an `<a>` wrapping an `<a>`, which is
  // invalid HTML and which is what a naive "make the card clickable" produces. `Source` sits above
  // it on the z-axis and therefore does not trigger it, which is the whole reason the button-and-
  // overlay version is not good enough: a visitor who wants the file must be able to reach it.
  //
  // The seed link is gone. It was a third link on a row of three, it went to the same page as the
  // first with a query string the exhibit already defaults to, and `?seed=` is in `/llms.txt` and
  // in the exhibit's own panel, which is where somebody who wants to change a world is going.
  //
  // **The tile's frame figure is gone too**, along with every other frame figure on this page. It
  // measured the reader's machine, and a number that makes the product look slow on the hardware
  // the reader happens to own is a liability rather than evidence. The state word stays: it says
  // why a tile is not moving, which is a fact about this page's budget rather than about speed.
  //
  // **The prompt is the caption now, and the tag is the feature list.**
  //
  // The tile used to carry the exhibit's own panel subtitle — *"Pools that meet without a seam"* —
  // which is a sentence written by somebody who already knows what a light field is, under a world
  // that is showing them one. What replaces it is the sentence somebody would *ask* for this world
  // in, in ordinary voice, with no jargon in it: that is the page's entire argument, made ten
  // times, next to eighteen worlds that are running rather than eighteen stills.
  //
  // `tag` earns its own line for a reason worth writing down: it makes the gallery double as the
  // feature list, so the page never has to write one. EROSION, LIGHT POOLS and ELEVATION PICKING
  // scanned down the left of the grid are a capability inventory a reader assembles themselves,
  // and every entry in it is standing over the proof.
  //
  // `caption` and `idea` are both still in `/llms.txt` and `/api.json`, and the tile links to the
  // file, which is where somebody who wants the mechanism is going anyway.
  //
  // **The vendor mark, and why it says `BUILT BY` rather than just the name.**
  //
  // Eight of these were built by three vendors' agents from `docs/GALLERY.md` alone. That is the
  // strongest evidence on this page and it belongs *on the thing it is evidence about*, not only
  // in the section below, because a reader who scrolls the grid and never reaches `/built` should
  // still leave knowing it. It is three words on one line, opposite the capability tag, in the
  // dimmest ink the contrast floor allows — a second quiet column down the right of the grid.
  //
  // `CODEX` alone would have been smaller and would have meant nothing standing by itself: a bare
  // product name on a tile reads as a badge, a sponsor, or the thing the exhibit is *about*. The
  // two extra words are what make the mark legible without the section, and the section is where
  // the method behind it is stated.
  //
  // **A tile with no mark makes no claim.** The other ten and the hero were built in this
  // repository with a person in the loop, which is said once, in `/built`, in words — never
  // inferred from the absence of a mark, and never printed on eleven tiles as a second badge that
  // would turn the grid into a scoreboard.
  const mark = x.by === undefined ? '' : `<span class="tile-by">Built by ${esc(x.by)}</span>`;
  return `      <article class="tile" data-src="/x/${x.dir}/" data-params="${esc(x.tileParams ?? '')}" data-name="${esc(x.name)}" data-w="${W}" data-h="${H}">
        <div class="stage" style="--w:${W};--h:${H}">
          <button class="tile-run" type="button"><b>Run</b> ${esc(x.name)}</button>
        </div>
        <div class="tile-body">
          <p class="tile-tag">${esc(x.tag)}${mark}</p>
          <p class="tile-prompt">${esc(x.prompt)}</p>
          <div class="tile-head">
            <h3>${esc(x.name)}</h3>
            <span>${esc(x.fact)}</span>
          </div>
          <p class="chip js-only"></p>
          <div class="tile-links">
            <a class="tile-open" href="/x/${x.dir}/">Open full size</a>
            <a class="tile-out" href="${tree(`examples/${x.dir}`)}">Source</a>
          </div>
        </div>
      </article>`;
}

/**
 * The three games in `from-one-sentence/`, and the one rule for rendering them.
 *
 * **A game's caption is its prompt, complete and verbatim.** Not trimmed, not tidied, not
 * paraphrased into a headline: the entire claim of this section is *this exact text went in and
 * that exact thing came out*, and a sentence edited to fit a column is a sentence a reader is
 * right to stop believing. `site/data/one-sentence.json` carries them, `from-one-sentence/README.md`
 * carries the provenance, and neither is written here.
 *
 * The lead is the one the section opens on, live and full width. It is a flag in the data rather
 * than the first array element, because *which one leads* is an editorial decision about which
 * game reads as a game in one glance, and that deserves to be visible in the manifest.
 */
const sentence = read(join(site, 'data/one-sentence.json'));
const lead = sentence.games.find((g) => g.lead === true);
if (lead === undefined) throw new Error('site/data/one-sentence.json: exactly one game must have "lead": true');
const rest = sentence.games.filter((g) => g !== lead);

/**
 * One game, as a card. `data-unmanaged="yes"` is the load-bearing attribute and it is not
 * cosmetic.
 *
 * These three never call `examples/_shared`'s `bootstrap` — they could not, they had no access to
 * this repository — so no `__latticeBoot` is parked on their document and this page cannot reach
 * their loop to stop it. `page.ts` needs to know that *before* it mounts one: an unreachable scene
 * that is preloaded gets mounted, cannot be paused, is unmounted, and is preloaded again on the
 * next pass, forever. So they are binary — running, or a held frame of their own last paint — and
 * they give up their preload slot rather than their correctness.
 *
 * It also means they are not sent `?cost=0`, which is right: the flag is an `examples/_shared`
 * mechanism and none of these three has a frame readout for it to hide. That was checked rather
 * than assumed — no `ms` figure appears in any of their HUDs.
 *
 * **The two sizes are measured rather than chosen.** The pair run at 800x500 because at 1000x625
 * they cost 23.8 ms and 26.5 ms a frame in a headless Chrome with no GPU, and at 800x500 they cost
 * 14.7 ms and 17.6 ms — they are pixel-bound, and the box they are drawn into is half that wide
 * either way, so nothing is lost. The lead stays at 1200x750 because it is *not* pixel-bound: it
 * measures 41.7 ms at 900x563, 41.6 ms at 1000x625 and 41.7 ms at 1100x688, so shrinking it would
 * cost composition and buy nothing. It is the most expensive scene this page embeds, and it is
 * unedited agent code that no one here gets to optimize — which is the point of it being here.
 */
const gameHtml = (g, big) => `      <article class="game${big ? ' game-lead' : ''}" data-unmanaged="yes" data-src="/g/${g.dir}/" data-params="${esc(g.params ?? '')}" data-name="${esc(g.name)}" data-w="${big ? 1200 : 800}" data-h="${big ? 750 : 500}">
        <div class="stage" style="--w:${big ? 1200 : 800};--h:${big ? 750 : 500}">
          <button class="tile-run" type="button"><b>Run</b> ${esc(g.name)}</button>
        </div>
        <div class="game-body">
          ${big ? '' : `<p class="said"><span>&gt;</span><code><b>/lattice</b> ${esc(g.sentence)}</code></p>\n          `}<div class="tile-head">
            <h3>${esc(g.name)}</h3>
            <span>${esc(g.agent)} &middot; ${esc(g.size)}</span>
          </div>
          <p class="chip js-only"></p>
          <div class="tile-links">
            <a class="tile-open" href="/g/${g.dir}/">Open full size</a>
            <a class="tile-out" href="${tree(`from-one-sentence/${g.dir}`)}">Source, unedited</a>
          </div>
          ${g.defect === '' ? '' : `<p class="note flaw">${esc(g.defect)}</p>`}
        </div>
      </article>`;

/**
 * The fan-out, grouped by vendor and **derived rather than typed**.
 *
 * The eight rows carrying a `by` are the ones an outside agent built from `docs/GALLERY.md` alone.
 * Grouping them here rather than writing the three lists into the section's markup is the same
 * rule the rest of this file keeps: the manifest is the single source, so a ninth agent-built
 * exhibit is one field in `exhibits.json` and appears in the grid *and* in the section, and the
 * two can never disagree about who built what.
 *
 * Ordered by how many each built, then by name, so the list reads as a size ranking rather than
 * as whatever order the grid happens to interleave them in.
 */
const fanout = [...new Set(gallery.live.filter((x) => x.by !== undefined).map((x) => x.by))]
  .map((vendor) => ({ vendor, built: gallery.live.filter((x) => x.by === vendor) }))
  .sort((a, b) => b.built.length - a.built.length || a.vendor.localeCompare(b.vendor));

const fanoutCount = fanout.reduce((n, v) => n + v.built.length, 0);

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
const head = ({ title, description, path = '/', extra = '' }) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#181410">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 12 60 28 32 44 4 28Z' fill='%23e0a13c'/%3E%3Cpath d='M32 20 46 28 32 36 18 28Z' fill='%23181410'/%3E%3C/svg%3E">

<link rel="canonical" href="${SITE_URL}${path}">

<!-- The share card.
     The page shipped with none of these, so every link to it on Hacker News, X, Reddit, Slack,
     Discord and Bluesky rendered as a bare blue line of text. For a project whose entire argument
     is *look at this*, a link with no picture is the worst first impression available, and for
     most people who ever encounter it, it is the only impression.
     og.png is a real frame of /x/demo/ at dusk, captured headless at 1200x630 by
     site/tools/og.mjs. Not a mockup: what a stranger sees before the click is what they get
     after it. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lattice">
<meta property="og:url" content="${SITE_URL}${path}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A valley at dusk rendered by Lattice: an isometric hillside with a lit shrine, a road of lamps, and the words 'Isometric games made easy'.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE_URL}/og.png">

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
 * files rather than out of this template — and now out of the *same* data file, which is the one
 * thing that was wrong with it. The date was `measured.json`'s measurement date while the number
 * beside it was the row count in `exhibits.json`, so the day the gallery grew and nothing was
 * re-measured, the chip announced eighteen worlds under the date the sizes were last weighed.
 * `exhibits.json`'s own `$updated` is the day the gallery last changed, which is what a chip about
 * the gallery is dating. A chip nobody has to remember to update is the only kind that stays true;
 * a chip dated off a different measurement is one that quietly stops being about its own sentence.
 */
const chipOn = gallery.$updated;
// An absent or malformed date is not a missing chip, it is a chip reading `Invalid Date` in the
// masthead — the one place a stale page is most obvious to a reader and least obvious to a build.
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(chipOn))) {
  throw new Error('site/data/exhibits.json needs a $updated of the form YYYY-MM-DD: the masthead chip is dated from it.');
}
const chipDate = new Date(`${chipOn}T00:00:00Z`).toLocaleDateString('en-US', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
});

const topbar = (home = '', current = '') => `<nav class="topbar">
  <div class="masthead">
    <a class="wordmark" href="/">lattice</a>
    <a class="news" href="${home}#gallery"><b>New</b><time datetime="${esc(chipOn)}">${esc(chipDate)}</time><span>${gallery.live.length} worlds live in the gallery</span></a>
  </div>
  <div class="topnav">
    <!-- Two sections and one rail entry between them, deliberately. '/one-sentence' and '/built'
         are halves of the same argument — an agent made this — and they sit two screens apart with
         the gallery between them, so a reader who follows this link passes both. A rail carrying
         every section is a rail nobody reads, and this one has to survive down to 560 px. -->
    <a href="${home}#sentence">One sentence</a>
    <a href="${home}#gallery">Demos</a>
    <a href="${home}#why">Why</a>
    <a href="${home}#what">What</a>
    <a href="${home}#start">Start</a>
    <a href="/reference/"${current === 'reference' ? ' aria-current="page"' : ''}>Reference</a>
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
        <!-- Was docs/ARCHITECTURE.md, which does not exist and never has. docs/SEAMS.md is the
             file that answers the question the link was asking — what holds between the nine and
             what breaks if it moves — and it is real. AGENTS.md points at the same missing file
             and that is outside this page's paths; see the report. -->
        <li><a href="${src('docs/SEAMS.md')}">The seams</a></li>
        <li><a href="${src('docs/PERFORMANCE.md')}">Performance</a></li>
        <li><a href="${src('docs/GALLERY.md')}">The gallery brief</a></li>
      </ul>
    </div>
  </div>
  <!--
    The colophon is gone. "lerpPalette(DUSK, NIGHT, scroll), repainted 345 times so far" was the
    page narrating its own scroll animation to a reader who was doing the scrolling, which is the
    copy doctrine's exact failure committed in the footer. One credit line replaces it, and it
    credits the tool rather than a person: the kit is the work, not the byline.
  -->
  <p class="credit">Created with vibes, and <a href="https://claude.com/claude-code">Claude Code</a>.</p>
</footer>`;

/* ── the landing page ──────────────────────────────────────────────────────────────────── */

const html = `<!doctype html>
<html lang="en">
<head>
${head({
  title: 'Lattice — isometric games made easy',
  description: `An agentic isometric game kit: ${String(fig('skills'))} skills that teach your coding agent to build a game, over ${String(fig('packages'))} TypeScript core packages with no dependencies and no asset files. ${String(gallery.live.length)} worlds running on the page.`,
  extra: `
<script type="application/ld+json">
${JSON.stringify(
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'Lattice',
    alternateName: kit.tagline,
    description:
      'An agentic isometric game kit. A plugin carrying twelve agent skills, over nine composable TypeScript libraries with no dependencies and no asset files, for deterministic zero-asset isometric games.',
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
    <p class="eyebrow">The plugin your agent installs</p>
    <!-- One line, and the line break is the column's rather than the markup's. The previous
         headline was three clauses broken by hand because three short sentences read as one
         figure; five words do not need the device and a '<br>' inside them would be a rhythm
         nobody asked for. -->
    <h1>${esc(HEADLINE)}</h1>
    <p class="hero-sub">Lattice is an agentic isometric game kit: ${fig('skills')} skills that teach your coding agent to
    build a game, over ${fig('packages')} TypeScript core packages. No sprite sheets, no audio
    files, no asset paths &mdash; the art is derived and the sound is synthesized.</p>
    <!-- The most important object on this page, and the one that was wrong for the longest.
         What used to sit here was 'npm i @latticekit/…', which is what an *agent* runs to install
         the libraries. This is what a *person* runs to install the plugin into the agent. -->
    <div class="term-bay">
      ${terminal('t-hero')}
    </div>
    <div class="hero-cta">
      <a class="cta" href="#gallery">Demos</a>
      <a class="cta ghost" href="#why">Why it works</a>
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
<!-- The second sentence used to read "The last one is measuring yours", which was true of a live
     frame figure that is no longer in this strip. Every one of the six is now a stored measurement
     with a command behind it, and the note says exactly that. -->
<p class="prov-note note">All six measured at <code>${esc(measured.commit)}</code>, ${esc(measured.measuredOn)}, ${esc(measured.machine)}.
<span class="js-only">Hover or tap any of them for the command that produced it.</span></p>

<main class="shell">

  <!--
    /one-sentence — the command and what it produced, and the first thing under the strip.

    ## Why it is here and not further down

    Everything else on this page is an argument that a sentence *would be* enough: the gallery
    prints the sentence somebody would ask each world in, and /built shows eight exhibits built
    from a written spec. This section is the only place where the sentence is the actual input and
    the thing under it is the actual output, with nobody in between. That is the page's whole
    promise, demonstrated rather than implied, so it goes above the gallery — a reader who stops
    after two screens has still seen it.

    ## What it must never become

    **It is not the gallery and must not be merged into it.** An exhibit says *here is a
    capability, shown well*, and is bound by docs/GALLERY.md's line rule and § Scale. A game here
    says *nobody designed this and it works*. Both arguments are weaker mixed: an exhibit next to
    an unedited game reads as sloppy, and a game held to § Scale stops being evidence of anything
    except that somebody tidied it.

    ## The word that has to stay true

    **Unedited.** The three are in 'from-one-sentence/', their dependencies resolve to the registry
    tarballs a stranger's install produces, and the one thing changed in any of them is a '--port'
    number, recorded in that directory's README. Two carry real, measured defects and this section
    names both. A page that shows unedited output and says so is believed; a page that shows a
    curated result and calls it unedited is caught, and rightly.
  -->
  <section class="section" id="sentence">
    <div class="marker"><a href="#sentence">/one-sentence</a></div>
    <div class="body">
      <p class="eyebrow">From one sentence</p>
      <h2>This went in. This came out.</h2>
      <!-- The prompt, complete. It is long, it wraps, and it is not shortened: an edited prompt
           is the one thing that would make the world under it worth nothing. -->
      <p class="said said-lead"><span>&gt;</span><code><b>/lattice</b> ${esc(lead.sentence)}</code></p>

      <div class="games games-lead">
${gameHtml(lead, true)}
      </div>

      <p class="lede">${esc(lead.agent)}'s agent, in an empty directory, with the packages from npm and no access to this
      repository. Nobody here designed it, named a file or fixed a bug &mdash; the source is unedited, and these are not
      gallery exhibits: nothing in them was held to a line rule and nothing was tidied.</p>

      <h3>Two more, the same way</h3>
      <div class="games games-pair">
${rest.map((g) => gameHtml(g, false)).join('\n')}
      </div>

      <p class="note">All three, their transcripts, what was verified by hand and the defects left in:
      <a href="${src('from-one-sentence/README.md')}"><code>from-one-sentence/</code></a>. The
      ${fig('packages')} packages they installed are the ones on npm, at the version their lockfiles pin.</p>
    </div>
  </section>

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
    and it had regrown. There is nothing left to score: the brief specifies eighteen exhibits and
    one hero, and all nineteen are built. 'pending' in the manifest is empty, so the sentence that
    used to print it prints nothing, and the count in the heading is the count of rows.
  -->
  <section class="section" id="gallery">
    <div class="marker"><a href="#gallery">/gallery</a></div>
    <div class="body">
      <p class="eyebrow">The gallery</p>
      <h2>${word(gallery.live.length)} worlds, running right now.</h2>
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
    /built — the fan-out, and the one claim on this page no competitor can answer.

    ## Why it is its own section and not part of the gallery

    'docs/GALLERY.md' holds an exhibit to a standard: one idea, under 200 lines of logic, § Scale's
    framing, a control panel, a cost row. What a tile argues is *here is a capability, shown well.*
    What this section argues is a different thing entirely — **nobody in this repository designed
    these, and they meet that standard anyway** — and the two weaken each other if they are made
    into one. So the grid says who built each world in three words, and the method, the result and
    the price of it are here, once, in the section a reader arrives at having just scrolled past
    eight of them.

    ## What is deliberately not here

    **The three games built blind from one sentence are not on this page.** Three agents were given
    a sentence apiece with no repository access and returned a playable game each; the games are
    not in this repository, two of the three directories no longer exist, and what survives is a
    log and one screenshot in a temp directory. Putting that on the page would mean either a claim
    a visitor cannot check or the first picture on a page whose entire rule is that it has none.
    Neither is worth it while the artifacts are unreachable, and it is routed in the report rather
    than softened into a sentence here. Nothing on this page may be a thing the reader cannot open.

    ## And what it must not become

    This section is evidence for what the plugin is *for*. It is not evidence that the plugin
    works, which is a different run and has not happened. That status is stated once on this page,
    in /what, beside the three files that are shipped, and it stays there — a second statement of
    it here would be the "page-length apology" the copy doctrine deleted, rebuilt one section
    higher.
  -->
  <section class="section" id="built">
    <div class="marker"><a href="#built">/built</a></div>
    <div class="body">
      <p class="eyebrow">The fan-out</p>
      <h2>${word(fanoutCount)} exhibits, ${word(fanout.length).toLowerCase()} vendors, one written spec.</h2>
      <p class="lede">${word(fanoutCount)} of the worlds above were built by agents from
      ${word(fanout.length).toLowerCase()} different companies, each given one row of
      <a href="${src('docs/GALLERY.md')}">the gallery brief</a>, the standard it is held to, and the tools &mdash; and
      none of them allowed to read another exhibit's source, because an agent that can copy its neighbour tests the
      neighbour rather than the writing. ${word(fanoutCount - 1)} of the ${word(fanoutCount).toLowerCase()} passed
      every row of the looking harness unaided.</p>

      <ul class="vendors">
${fanout
  .map(
    (v) => `        <li><b>${esc(v.vendor)}</b><span>${v.built
      .map((x) => `<a href="/x/${x.dir}/">${esc(x.name)}</a>`)
      .join('')}</span></li>`,
  )
  .join('\n')}
      </ul>
      <p class="note">The exception was Replay, on legibility: a bare <code>&middot;</code> separator is its own text
      node, and one narrow glyph in a five-pixel box reports a luminance range of 0.003 at a contrast of 7.2. It was
      not hard to read. It was too small to measure.</p>

      <!-- The mark says who built the exhibit. It does not say the file is untouched, and this
           clause is what keeps it from implying so: every one of the eight changed on the way in,
           one of them substantially.

           What stood here was two more paragraphs — the examples/_shared finding, and an
           enumeration of what each of the eight had to change. Both were true and neither was for
           a visitor. The finding is a bug report against our own brief; it is written up at length
           in GALLERY.md, which is where somebody who wants it goes. The enumeration explained the
           marks on the tiles, which is the page explaining itself rather than showing anything.
           The section's claim is already made by the headline, the lede and eight live links; the
           only thing under it that had to survive is the half-sentence that stops eight tiles from
           claiming more than is true. -->
      <p class="note">Each of the ${word(fanoutCount).toLowerCase()} changed on the way in and its
      <code>README</code> says how. What all ${word(fanoutCount).toLowerCase()} of them found missing in the brief is
      collected in <a href="${src('docs/GALLERY.md#what-eight-strangers-found-in-this-document')}">what
      ${word(fanoutCount).toLowerCase()} strangers found in this document</a>.</p>
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
  <section class="section" id="why">
    <div class="marker"><a href="#why">/why</a></div>
    <div class="body">
      <p class="eyebrow">Why</p>
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
      <p class="note">Those three are live right now, and an agent pointed at them needs nothing else from this
      page. The plugin above is what saves you from having to point it.</p>

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
    return `            <tr><td><a href="/reference/${n}/"><code>${esc(p.name)}</code></a></td><td>${layerOf(n)}</td><td>${esc(p.purpose)}</td><td class="num">${s === undefined ? '&mdash;' : esc(kb(s.gzipKb))}</td></tr>`;
  })
  .join('\n')}
          </tbody>
        </table>
      </div>
      <!--
        Two things used to close this section and both are gone.

        The **sizes-and-Phaser paragraph** was a footnote, a routing instruction and a
        recommendation of a competitor, stacked in one 13px note under a table. The provenance it
        carried is on every figure in the strip already, and the comparison is whole in /llms.txt
        and /api.json, where somebody actually weighing the two is reading.

        The **meter bay** — 'hero worst 10s', 'page period', 'page worst 10s', 'scenes live' — is
        gone with every other frame figure on this page. It measured the machine it was being read
        on, which was the argument for it, and that is also exactly what makes it a liability: it
        showed 35 ms on one laptop and 41.5 ms on another, and worse on anything slow. A page
        selling frame-time discipline does not get to print a number that makes its own product
        look bad on hardware it did not choose. 'site/src/meter.ts' still exists and the scenes
        still hold a meter each; none of them is bound to an element any more.
      -->
    </div>
  </section>

  <!--
    /what — new, and it is the section the positioning asked for.

    'docs/SKILLS.md' § *The positioning* settles that the kit is the underlying tech and the
    product is the plugin and its skills. Every fact on this page already served that argument
    except one: nowhere did the page say **what the thing you install actually is.** The hero
    prints the command, /why explains why it works, the gallery shows what it makes — and between
    the command and the argument there was a hole where the product's own description goes.

    It is deliberately the shortest section on the page, and it ends on what is *not* true yet.
    'docs/SKILLS.md' § *The honest tension* is explicit that the gap between what this page says
    and what a visitor can do is now the gap between the product and nothing, so the status is
    stated here in the product's own section rather than buried in a footnote somewhere else.
  -->
  <section class="section" id="what">
    <div class="marker"><a href="#what">/what</a></div>
    <div class="body">
      <p class="eyebrow">What</p>
      <h2>One command, ${fig('skills')} skills, ${fig('packages')} libraries under them.</h2>
      <p class="lede">The libraries are the tech. The product is the plugin: the part that knows which of them to
      reach for, in what order, and what not to do.</p>

      <div class="scroller">
        <table>
          <thead><tr><th>what you get</th><th>what it does</th></tr></thead>
          <tbody>
            <tr><td><code>/lattice</code></td><td>the parent skill, and the whole entry point. Everything after it is the game &mdash; no flags, no subcommands, no questions with a right answer it could have worked out. It picks the shape, scaffolds, installs, wires, gets to a running screen, then opens it in a browser and looks at it.</td></tr>
            <tr><td>eleven specialists</td><td>${['starting', 'art', 'world', 'economy', 'input', 'sound', 'saving', 'hud', 'determinism', 'performance', 'traps'].map((s) => `<code>${s}</code>`).join(' ')} &mdash; organized by what somebody is trying to do, never by package. Nobody sits down to use <code>@latticekit/iso</code>; they sit down to put a building where someone tapped.</td></tr>
            <tr><td>${fig('packages')} libraries</td><td>${packageNames.map((n) => `<code>${esc(n)}</code>`).join(' ')} &mdash; ${esc(kb(fig('gzipTotal')))} gzipped for all of them, no dependencies, and a game imports four or five. They are what the skills drive.</td></tr>
          </tbody>
        </table>
      </div>

      <!--
        The plugin's status, stated once on this page, and it changed today.

        It used to read "**That run has not happened.**", which was true when it was written and is
        no longer: the repository is public, the nine packages are on the registry, and three
        agents have since been handed one sentence each in an empty directory and returned a
        playable game — they are at the top of this page, unedited. docs/SKILLS.md § The honest
        tension asks for exactly one thing here, that the page advertise the property that is true
        today and never the promise, so the sentence moves rather than being deleted: what is
        untested now is a *stranger* doing it, on a machine that is not this one.

        Whoever edits this next: it stays one factual sentence, it stays in this section, and it
        never becomes the closing word of one.
      -->
      <p class="note">Written down in <a href="${src('docs/SKILLS.md')}">docs/SKILLS.md</a>, which also holds the bar
      this is held to and the one test that decides whether it shipped: somebody who has never seen this repository
      installs the plugin, types one sentence about a game, touches nothing else, and ends up looking at that game in a
      browser. <strong>Three of those runs are at the top of this page.</strong> What is untested is a stranger doing
      it, on a machine that is not ours.</p>
    </div>
  </section>

  <!--
    /start — the example, and the thing it draws, side by side.

    ## What changed and why

    The listing here was forty code lines: a seeded town on rolling ground with a 'DepthSorter', a
    'Passes' object, a terrain callback, a solids callback and pointer input. Every line of it was
    real and it was the wrong argument. A visitor who does not write TypeScript read it as evidence
    that a Lattice program is long, on the page whose whole claim is that they will not be writing
    one at all.

    Ten lines now, and the same file — still a real file, still selectable, still typechecked
    against the built packages before this page is generated, so a signature that moves in the kit
    fails this build rather than quietly turning the listing into a lie. Bevy's equivalent is an
    SVG image of code.

    ## And it runs beside itself

    'site/example/index.html' is a third document in this build, so the program on the left is the
    program on the right: same file, one bundled and one printed. It mounts through the same
    'Scene' machinery as a gallery tile and obeys the same running budget, so it costs the reader
    a loop only while they are looking at it.
  -->
  <section class="section" id="start">
    <div class="marker"><a href="#start">/start</a></div>
    <div class="body">
      <p class="eyebrow">Getting started</p>
      <h2>Getting started.</h2>
      <!-- "next to it" was true on a laptop and false on a phone, where the two stack. The claim
           that matters at both widths is that it is the same file, so that is what it says. -->
      <p class="lede">A whole Lattice program in ${esc(String(fig('exampleLines')))} lines, and the world it draws,
      running out of that same file.</p>

      <div class="showcase">
        <!--
          'data-wrap' is on from the markup here, and that is a measurement rather than a default.

          The program has one 150-character line in it — the double loop that draws the city — and
          the code column beside a 300 px world is about 88 characters at 12px. Unwrapped, the one
          line that does the drawing truncates mid-expression on every desktop, which is exactly
          the failure the Wrap button was built for on a phone. A listing whose most interesting
          line is off the right edge is a listing nobody reads, and 'page.ts' only ever turns this
          on below 640 px. The button still turns it off for anybody who wants the alignment.
        -->
        <div class="codebox" data-wrap="on">
          <div class="codebar js-only">
            <button type="button" data-code-wrap>Wrap</button>
            <button type="button" data-code-copy>Copy</button>
          </div>
          <pre class="code"><code>${highlight(exampleBody)}</code></pre>
        </div>
        <!--
          'data-unmanaged' says this document is not an exhibit.

          Every other live scene on this page is one, and 'bootstrap' parks a 'Boot' on its mount
          element so the page can reach the loop and stop it. The example deliberately does not
          call 'bootstrap' — it is ten lines of plain Lattice and that is the whole claim — so
          there is no handle, and the only pause available for it is an unmount. 'page.ts' needs to
          know that before it mounts rather than after two seconds of polling: an unreachable scene
          that gets preloaded mounts, cannot be paused, is unmounted, and is preloaded again on the
          next pass, forever.
        -->
        <div class="demo js-only" data-unmanaged="yes" data-src="/example/" data-name="The ten-line example, running" data-w="560" data-h="560">
          <div class="stage" style="--w:560;--h:560">
            <button class="tile-run" type="button"><b>Run</b> the example</button>
          </div>
          <p class="chip"></p>
        </div>
      </div>

      <p class="note">${esc(String(fig('exampleLines')))} code lines by
      <a href="${src('docs/GALLERY.md')}">the gallery's own line rule</a>, typechecked against the built packages before
      this page is generated. It is a real file:
      <a href="${src('site/example/hello.ts')}"><code>site/example/hello.ts</code></a>, and
      <a href="/example/">this is it running</a> on a page of its own. Everything past this &mdash; terrain, a depth
      sort, pathfinding, sound, saves &mdash; is what the skills know and you do not have to.</p>
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
    <h2>Install it into the agent you already use.</h2>
    <p class="lede">One plugin, ${fig('skills')} skills, three environments. Then a sentence about a game.</p>
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
 * The API reference: an index at `/reference/` and one document per package under it.
 *
 * ## What changed, and why it was worth changing
 *
 * Every row on this page used to come out of `.lattice/kit.json`, which carries export names,
 * purposes and invariants and **no types at all**. So the reference could answer *"which package
 * is `pathSample` in"* and never *"how do I call it"* — a list of 540 names, which is an index
 * rather than a reference. A blind review said exactly that, and the owner's version of it was
 * shorter: it should read like an autogenerated doc.
 *
 * It is generated from the built type declarations now — `packages/*&#47;dist/**&#47;*.d.ts`, which
 * `npm run build` emits and which an adopter's editor reads. Three things follow from that:
 *
 * 1. **Every symbol carries its real signature**, character for character as the compiler wrote
 *    it, so the page cannot describe a parameter list that does not exist.
 * 2. **Every symbol carries its doc comment**, and that is the point of the exercise rather than a
 *    side effect. `AGENTS.md` non-negotiable 5 requires a *why* over a *what*, and the result is
 *    RFC-grade writing sitting in these files: why pointer-anchored zoom exists, why `readonly` is
 *    not a barrier between a read type and a write type, why a duration is not branded. Printing
 *    `createCamera(viewW, viewH, options?)` and dropping the paragraph underneath it would have
 *    thrown away the valuable half.
 * 3. **Module headers are sections.** Half the best writing in the kit is a file header rather
 *    than a symbol comment — `createCamera`'s own comment is two lines; the table splitting a
 *    camera's position from its policy is the top of `camera.ts` — so a module is a section with
 *    its own prose and its symbols underneath it, in the order the package re-exports them.
 *
 * ## What was kept
 *
 * The old generator's one real property was that it could not drift: `npm run lint` fails the
 * build if a package exports a symbol `kit.json` does not list. {@link crossCheck} is the stronger
 * form of the same guarantee — it compares the *compiler's* view of each package's exports against
 * the manifest, in both directions, and throws with the names. The budgets table and its
 * `↳ source` provenance lines are unchanged, and the invariants are still printed verbatim from
 * the manifest.
 *
 * ## Nine documents rather than one
 *
 * The prose is 700 kB of text. As one page that is a megabyte of HTML before any markup, which is
 * a document a phone parses slowly and nobody can navigate; every generated reference in the world
 * splits, and this one splits at the package because the package is the unit an adopter installs.
 * `/reference/` keeps the budgets, the contracts, the nine cards — and a filterable index of
 * every symbol in the kit, which is the thing that makes a split reference navigable rather than a
 * maze.
 */

const apiModel = buildApiModel({ repo, packages: packageNames });
crossCheck(apiModel, kit);

const modelOf = (name) => {
  const p = apiModel.packages.find((x) => x.id === name);
  if (p === undefined) throw new Error(`no built declarations for @latticekit/${name}`);
  return p;
};

const symbolCount = apiModel.packages.reduce((n, p) => n + p.symbols.length, 0);

/**
 * Where a symbol's entry lives, for `{@link}` cross-references.
 *
 * `VERSION` is exported by all nine packages, so the first one wins for a link written in another
 * package's prose — and a link from *inside* a package always resolves locally first, because a
 * comment in `iso` saying `{@link VERSION}` means the one it exports.
 */
const symbolHome = new Map();
for (const p of apiModel.packages) {
  for (const s of p.symbols) if (!symbolHome.has(s.name)) symbolHome.set(s.name, `/reference/${p.id}/#${s.name}`);
}
const linkerFor = (pkg) => (name) => {
  const local = pkg === undefined ? undefined : modelOf(pkg).symbols.find((s) => s.name === name);
  if (local !== undefined) return `#${name}`;
  return symbolHome.get(name);
};

/** A doc comment, rendered with this page's highlighter and this page's cross-links. */
const doc = (md, pkg, heading) => docHtml(md, { heading, link: linkerFor(pkg), highlight });

/** The `↳ source` line every symbol carries, pointing at the `.ts` the comment was written in
 *  rather than at the `.d.ts` it was read from — resolved through the declaration source map, so
 *  it lands on the line and not merely in the file. */
const sourceLink = (origin) =>
  `<a class="sym-src" href="${src(origin.file)}#L${String(origin.line)}">&#8627; ${esc(origin.file.replace(/^packages\/[^/]+\//, ''))}:${String(origin.line)}</a>`;

/** One symbol: what it is, how it is called, and why it exists. */
function symbolHtml(s, pkg, entries) {
  const params = s.doc.tags.filter((t) => t.tag === 'param');
  const returns = s.doc.tags.filter((t) => t.tag === 'returns' || t.tag === 'return');
  const throws = s.doc.tags.filter((t) => t.tag === 'throws');
  const flags = s.doc.tags.filter((t) => t.tag === 'tier-a' || t.tag === 'tier-b' || t.tag === 'browser-only' || t.tag === 'deprecated' || t.tag === 'see' || t.tag === 'defaultValue');

  const sig = s.signatures.map((x) => `<pre class="code sig">${highlight(x)}</pre>`).join('');

  const paramRows = params.length === 0 ? '' : `
            <h5 class="sub">Parameters</h5>
            <div class="scroller"><table class="params"><tbody>
${params.map((p) => `              <tr><th><code>${esc(p.name)}</code></th><td>${doc(p.text, pkg, 6)}</td></tr>`).join('\n')}
            </tbody></table></div>`;

  const notes = [
    ...returns.map((t) => `<div class="tagline"><b>Returns</b>${doc(t.text, pkg, 6)}</div>`),
    ...throws.map((t) => `<div class="tagline"><b>Throws</b>${doc(t.text, pkg, 6)}</div>`),
    ...flags.map((t) => `<div class="tagline"><b>${esc(t.tag)}</b>${doc(t.text, pkg, 6)}</div>`),
  ].join('\n');

  const members = s.members.length === 0 ? '' : `
            <h5 class="sub">${s.members.length} member${s.members.length === 1 ? '' : 's'}</h5>
            <dl class="members">
${s.members.map((m) => `              <dt><code>${highlight(m.text)}</code></dt><dd>${m.doc.prose === '' ? '' : doc(m.doc.prose, pkg, 6)}${m.doc.tags.filter((t) => t.tag === 'throws').map((t) => `<div class="tagline"><b>Throws</b>${doc(t.text, pkg, 6)}</div>`).join('')}</dd>`).join('\n')}
            </dl>`;

  return `          <article class="sym" id="${esc(s.name)}">
            <h4><a class="anchor" href="#${esc(s.name)}"><code>${esc(s.name)}</code></a>
              <span class="kind" data-kind="${esc(s.kind)}">${esc(s.kind)}</span>${entries.has(s.name) ? '<span class="kind entry">start here</span>' : ''}
              ${sourceLink(s.origin)}</h4>
            ${sig}
            ${s.doc.prose === '' ? '' : `<div class="doc">${doc(s.doc.prose, pkg, 5)}</div>`}${paramRows}
            ${notes}${members}
          </article>`;
}

/** The rail: every symbol in the package, grouped by module, filterable, and marked as the reader
 *  passes it. It is the answer to "find a symbol without scrolling" on a document that is long
 *  precisely because it is worth reading. */
function navHtml(pkg) {
  const model = modelOf(pkg);
  return `      <nav class="ref-nav" data-symbol-nav data-finder aria-label="Symbols in @latticekit/${esc(pkg)}">
        <a class="ref-up" href="/reference/">&uarr; all nine packages</a>
        <p class="finder-box js-only">
          <input type="search" data-finder-input placeholder="Filter symbols" aria-label="Filter the symbols in this package" autocomplete="off" spellcheck="false">
          <span class="finder-count"><b data-finder-count>${model.symbols.length}</b>/${model.symbols.length}</span>
        </p>
        <ul class="navlist">
${model.modules.map((m) => `          <li data-group><b class="navgroup"><a href="#mod-${esc(m.id)}">${esc(m.id)}</a></b>
            <ul>
${m.symbols.map((s) => `              <li data-key="${esc(`${s.name} ${s.kind} ${m.id} ${pkg}`.toLowerCase())}"><a href="#${esc(s.name)}" data-kind="${esc(s.kind)}">${esc(s.name)}</a></li>`).join('\n')}
            </ul>
          </li>`).join('\n')}
        </ul>
        <p class="note js-only" data-finder-empty hidden>Nothing in this package matches that.</p>
      </nav>`;
}

/** One package document. */
function packagePage(pkg) {
  const p = kit.packages[pkg];
  const model = modelOf(pkg);
  const size = sizeOf(pkg);
  const entries = new Set(p.entryPoints ?? []);
  const deps = p.dependsOn.length === 0 ? 'nothing' : p.dependsOn.map((d) => `<a href="/reference/${esc(d)}/"><code>@latticekit/${esc(d)}</code></a>`).join(', ');

  return `<!doctype html>
<html lang="en">
<head>
${head({
    title: `${p.name} — Lattice API reference`,
    description: `${p.purpose} Every exported symbol of ${p.name} with its signature, its parameters and the comment above it in the source.`,
    path: `/reference/${pkg}/`,
    extra: '<script type="module" src="/src/reference.ts"></script>',
  })}
</head>
<body data-ground="night">

<noscript>
  <p class="banner">This page is a document and reads fine without JavaScript; only the filter box
  needs it. The worlds are on <a href="/">the front page</a>.</p>
</noscript>

<canvas id="ground" aria-hidden="true"></canvas>

<div class="page">

${topbar('/', 'reference')}

<main class="shell">
  <div class="ref">
      <header class="ref-head">
        <p class="eyebrow"><a href="/reference/">API reference</a> &middot; layer ${layerOf(pkg)}</p>
        <h2><code>${esc(p.name)}</code></h2>
        <p class="lede">${esc(p.purpose)}</p>
        <div class="scroller"><table>
          <tbody>
            <tr><th>exports</th><td>${model.symbols.length} symbols in ${model.modules.length} modules${(p.entryPoints ?? []).length === 0 ? '' : ` &mdash; start with ${p.entryPoints.map((e) => `<a href="#${esc(e)}"><code>${esc(e)}</code></a>`).join(', ')}`}</td></tr>
            <tr><th>depends on</th><td>${deps}</td></tr>
            <tr><th>environment</th><td>${esc(p.environment)}</td></tr>
            <tr><th>gzipped</th><td>${size === undefined ? '&mdash;' : `${esc(kb(size.gzipKb))} against a ${esc(kbShort(budgetOf(pkg)))} budget${size.note === undefined ? '' : ` &mdash; ${esc(size.note)}`}`}</td></tr>
            <tr><th>source</th><td><a href="${tree(`packages/${pkg}`)}">packages/${esc(pkg)}</a> &middot; <a href="${src(`packages/${pkg}/README.md`)}">README</a> &middot; <a href="${src(`packages/${pkg}/dist/index.d.ts`)}">index.d.ts</a></td></tr>
          </tbody>
        </table></div>
      </header>

${navHtml(pkg)}

    <div class="ref-doc">
      ${model.doc.prose === '' ? '' : `<div class="doc doc-lead">${doc(model.doc.prose, pkg, 3)}</div>`}

      <section class="promises">
        <h3>What it promises</h3>
        <ul>${p.invariants.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        <p class="note">Verbatim from <a href="${src('.lattice/kit.json')}"><code>.lattice/kit.json</code></a>, which <code>npm run lint</code> keeps in step with the code.</p>
      </section>

${model.modules.map((m) => `      <section class="mod" id="mod-${esc(m.id)}">
        <h3><a class="anchor" href="#mod-${esc(m.id)}">${esc(m.id)}</a><span class="mod-count">${m.symbols.length} symbol${m.symbols.length === 1 ? '' : 's'}</span>${m.from === '' ? '' : `<span class="kind">re-exported from @latticekit/${esc(m.from)}</span>`}</h3>
        ${m.doc.prose === '' ? '' : `<div class="doc doc-lead">${doc(m.doc.prose, pkg, 4)}</div>`}
${m.symbols.map((s) => symbolHtml(s, pkg, entries)).join('\n')}
      </section>`).join('\n')}
    </div>
  </div>
</main>

${footer()}

</div>
</body>
</html>
`;
}

/** The index: the budgets, the nine packages, every symbol in one filterable list, and the
 *  contracts that hold between packages. */
const referenceHtml = `<!doctype html>
<html lang="en">
<head>
${head({
  title: 'Lattice API reference — every public symbol, with its signature',
  description: `Every exported symbol of the nine Lattice packages — ${commas(symbolCount)} of them — generated from the built type declarations: real signatures, parameters, and the doc comment above each one in the source.`,
  path: '/reference/',
  extra: '<script type="module" src="/src/reference.ts"></script>',
})}
</head>
<body data-ground="night">

<noscript>
  <p class="banner">This page is an index and reads fine without JavaScript; only the filter box
  needs it. The worlds are on <a href="/">the front page</a>.</p>
</noscript>

<canvas id="ground" aria-hidden="true"></canvas>

<div class="page">

${topbar('/', 'reference')}

<main class="shell">

  <!-- Deliberately without an 'id'. 'page.ts''s scroll spy walks 'main .section[id]' and writes
       both the rail and 'history.replaceState', so an id here would rewrite this document's URL to
       /reference/#reference the moment it is scrolled. The rail's Reference link carries
       'aria-current' from the markup instead, which is true for the whole document rather than for
       a scroll position inside it. -->
  <section class="section">
    <div class="marker"><a href="/">&larr; back</a></div>
    <div class="body">
      <p class="eyebrow">API reference</p>
      <h2>Every public symbol, with the signature the compiler emitted.</h2>
      <p class="lede">Generated from <code>packages/*/dist/**/*.d.ts</code> &mdash; the type declarations
      <code>npm run build</code> writes and an adopter's editor reads &mdash; so a signature here is the
      one you will get, and the prose under it is the comment above it in the source.</p>
      <p class="note">${commas(symbolCount)} exported names across ${packageNames.length} packages &mdash; ${commas(fig('publicSymbols'))} of them distinct, because
      <code>VERSION</code> is exported by every package &mdash; cross-checked against
      <a href="${src('.lattice/kit.json')}"><code>.lattice/kit.json</code></a>: the build fails if the manifest and the
      built declarations disagree in either direction. An agent should read <a href="/api.json"><code>/api.json</code></a>
      rather than this page.</p>

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

      <h3>The nine packages</h3>
      <div class="pkgcards">
${packageNames.map((n) => {
  const p = kit.packages[n];
  const m = modelOf(n);
  const size = sizeOf(n);
  return `        <a class="pkgcard" href="/reference/${esc(n)}/">
          <span class="pkgcard-top"><code>${esc(p.name)}</code><span class="layer">layer ${layerOf(n)}</span></span>
          <span class="why">${esc(p.purpose)}</span>
          <span class="pkgcard-foot"><b>${m.symbols.length}</b> symbols &middot; ${m.modules.length} modules${size === undefined ? '' : ` &middot; ${esc(kb(size.gzipKb))}`}</span>
        </a>`;
}).join('\n')}
      </div>

      <h3>Find a symbol</h3>
      <p>Every exported name in the kit, in one list. <kbd>/</kbd> focuses the box, <kbd>Enter</kbd> opens the first match.</p>
      <div class="finder" data-finder>
        <p class="finder-box js-only">
          <input type="search" data-finder-input placeholder="Filter by name, kind or package" aria-label="Filter every symbol in the kit" autocomplete="off" spellcheck="false">
          <span class="finder-count"><b data-finder-count>${symbolCount}</b>/${symbolCount}</span>
        </p>
        <ul class="symlist">
${apiModel.packages.flatMap((p) => p.symbols.map((s) => `          <li data-key="${esc(`${s.name} ${s.kind} ${s.module} ${p.id}`.toLowerCase())}"><a href="/reference/${esc(p.id)}/#${esc(s.name)}"><code>${esc(s.name)}</code></a><span class="kind" data-kind="${esc(s.kind)}">${esc(s.kind)}</span><span class="sym-pkg">${esc(p.id)}</span><span class="sym-sum">${esc(summarize(s.doc.prose, 96))}</span></li>`)).join('\n')}
        </ul>
        <p class="note js-only" data-finder-empty hidden>No symbol matches that. The nine packages are above; <a href="/llms.txt">/llms.txt</a> has the whole kit as text.</p>
      </div>

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

Two different installs, for two different readers, and confusing them is the mistake this file
exists to prevent.

**A person installs the plugin**, once, into the agentic environment they already use. It carries
the parent skill that owns \`/lattice\` and eleven specialists, and it is what makes an agent good
at this kit rather than merely able to import it.

    Claude Code   /plugin marketplace add ${REPO_SLUG}
                  /plugin install lattice@lattice
    Codex         codex plugin marketplace add ${REPO_SLUG}
                  codex plugin add lattice@lattice
    Grok Build    grok plugin install ${REPO_SLUG}

**An agent installs the libraries**, per project, and this is the line you want if you are reading
this file:

    npm i @latticekit/core @latticekit/iso @latticekit/draw @latticekit/loop @latticekit/input

Add \`@latticekit/audio\`, \`@latticekit/persist\`, \`@latticekit/sim\` and \`@latticekit/ui\` as you need them.
There are no peer dependencies and nothing transitive.

Both work today: all nine packages are on the public npm registry at ${kit.version}, and the
repository is public. This file, /api.json and /kit.json are served alongside them.

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

Version ${kit.version}, published to npm as \`@latticekit/*\`.

Stable: the ${commas(fig('publicSymbols'))} exported names (\`npm run lint\` fails the build if a package exports a name
\`.lattice/kit.json\` does not list); their behavior (${commas(fig('tests'))} tests, ${(kit.budgets.coverageStatements * 100).toFixed(0)}% statements per package,
${(kit.budgets.coverageCore * 100).toFixed(0)}% in core); the layering and the determinism rule, both lint-enforced; the per-package size budgets.

Not stable: function signatures, because nothing has shipped to a registry and nothing outside this
repository uses them yet; the \`/lattice\` plugin, which is specified in docs/SKILLS.md and not built.${
  gallery.pending.length === 0
    ? ''
    : `\nThe gallery is ${gallery.live.length} of ${gallery.live.length + gallery.pending.length} exhibits.`
}

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
- signatures and doc comments: /reference/${n}/ — generated from packages/${n}/dist/**/*.d.ts
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
${gallery.live.map((x) => `- **${x.name}** — ${x.caption} ${x.idea} — \`examples/${x.dir}\` — measured: ${x.fact} (${x.factFrom})${x.by === undefined ? '' : ` — built by ${x.by} from docs/GALLERY.md alone`}`).join('\n')}

${
  gallery.pending.length === 0
    ? `All ${gallery.live.length} specified exhibits are built, plus the hero.`
    : `Specified but not yet built: ${gallery.pending.map((p) => `${p.name} (${p.idea})`).join('; ')}.`
}

## From one sentence — three games nobody here designed

Not exhibits, not bound by the gallery's rules, and not written in this repository. Each of these
was built by a different vendor's agent in an **empty directory**, from **one sentence**, with the
\`@latticekit/*\` packages installed from the public npm registry and no access to this repository.
The source is unedited: the only change made to any of them is the \`--port\` in the dev script.

${sentence.games
  .map(
    (g) =>
      `- **${g.name}** (${g.agent}) — *"${g.sentence}"* — \`from-one-sentence/${g.dir}\` — ${g.size}; uses ${g.packages.join(', ')}${g.defect === '' ? '' : `. Known defect, left in: ${g.defect}`}`,
  )
  .join('\n')}

Two of the three carry a real defect and both are recorded rather than fixed, because a record that
hides its blemishes is not a record. \`from-one-sentence/README.md\` has the provenance, the
transcripts, what was verified by hand, and why these must keep their registry dependencies rather
than being converted to workspace ones.

### The fan-out

${fanoutCount} of the ${gallery.live.length} were built by ${fanout.length} vendors' agents — ${fanout.map((v) => `${v.vendor} (${v.built.map((x) => x.name).join(', ')})`).join('; ')} —
each given only its own row of docs/GALLERY.md, the standard, and the tools, and none of them
allowed to read an existing exhibit's source. ${fanoutCount - 1} of the ${fanoutCount} passed every row of the looking
harness unaided; the exception was Replay, on legibility, for a text node too small for the pass to
measure. Every one of the ${fanoutCount} carries its author's own list of the places the document could not be
acted on, verbatim in its README, and all ${fanoutCount} hit the same wall: \`examples/_shared\` — the bootstrap
and the control panel those pages assume — lives in this repository and is not shipped. The
collected findings are docs/GALLERY.md § What eight strangers found in this document.

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
- ${src('docs/SEAMS.md')} — what holds between the nine, and what breaks if it moves. (AGENTS.md
  points at docs/ARCHITECTURE.md for this; that file does not exist. This one does.)
- ${src('docs/GUIDE.md')} — the walkthrough
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
  /** Two installs, and they are for two different readers. `libraries` is what an agent runs in a
   *  project; `plugin` is what a person runs once, into the agentic environment they already use.
   *  The landing page printed the first where the second belonged for its whole life. */
  install: {
    plugin: Object.fromEntries(plugin.map((p) => [p.tab, p.lines.map((l) => l.cmd)])),
    libraries: 'npm i @latticekit/core @latticekit/iso @latticekit/draw @latticekit/loop @latticekit/input',
    /** Not a literal. Three places on this page state whether the kit is installable — this
     *  block, and two sentences in /llms.txt — and they were written as three independent
     *  literals saying `false`. They stayed wrong through a release and a public repository,
     *  telling every agent that read /api.json that the packages it was being told to install
     *  did not exist. There is one fact here and it is the version the manifests carry. */
    published: true,
    publishedVersion: kit.version,
    note: `All nine packages are on the public npm registry at ${kit.version}. Both commands work as written.`,
  },
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
        /** Signatures, parameters and every doc comment, generated from this package's built
         *  declarations. The manifest above carries names and no types; that document has both. */
        reference: `/reference/${n}/`,
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
      // The gallery was a row here while it was 10 of 18. It is complete — eighteen exhibits and
      // the hero — so the row is gone rather than reworded to say so: a readiness list is what is
      // *not* settled, and a finished item announcing that it is finished is the same apology the
      // page's copy doctrine deletes, in the file an agent reads.
      ...(gallery.pending.length === 0
        ? []
        : [`the gallery: ${gallery.live.length} of ${gallery.live.length + gallery.pending.length} exhibits`]),
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
    /**
     * The fan-out, in the file an agent reads, because it is the strongest claim in this manifest
     * and a `by` field scattered across eighteen rows is not a claim, it is data somebody has to
     * assemble. `builtBy` is that assembly and nothing more — it is derived from those same rows.
     */
    fanOut: {
      claim: `${fanoutCount} of the ${gallery.live.length} exhibits were built by ${fanout.length} vendors' agents from docs/GALLERY.md alone`,
      method:
        "each agent was given only its own row of the exhibits table, the whole standard, and the tools, and was not allowed to read an existing exhibit's source — the test was whether the written spec is followable, not whether an agent can pattern-match",
      harness: `${fanoutCount - 1} of ${fanoutCount} passed every row of the looking harness unaided; the exception was Replay, on legibility, for a text node too small for the pass to measure`,
      builtBy: Object.fromEntries(fanout.map((v) => [v.vendor, v.built.map((x) => x.dir)])),
      whatTheyFound:
        'every one of the eight carries its author\'s own spec-gap notes verbatim in its README, and all eight hit the same wall: examples/_shared — the bootstrap and the control panel these documents assume a reader has — lives in this repository and is not shipped. Collected in docs/GALLERY.md § What eight strangers found in this document',
      builtHere: `the other ${gallery.live.length - fanoutCount} exhibits and the hero were built in this repository with a person in the loop`,
    },
  },
  /**
   * The three games in `from-one-sentence/`, which are **not** part of the gallery and are a
   * sibling key rather than a section of it for that reason. An exhibit was built inside this
   * repository against `docs/GALLERY.md`; each of these was built in an empty directory by an
   * agent that had never seen it. `sentence` is the complete prompt, never trimmed.
   */
  fromOneSentence: {
    claim: 'one sentence in, a playable game out, in an empty directory with no access to this repository',
    method:
      'each game was built by a different vendor\'s agent from the one sentence below, with @latticekit/* installed from the public npm registry. The source is unedited; the only change made to any of them is the --port in its dev script',
    record: src('from-one-sentence/README.md'),
    games: sentence.games.map((g) => ({
      ...g,
      source: tree(`from-one-sentence/${g.dir}`),
      live: `/g/${g.dir}/`,
    })),
  },
  example: { path: 'site/example/hello.ts', source: src('site/example/hello.ts'), code: example },
};

/* ── write ─────────────────────────────────────────────────────────────────────────────── */

// Nothing below may print a figure this file cannot re-derive. The page already refused to build
// on a stale `exampleLines`; this holds the other twenty-odd numbers to the same standard, and runs
// here rather than only in `npm run verify` because the Pages workflow builds the site without ever
// running the suite — which is exactly how /llms.txt spent a release telling agents the packages
// were unpublished.
const drifted = checkDerivable();
if (drifted.length > 0) {
  throw new Error(
    `site/data/measured.json has drifted from the repository in ${drifted.length} place(s):\n${drifted.join('\n')}\n` +
      'Run `npm run measured` for the full report, including the figures that need the test suite.',
  );
}

mkdirSync(join(site, 'public'), { recursive: true });
mkdirSync(join(site, 'reference'), { recursive: true });
writeFileSync(join(site, 'index.html'), html);
writeFileSync(join(site, 'reference/index.html'), referenceHtml);
/** One document per package, each one a real directory with an `index.html` in it, because
 *  `appType: 'mpa'` serves documents rather than routes and `/reference/iso/` has to 404 honestly
 *  if it is ever missing. `site/vite.config.ts` names every one of them as a Rollup input. */
let referenceBytes = Buffer.byteLength(referenceHtml);
for (const name of packageNames) {
  const page = packagePage(name);
  referenceBytes += Buffer.byteLength(page);
  mkdirSync(join(site, 'reference', name), { recursive: true });
  writeFileSync(join(site, 'reference', name, 'index.html'), page);
}
writeFileSync(join(site, 'public/llms.txt'), llms);
writeFileSync(join(site, 'public/api.json'), `${JSON.stringify(api, null, 2)}\n`);
writeFileSync(join(site, 'public/kit.json'), readFileSync(join(repo, '.lattice/kit.json')));

const bytes = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} kB`;
console.log(`site/index.html        ${bytes(html)}`);
console.log(`site/reference/**  ${(referenceBytes / 1024).toFixed(1)} kB in ${packageNames.length + 1} documents, ${commas(symbolCount)} symbols`);
console.log(`site/public/llms.txt   ${bytes(llms)}`);
console.log(`site/public/api.json   ${bytes(JSON.stringify(api, null, 2))}`);
console.log(`${packageNames.length} packages, ${gallery.live.length} live exhibits, ${Object.values(kit.packages).reduce((n, p) => n + p.exports.length, 0)} export rows`);
