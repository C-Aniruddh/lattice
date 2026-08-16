#!/usr/bin/env node
/**
 * The size budget, measured.
 *
 * A kit whose selling point is "a game in a few dozen kilobytes" has to keep the receipt.
 * This gzips each package's built output and checks it against `budgets.maxGzipKbPerPackage`
 * in `.lattice/kit.json`. Run it after `npm run build`.
 *
 * Gzip rather than raw bytes because gzip is what a browser actually downloads, and raw
 * bytes reward minification tricks that make the source worse and change nothing on the wire.
 *
 * ## Comments are stripped first, and that is not cheating
 *
 * The prose in this kit is a load-bearing part of the product, and `tsc` emits every word of
 * it into the `.js`. Measuring that would charge each package for its own documentation and
 * make the budget an argument for writing less of it — precisely backwards. Every consumer
 * runs a bundler, and every bundler drops comments before the byte ever reaches a wire.
 *
 * So this strips comments and collapses indentation, then gzips. It is an approximation of
 * minified output, not minified output: identifiers are not mangled and dead code is not
 * eliminated, so the number here is **higher** than what a real build ships. Erring high is
 * the right direction for a budget — a package that fits here fits in production.
 *
 * ## Adapters are counted, and reported separately
 *
 * Six modules across the kit declare themselves `@browser-only`: they exist behind a single
 * named entry point, and a consumer who never imports it never downloads them. `input/dom.ts`
 * alone is a sixth of its package.
 *
 * They are still **counted**, because the consumer this budget protects is a game, and a game
 * does import them — excluding them would make the headline number describe a headless replay
 * nobody ships. But they are **reported**, because "this package is large" and "this package's
 * browser adapter is large" are different problems with different fixes, and a single figure
 * lets a budget conversation argue past that distinction for months.
 *
 * ## Mutually exclusive backends are charged at the heaviest, not summed
 *
 * That is the same species of question as the adapter above, and it has the **opposite** answer,
 * which is the whole of it. A declared `@browser-only` adapter is downloaded by a game, so it
 * stays in the number and is merely broken out. Two *mutually exclusive* backends are not both
 * downloaded by anybody: `draw` carries `canvas2d` and `record`, a browser game ships the first
 * and a headless replay or golden test ships the second, and their sum — 12.93 kB — is the
 * weight of a bundle no consumer has ever built. 12.08 and 11.30 are the two real numbers.
 *
 * So where a package declares alternative backends, this weighs **one bundle per backend** and
 * charges the **largest**. Three properties, and each of them is doing a job:
 *
 * | | | |
 * |---|---|---|
 * | the declaration is in `kit.json` | not in the module | a module cannot enroll itself, which is what `@browser-only` learned the hard way — it was matched anywhere in the first 2 kB and a barrel that merely *mentioned* it was granted the exemption |
 * | the claim is checked against the import graph | not taken on trust | if anything but the barrel imports a backend, or one backend imports another, they are not alternatives and the claim is **rejected and failed** rather than quietly ignored |
 * | the charge is the **maximum** | never the minimum, never the shared core | an exemption makes bytes vanish; a maximum cannot. Whatever the heaviest real consumer downloads is still exactly what the gate reads |
 *
 * That third row is the load-bearing one. Nothing a package can declare here makes it lighter
 * than its own worst bundle, so "call it a backend" is not available as a way to hide weight —
 * the only thing exclusivity can ever subtract is the *lighter* alternative, which is the one
 * nobody was downloading. A package that declares one backend, or none, is measured exactly as
 * before: five of the nine have a single implementation and describe nothing at all.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strip } from './lib/source.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const kit = JSON.parse(readFileSync(join(ROOT, '.lattice/kit.json'), 'utf8'));
const budgetKb = kit.budgets.maxGzipKbPerPackage;

/** Weighed the way a browser downloads it: comments out, then gzip. */
function weigh(files) {
  if (files.length === 0) return 0;
  return gzipSync(files.map((f) => strip(readFileSync(f, 'utf8'))).join('\n'), { level: 9 }).byteLength / 1024;
}

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Which of a package's modules declared themselves `@browser-only`.
 *
 * Read from `src/`, not `dist/`, because the marker lives in a comment and `strip` has already
 * removed it by the time we weigh anything. Matched in the first five lines, exactly as the
 * linter does — declaring something has to look different from talking about it.
 */
function adapterNames(pkgDir) {
  const names = new Set();
  const src = join(pkgDir, 'src');
  if (!existsSync(src)) return names;
  for (const file of jsFiles(src).concat(
    readdirSync(src).filter((n) => n.endsWith('.ts')).map((n) => join(src, n)),
  )) {
    try {
      if (readFileSync(file, 'utf8').split('\n', 5).join('\n').includes('@browser-only')) {
        names.add(file.replace(/\.ts$/, '.js').split('/').pop());
      }
    } catch {
      /* unreadable is not an adapter */
    }
  }
  return names;
}

/**
 * Who imports whom, inside one package's `dist/`.
 *
 * Read off the stripped source, so a doc comment that *names* a module — and several here do,
 * at length — cannot invent an edge. Only relative specifiers matter: a cross-package import is
 * somebody else's budget.
 */
function importGraph(dist, files) {
  const edges = new Map();
  for (const file of files) {
    const out = new Set();
    for (const m of strip(readFileSync(file, 'utf8')).matchAll(/(?:from|import)\s*\(?\s*'(\.[^']*)'/g)) {
      out.add(relative(dist, resolve(dirname(file), m[1])));
    }
    edges.set(relative(dist, file), out);
  }
  return edges;
}

/** Everything reachable from `roots` by following imports, roots included. */
function reach(edges, roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const at = stack.pop();
    if (seen.has(at) || !edges.has(at)) continue;
    seen.add(at);
    for (const next of edges.get(at)) stack.push(next);
  }
  return seen;
}

/**
 * The alternative bundles a package's consumers actually build, or `null` if it has only one.
 *
 * A package declares its backends in `kit.json` — `"backends": { "modules": [...], "reason":
 * "..." }` — and the declaration buys nothing until it survives three checks. Each of them is
 * a way the claim could be false, and a claim that fails one is **rejected**, which fails the
 * run rather than falling back to the old sum. An unearned claim has to cost the package
 * something, or it is free to make.
 *
 * 1. **Two or more, and all of them present.** One backend is not a choice, and a name that
 *    matches no module is a stale declaration rather than a bundle.
 * 2. **Nothing but the barrel imports a backend.** `index.js` names every backend by
 *    construction — that is what a barrel is, and it is why the shared core is computed with
 *    the barrel excluded as a root. But if any *other* module reaches a backend, then every
 *    consumer of that module downloads it, the alternatives ship together, and the claim is
 *    simply untrue. This is the check that stops a package moving its heaviest module behind
 *    the word "backend".
 * 3. **No backend reaches another.** If `canvas2d` imported `record`, they are a layer and not
 *    a choice.
 *
 * A backend's *private* subtree — modules nothing else reaches — travels with it, so dropping
 * a backend drops what only it needed. The `reason` is required and is not decoration: it is
 * the same discipline `budgets.overrides` already uses, where the argument lives beside the
 * number so a reviewer reads an exception rather than a number hiding one.
 */
function backendBundles(id, dist, files) {
  const declared = kit.packages[id]?.backends;
  if (!declared) return null;

  const names = Array.isArray(declared.modules) ? declared.modules : [];
  const reject = (why) => ({ rejected: `backends: ${why}` });

  if (names.length < 2) return reject('a single backend is not a choice — drop the declaration');
  if (typeof declared.reason !== 'string' || declared.reason.trim().length < 40) {
    return reject('no reason given. An exclusivity claim is an exception, and an exception is something a reviewer reads');
  }

  const byRel = new Map(files.map((f) => [relative(dist, f), f]));
  const backends = names.map((n) => `${n}.js`);
  const missing = backends.filter((b) => !byRel.has(b));
  if (missing.length > 0) return reject(`${missing.join(', ')} not in dist/ — the declaration is stale`);

  const edges = importGraph(dist, files);
  const barrel = 'index.js';
  const backendSet = new Set(backends);

  const sharedRoots = [...byRel.keys()].filter((rel) => rel !== barrel && !backendSet.has(rel));
  const shared = reach(edges, sharedRoots);
  const leaked = backends.filter((b) => shared.has(b));
  if (leaked.length > 0) {
    return reject(
      `${leaked.join(', ')} is imported by the package itself, not only by ${barrel} — every consumer downloads it, so these are not alternatives`,
    );
  }

  const own = new Map(backends.map((b) => [b, reach(edges, [b])]));
  for (const a of backends) {
    for (const b of backends) {
      if (a !== b && own.get(a).has(b)) return reject(`${a} imports ${b} — that is a layer, not a choice`);
    }
  }

  // One bundle per backend: everything, minus the other backends and whatever only they needed.
  return {
    // Sorted, like every other figure here: gzip is order-sensitive, and a number that moved
    // with a traversal order would be a number nobody could reproduce.
    shared: weigh([...byRel.keys()].filter((rel) => !backendSet.has(rel)).sort().map((rel) => byRel.get(rel))),
    bundles: backends.map((keep) => {
      const dropped = new Set();
      for (const other of backends) {
        if (other === keep) continue;
        for (const rel of own.get(other)) {
          if (!own.get(keep).has(rel) && !shared.has(rel) && rel !== barrel) dropped.add(rel);
        }
      }
      const kept = [...byRel.keys()].filter((rel) => !dropped.has(rel));
      return { name: keep.replace(/\.js$/, ''), kb: weigh(kept.map((rel) => byRel.get(rel))) };
    }),
  };
}

let over = 0;
let total = 0;
const rows = [];
const details = new Map();
const rejections = [];

for (const id of Object.keys(kit.packages)) {
  const dist = join(ROOT, 'packages', id, 'dist');
  if (!existsSync(dist)) {
    rows.push([id, '—', '', 'not built']);
    continue;
  }
  const files = jsFiles(dist);

  // What a consumer downloads. With one backend that is the whole package; with two mutually
  // exclusive ones it is the heaviest of the bundles that exist, because the sum is a bundle
  // that does not. Never the lightest — exclusivity may only ever subtract the alternative
  // nobody was downloading.
  const backends = backendBundles(id, dist, files);
  if (backends?.rejected) rejections.push([id, backends.rejected]);
  const kb =
    backends && !backends.rejected
      ? Math.max(...backends.bundles.map((b) => b.kb))
      : weigh(files);
  total += kb;

  // Weighed the same way, so the two figures are comparable rather than merely adjacent.
  const adapters = adapterNames(join(ROOT, 'packages', id));
  const adapterKb = weigh(files.filter((f) => adapters.has(f.split('/').pop())));
  // A package may hold a documented override. The reason lives in kit.json beside the number,
  // so an exception is something a reviewer reads rather than something a number hides.
  const override = kit.budgets.overrides?.[id];
  const limit = override?.maxGzipKb ?? budgetKb;
  if (kb > limit) over += 1;
  const note = backends?.rejected
    ? 'REJECTED'
    : kb <= limit
      ? override
        ? `ok (override ${limit} kB)`
        : 'ok'
      : `OVER by ${(kb - limit).toFixed(2)} kB`;
  const adapterNote = adapterKb > 0 ? `${adapterKb.toFixed(2)} kB adapter` : '';
  rows.push([id, `${kb.toFixed(2)} kB`, adapterNote, note]);

  if (backends && !backends.rejected) {
    const parts = backends.bundles
      .slice()
      .sort((x, y) => y.kb - x.kb)
      .map((b, n) => `${b.name} ${b.kb.toFixed(2)}${n === 0 ? ' (charged)' : ''}`);
    details.set(id, `exclusive backends, charged at the heaviest: ${parts.join(' · ')} · shared ${backends.shared.toFixed(2)}`);
  }
}

const w = Math.max(...rows.map((r) => r[0].length));
const a = Math.max(...rows.map((r) => (r[1] ?? '').length));
for (const [id, size, adapterNote, note] of rows) {
  console.log(`  ${id.padEnd(w)}  ${size.padStart(9)}  ${(adapterNote ?? '').padStart(a)}  ${note}`);
  const detail = details.get(id);
  if (detail) console.log(`  ${' '.repeat(w)}  ${detail}`);
}
console.log(`  ${'total'.padEnd(w)}  ${`${total.toFixed(2)} kB`.padStart(9)}  budget ${budgetKb} kB per package`);

for (const [id, why] of rejections) {
  console.error(`\n  ${id} ${why}.`);
  console.error(`  ${' '.repeat(id.length)} Weighed as one bundle until the declaration is true or gone.`);
}

if (over > 0 || rejections.length > 0) {
  const parts = [];
  if (over > 0) parts.push(`${over} package${over === 1 ? '' : 's'} over budget`);
  if (rejections.length > 0) {
    parts.push(`${rejections.length} backend declaration${rejections.length === 1 ? '' : 's'} rejected`);
  }
  console.error(`\nsize: ${parts.join(', ')}.`);
  process.exit(1);
}
