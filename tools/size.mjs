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
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const kit = JSON.parse(readFileSync(join(ROOT, '.lattice/kit.json'), 'utf8'));
const budgetKb = kit.budgets.maxGzipKbPerPackage;

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

let over = 0;
let total = 0;
const rows = [];

for (const id of Object.keys(kit.packages)) {
  const dist = join(ROOT, 'packages', id, 'dist');
  if (!existsSync(dist)) {
    rows.push([id, '—', 'not built']);
    continue;
  }
  const source = jsFiles(dist)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const kb = gzipSync(source, { level: 9 }).byteLength / 1024;
  total += kb;
  const ok = kb <= budgetKb;
  if (!ok) over += 1;
  rows.push([id, `${kb.toFixed(2)} kB`, ok ? 'ok' : `OVER by ${(kb - budgetKb).toFixed(2)} kB`]);
}

const w = Math.max(...rows.map((r) => r[0].length));
for (const [id, size, note] of rows) {
  console.log(`  ${id.padEnd(w)}  ${size.padStart(9)}  ${note}`);
}
console.log(`  ${'total'.padEnd(w)}  ${`${total.toFixed(2)} kB`.padStart(9)}  budget ${budgetKb} kB per package`);

if (over > 0) {
  console.error(`\nsize: ${over} package${over === 1 ? '' : 's'} over budget.`);
  process.exit(1);
}
