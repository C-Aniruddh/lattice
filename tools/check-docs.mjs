#!/usr/bin/env node
/**
 * The documentation's code, compiled.
 *
 * Every package in this kit keeps its own README honest with a `readme.test.ts`. The two
 * documents a stranger actually reads first — the root `README.md` and `docs/GUIDE.md` — had
 * no such instrument, which is the wrong way round: they are the most-read and the least
 * checked, and their examples are the ones a newcomer pastes.
 *
 * This extracts every ` ```ts ` block from those files, concatenates each document into one
 * program, and type-checks it against the repo's own strict configuration. A rename that
 * breaks the front page now fails `npm run verify` instead of being discovered by whoever
 * arrived next.
 *
 * ## Why concatenate rather than compile each block alone
 *
 * A guide is a narrative: block four uses the `world` that block two built. Compiling blocks
 * in isolation would force every one of them to restate its setup, which is exactly the
 * documentation style this kit avoids — and it would let the guide drift into a sequence of
 * snippets that each work and do not compose. Concatenation checks the story, not the
 * sentences, and a duplicate identifier across two blocks is a real defect in the narrative.
 *
 * A block may opt out with ` ```ts ignore ` — for deliberately-wrong examples, which the
 * traps sections need.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = ['README.md', 'docs/GUIDE.md'];
const OUT = join(ROOT, '.lattice/doccheck');

/**
 * Pull the fenced TypeScript out of a markdown file.
 *
 * Returns the blocks with a line-offset comment before each, so a `tsc` error points at
 * something a reader can find in the source document rather than at a line in a temporary
 * file that will not exist by the time they look.
 */
function extract(markdown, file) {
  const blocks = [];
  const lines = markdown.split('\n');

  /** `null` outside any fence; otherwise the fence we are inside. */
  let fence = null;
  let buffer = [];

  lines.forEach((line, i) => {
    const marker = line.match(/^```(.*)$/);
    if (marker === null) {
      if (fence?.capture === true) buffer.push(line);
      return;
    }
    if (fence === null) {
      // Opening. Capture only `ts`, and only when the info string does not say `ignore` —
      // the traps sections need blocks that are deliberately wrong.
      const info = (marker[1] ?? '').trim();
      const lang = info.split(/\s+/)[0] ?? '';
      fence = { capture: lang === 'ts' && !/\bignore\b/.test(info), line: i + 2 };
      buffer = [];
      return;
    }
    // Closing.
    if (fence.capture) blocks.push({ line: fence.line, code: buffer.join('\n') });
    fence = null;
    buffer = [];
  });

  return blocks.map((b) => `// ─── ${file}:${b.line} ───\n${b.code}`).join('\n\n');
}

mkdirSync(OUT, { recursive: true });

const files = [];
for (const doc of DOCS) {
  let source;
  try {
    source = readFileSync(join(ROOT, doc), 'utf8');
  } catch {
    console.error(`check-docs: ${doc} is missing — it is named in the verify gate`);
    process.exit(1);
  }
  const code = extract(source, doc);
  if (code.trim() === '') {
    console.log(`check-docs: ${doc} — no TypeScript blocks`);
    continue;
  }
  const out = join(OUT, `${basename(doc, '.md').toLowerCase()}.ts`);
  writeFileSync(out, `${code}\n`);
  files.push({ doc, out, blocks: code.split('// ─── ').length - 1 });
}

// The same strictness the packages are held to, plus the workspace path mapping so the
// examples import `@latticekit/iso` exactly as a reader would.
const tsconfig = join(OUT, 'tsconfig.json');
writeFileSync(
  tsconfig,
  `${JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        noEmit: true,
        composite: false,
        incremental: false,
        baseUrl: '../..',
        paths: { '@latticekit/*': ['packages/*/src/index.ts'] },
        types: [],
      },
      include: ['*.ts'],
    },
    null,
    2,
  )}\n`,
);

try {
  execFileSync('npx', ['tsc', '-p', tsconfig], { cwd: ROOT, stdio: 'pipe' });
} catch (error) {
  const output = String(error.stdout ?? '') + String(error.stderr ?? '');
  console.error(output.trim());
  console.error(
    `\ncheck-docs: the documentation does not compile.\n` +
      `Each error's file is a generated copy; the banner comment above the offending line names\n` +
      `the real document and line. Fix the document, not the copy — the copy is rebuilt every run.`,
  );
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
for (const f of files) console.log(`check-docs: ${f.doc} — ${f.blocks} blocks compile`);
