#!/usr/bin/env node
/**
 * The gallery's line rule, measured.
 *
 * `docs/GALLERY.md` bounds an exhibit's **logic at 200 code lines and does not count its art
 * at all**, and classifies **per module**: a module is art if deleting it would change only
 * what the exhibit looks or sounds like, it holds no state that outlives a frame, and it moves
 * no number the player is playing for. Everything else is logic, and **every ambiguous module
 * is logic** — the budget is on logic, so the tiebreak has to cost the author something.
 *
 * Until this file existed the rule was two lines of `grep` in a markdown document, which is to
 * say it was not enforced at all. Fourteen exhibits are being written against it.
 *
 * ## What it prints, and what it fails
 *
 * It prints every exhibit's split, per module, because `docs/GALLERY.md` asks every author to
 * report that split and asks that fourteen reports be one series rather than fourteen opinions
 * about what a line is. It fails an exhibit whose **logic** exceeds 200. It never fails on the
 * ratio: an art floor would be met with padding inside a week, and the ratio is a report card.
 *
 * ## Three things worth getting right, and why
 *
 * **The measure is shared with the size budget.** `codeLines` comes from `tools/lib/source.mjs`,
 * the same function `size.mjs` weighs packages with. It reproduces the figures already published
 * in `docs/GALLERY.md` — 1,286 across Lamp Road's nine modules, and every per-file number in
 * that document's table — so nobody has to be talked into the metric.
 *
 * **A module declares itself, and a declaration has to look different from talking about one.**
 * `@art` counts only on its own line inside the file's **header doc comment**. The document's own
 * `grep -L` searches the whole file, which is the hole `@browser-only` already fell through once:
 * `persist/src/index.ts` merely *mentioned* the marker in prose and was granted the exemption.
 * A mention halfway down a 300-line logic module is not a classification.
 *
 * **An exhibit with no `@art` anywhere is reported as suspicious, not merely as large.** Read
 * literally, an untagged exhibit is all logic. In practice an exhibit with no art module is
 * almost certainly one whose author has not tagged anything yet, and the difference matters
 * because the first number tells an author to delete code and the second tells them to add a
 * line. It still fails if it is over — the cap is the cap — but it fails saying which it is.
 *
 * ## The exemption, and why it lives here rather than in the exhibit
 *
 * The hero (`examples/demo`, Lamp Road) is exempt from **the line rule alone** and from nothing
 * else. `docs/GALLERY.md` is emphatic that there is exactly one hero and that the document names
 * it: *"A row may not claim the exemption, and 'it is really a hero' is not a defense available
 * to an exhibit that overran."* So the name is a constant in this file. An exemption a directory
 * could claim for itself — a tag, a field in its own `package.json` — would be the same hole in
 * a second place, and this rule already knows what that costs.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeLines } from './lib/source.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = join(ROOT, 'examples');

/** The cap, on logic only. `docs/GALLERY.md` § The line rule. */
const LOGIC_CAP = 200;

/**
 * The one hero, named here because `docs/GALLERY.md` names it and for no other reason.
 * Exempt from the line rule and from nothing else in that document.
 */
const HERO = 'demo';

/**
 * Never an exhibit: the bootstrap and the control panel are gallery instruments rather than
 * parts of any exhibit, and `docs/GALLERY.md` excludes them by name.
 */
const NOT_AN_EXHIBIT = new Set(['_shared']);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-ts', 'coverage', '.vite']);

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * The file's header doc comment — the leading block comment and nothing else.
 *
 * Anchored at the top of the file so that a module which opens with an import has no header,
 * and therefore no way to declare itself art. That is the intended answer: non-negotiable 4
 * already makes a module's first doc line the place it confesses what it is, and a module that
 * does not confess is logic by the tiebreak.
 */
function headerDoc(raw) {
  const match = raw.match(/^\uFEFF?\s*(?:#![^\n]*\r?\n\s*)?\/\*[\s\S]*?\*\//);
  return match ? match[0] : '';
}

/**
 * Did this module declare itself art?
 *
 * `@art` must open a line of the header doc comment. Trailing prose on the same line is fine and
 * encouraged — *why* a module is art is the interesting half — but the tag has to come first,
 * because a sentence that happens to contain the word is a mention and not a declaration.
 */
function declaresArt(raw) {
  return /^[ \t]*\*?[ \t]*@art\b/m.test(headerDoc(raw));
}

/**
 * The exhibit's CSS, counted as art and charged to nothing.
 *
 * `docs/GALLERY.md` settles this case explicitly — *"the CSS in `index.html`: art, uncounted,
 * like every other art line. An exhibit's whole appearance may live here."* It is counted at
 * all because the ratio is a report card and an exhibit whose look lives in a `<style>` block
 * would otherwise report as having no art.
 *
 * This is the one place the shared measure and the document's `grep` disagree, and the measure
 * is right. Over Lamp Road's nine modules they agree file for file and total 1,286; over its
 * `<style>` the grep says 104 and this says 99. Two of the five are the `<style>` and `</style>`
 * tags, which are markup. The rest are *wrapped* comment lines — a CSS block comment whose
 * second line starts with a word rather than a `*`, which the grep's `^[[:space:]]*\*` cannot
 * see and which `strip` removes correctly. It costs nothing either way: the art figure gates
 * on nothing at all.
 */
function cssArtLines(exhibitDir) {
  const html = join(exhibitDir, 'index.html');
  if (!existsSync(html)) return 0;
  const raw = readFileSync(html, 'utf8');
  let total = 0;
  for (const block of raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) total += codeLines(block[1]);
  return total;
}

function exhibitDirs() {
  if (!existsSync(EXAMPLES)) return [];
  return readdirSync(EXAMPLES)
    .filter((name) => !name.startsWith('.') && !NOT_AN_EXHIBIT.has(name) && !SKIP_DIRS.has(name))
    .filter((name) => statSync(join(EXAMPLES, name)).isDirectory())
    .sort();
}

// Scope to one exhibit the way every other command here scopes: `npm run gallery -- island`.
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = new Set(only.map((a) => basename(a.replace(/\/+$/, ''))));

const reports = [];
for (const name of exhibitDirs()) {
  if (wanted.size > 0 && !wanted.has(name)) continue;
  const dir = join(EXAMPLES, name);
  const src = join(dir, 'src');
  if (!existsSync(src)) {
    reports.push({ name, missing: true });
    continue;
  }
  const modules = tsFiles(src).map((file) => {
    const raw = readFileSync(file, 'utf8');
    return { path: relative(src, file), lines: codeLines(raw), art: declaresArt(raw) };
  });
  const logic = modules.filter((m) => !m.art).reduce((n, m) => n + m.lines, 0);
  const css = cssArtLines(dir);
  const art = modules.filter((m) => m.art).reduce((n, m) => n + m.lines, 0) + css;
  reports.push({
    name,
    modules,
    css,
    logic,
    art,
    hero: name === HERO,
    tagged: modules.some((m) => m.art),
    over: logic > LOGIC_CAP,
  });
}

if (reports.length === 0) {
  console.log('  gallery: no exhibits yet.');
  process.exit(0);
}

console.log(`\n  logic under ${LOGIC_CAP} code lines; art uncounted. docs/GALLERY.md § The line rule\n`);

const failures = [];
const notes = [];
const nameWidth = Math.max(...reports.map((r) => r.name.length));

for (const r of reports) {
  if (r.missing) {
    console.log(`  ${r.name.padEnd(nameWidth)}   no src/ yet\n`);
    continue;
  }
  const verdict = r.hero
    ? `hero — exempt from the line rule`
    : r.over
      ? `OVER by ${r.logic - LOGIC_CAP}`
      : `ok, ${LOGIC_CAP - r.logic} to spare`;
  const ratio = r.logic + r.art > 0 ? `${Math.round((r.art / (r.logic + r.art)) * 100)}% art` : '';
  console.log(
    `  ${r.name.padEnd(nameWidth)}   ${String(r.logic).padStart(5)} logic  ${String(r.art).padStart(5)} art   ${ratio.padStart(7)}   ${verdict}`,
  );

  const w = Math.max(...r.modules.map((m) => m.path.length), 1);
  for (const m of r.modules) {
    console.log(`      ${m.art ? 'art  ' : 'logic'}  ${m.path.padEnd(w)}  ${String(m.lines).padStart(5)}`);
  }
  if (r.css > 0) console.log(`      art    ${'index.html <style>'.padEnd(w)}  ${String(r.css).padStart(5)}`);
  console.log('');

  if (r.over && !r.hero) failures.push(r);
  if (!r.tagged) notes.push(r);
}

for (const r of notes) {
  console.log(
    `  ${r.name}: no module declares @art, so all ${r.logic} of its lines counted as logic.\n` +
      `        An exhibit with no art module is far likelier to have forgotten the tag than to be\n` +
      `        all logic. Put @art on its own line in the header doc comment of every module that\n` +
      `        only draws or synthesizes — deleting it changes how the exhibit looks or sounds and\n` +
      `        nothing else. docs/GALLERY.md § Which module is which.\n`,
  );
}

if (failures.length > 0) {
  console.error('');
  for (const r of failures) {
    console.error(`  ${r.name}: ${r.logic} logic lines against a cap of ${LOGIC_CAP}.`);
    console.error(
      r.tagged
        ? `        Split the module, or find the second exhibit inside this one — docs/GALLERY.md rule 2\n` +
            `        arrives at the same place from the other side.`
        : `        Untagged, so read that number as a classification problem first and a size problem\n` +
            `        second. Tag the art modules, then look again.`,
    );
  }
  console.error(`\ngallery: ${failures.length} exhibit${failures.length === 1 ? '' : 's'} over the logic cap.`);
  process.exit(1);
}
