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
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const kit = JSON.parse(readFileSync(join(ROOT, '.lattice/kit.json'), 'utf8'));
const budgetKb = kit.budgets.maxGzipKbPerPackage;

/**
 * Remove comments and leading indentation, preserving string and template literals.
 *
 * Written out rather than regexed because a naive non-greedy block-comment pattern eats the
 * contents of any string that happens to contain a comment terminator — and this kit has
 * several, since its own linter quotes comment syntax back at you in its error messages.
 *
 * Writing that sentence with the terminator spelled literally is what broke this file the
 * first time, which is a fair demonstration of the point.
 */
function strip(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
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

let over = 0;
let total = 0;
const rows = [];

for (const id of Object.keys(kit.packages)) {
  const dist = join(ROOT, 'packages', id, 'dist');
  if (!existsSync(dist)) {
    rows.push([id, '—', '', 'not built']);
    continue;
  }
  const files = jsFiles(dist);
  const source = files.map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
  const kb = gzipSync(source, { level: 9 }).byteLength / 1024;
  total += kb;

  // Weighed the same way, so the two figures are comparable rather than merely adjacent.
  const adapters = adapterNames(join(ROOT, 'packages', id));
  const adapterFiles = files.filter((f) => adapters.has(f.split('/').pop()));
  const adapterKb = adapterFiles.length
    ? gzipSync(adapterFiles.map((f) => strip(readFileSync(f, 'utf8'))).join('\n'), { level: 9 })
        .byteLength / 1024
    : 0;
  // A package may hold a documented override. The reason lives in kit.json beside the number,
  // so an exception is something a reviewer reads rather than something a number hides.
  const override = kit.budgets.overrides?.[id];
  const limit = override?.maxGzipKb ?? budgetKb;
  const ok = kb <= limit;
  if (!ok) over += 1;
  const note = ok ? (override ? `ok (override ${limit} kB)` : 'ok') : `OVER by ${(kb - limit).toFixed(2)} kB`;
  const adapterNote = adapterKb > 0 ? `${adapterKb.toFixed(2)} kB adapter` : '';
  rows.push([id, `${kb.toFixed(2)} kB`, adapterNote, note]);
}

const w = Math.max(...rows.map((r) => r[0].length));
const a = Math.max(...rows.map((r) => (r[1] ?? '').length));
for (const [id, size, adapterNote, note] of rows) {
  console.log(`  ${id.padEnd(w)}  ${size.padStart(9)}  ${(adapterNote ?? '').padStart(a)}  ${note}`);
}
console.log(`  ${'total'.padEnd(w)}  ${`${total.toFixed(2)} kB`.padStart(9)}  budget ${budgetKb} kB per package`);

if (over > 0) {
  console.error(`\nsize: ${over} package${over === 1 ? '' : 's'} over budget.`);
  process.exit(1);
}
