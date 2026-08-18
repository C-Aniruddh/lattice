/**
 * Read every public symbol out of the **built type declarations** and hand back a model the
 * reference page can render: kind, real signature, parameters, and the doc comment that was
 * written above it.
 *
 * ```bash
 * npm run build                 # at the repo root — this reads packages/*&#47;dist/**&#47;*.d.ts
 * node site/tools/api-model.mjs # prints a summary; the page imports buildApiModel instead
 * ```
 *
 * ## Why the declarations and not the manifest
 *
 * `/reference/` used to be generated from `.lattice/kit.json`, which carries export *names*,
 * purposes and invariants and **no types at all**. So the page could answer "which package is
 * `pathSample` in" and never "how do I call it", which is the question somebody opens a reference
 * with. A reviewer said so in as many words.
 *
 * The declarations answer both, and they answer them from the compiler's own output rather than
 * from prose somebody has to remember to update: `packages/*&#47;dist/*.d.ts` is what `npm run build`
 * emits and what an adopter's editor reads, so a signature here is the signature they will get.
 *
 * **And the doc comments are the actual product.** Non-negotiable 5 requires every public symbol
 * to document a *why* rather than a *what*, and the result is RFC-grade explanations sitting in
 * these files — why pointer-anchored zoom exists, why `readonly` is not a barrier, why a duration
 * is not branded. A reference that prints `createCamera(width, height, options?)` and drops the
 * paragraph underneath it has thrown away the half worth reading. So the whole comment comes
 * across, markdown tables and all, and `doc-html.mjs` renders it.
 *
 * ## Why the TypeScript compiler API
 *
 * Three options were open, and the constraint that decides between them is that **the kit has zero
 * dependencies and that must not change**. A dev-only tool under `site/` may use a parser; nothing
 * it does may add an install to a package.
 *
 * | | cost | why not / why |
 * |---|---|---|
 * | **`typescript`'s compiler API** | none — already a root devDependency, used by `tsc --build` and by `site/`'s own typecheck | it is the program that *emitted* these files. It resolves `export { x } from './camera.js'` to the declaration in `camera.d.ts`, follows aliases, and reports the same text an editor shows on hover |
 * | a hand-rolled `.d.ts` reader | a weekend, then forever | it is a TypeScript parser with a smaller test suite. Generic constraints, overloads, nested type literals and `/** … *&#47;` inside a type literal are all things it would get wrong later rather than now |
 * | typedoc or api-extractor | a new dependency and a second theme to fight | they generate a whole site with its own layout. The requirement here is *this* site's layout, and the part of their work that is hard — parsing — is the part `typescript` already does |
 *
 * So: `ts.createProgram` over the nine `dist/index.d.ts` entry points, `checker.getExportsOfModule`
 * for the public surface, and the source text of each declaration for the signature. Nothing is
 * re-printed by the emitter: the text in the model is the text in the file, which means a reader
 * comparing the page against their editor sees the same characters.
 *
 * ## The cross-check that replaces the old one
 *
 * The manifest version had one property worth keeping: `npm run lint` fails the build if a package
 * exports a symbol `kit.json` does not list, so the page could not drift from the code. Generating
 * from `.d.ts` would have quietly retired that.
 *
 * {@link crossCheck} is the stronger form of it. It compares the exports the *compiler* found
 * against `kit.json`'s list, both directions, per package, and throws with the names on either
 * side. That catches everything the lint rule catches plus the case the lint rule cannot see — a
 * manifest that lists a name the built package does not actually export, which is what a stale
 * `--fix` leaves behind.
 */
import ts from 'typescript';
import { SourceMap } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The declaration kinds that reach a reader, in the words the page prints on the chip. */
const KIND = new Map([
  [ts.SyntaxKind.FunctionDeclaration, 'function'],
  [ts.SyntaxKind.InterfaceDeclaration, 'interface'],
  [ts.SyntaxKind.TypeAliasDeclaration, 'type'],
  [ts.SyntaxKind.ClassDeclaration, 'class'],
  [ts.SyntaxKind.VariableDeclaration, 'const'],
  [ts.SyntaxKind.EnumDeclaration, 'enum'],
  [ts.SyntaxKind.ModuleDeclaration, 'namespace'],
]);

/**
 * The declaration a doc comment is attached to, which is not always the declaration itself.
 *
 * `export declare const BASE_SLOTS: …` parses as a `VariableStatement` holding a
 * `VariableDeclaration`, and the comment sits above the statement. Asking the declaration for its
 * leading comments finds nothing and the page prints a documented constant as an undocumented one.
 */
const commentHost = (decl) => (ts.isVariableDeclaration(decl) ? decl.parent.parent : decl);

/**
 * The `/** … *&#47;` immediately above a node, raw.
 *
 * Raw rather than `symbol.getDocumentationComment(checker)` on purpose: that API returns the
 * comment already flattened into display parts, which loses the markdown tables and fenced code
 * blocks these comments are half made of, and those are the parts a reader skims for. The text is
 * un-starred here and rendered by `doc-html.mjs`.
 *
 * **"Immediately above" is load-bearing.** A blank line between a comment and a declaration means
 * the comment belongs to the file, not to the node — that is how a module header would otherwise
 * be printed as the documentation of whatever happens to be declared first.
 */
function rawDoc(node) {
  const file = node.getSourceFile();
  const text = file.text;
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const last = ranges.filter((r) => text.slice(r.pos, r.pos + 3) === '/**').at(-1);
  if (last === undefined) return '';
  if (text.slice(last.end, node.getStart(file)).includes('\n\n')) return '';
  return text.slice(last.pos, last.end);
}

/**
 * A JSDoc block, split into the prose and the tags.
 *
 * The prose keeps its own line breaks because it is markdown — a table, a fenced block and a list
 * all die if the lines are joined. Tags are `@param name text`, `@returns text`, `@throws text`,
 * `@example`, `@defaultValue`, and the two the kit invented: `@tier-b` marks arithmetic the ECMA
 * spec does not require to be correctly rounded, and `@browser-only` marks a module that touches
 * the DOM. Both of those are facts a caller has to know before calling, so both are surfaced.
 */
/**
 * The tags a line may open with, and the reason this is a list rather than `/^@\w+/`.
 *
 * `sim`'s header begins `@latticekit/sim — Idle-economy mathematics…`, and a permissive pattern
 * read that as a tag called `latticekit`, swallowed the entire 3,900-character introduction into
 * its body, and printed the best writing in the package as an empty section. A closed list cannot
 * do that: an unknown `@something` at the start of a line stays prose, which is the safe direction
 * to be wrong in.
 */
const TAGS = new Set([
  'param', 'returns', 'return', 'throws', 'example', 'defaultValue', 'default',
  'deprecated', 'see', 'remarks', 'template', 'typeParam', 'tier-a', 'tier-b',
  'browser-only', 'internal', 'since',
]);

export function parseDoc(raw) {
  if (raw === '') return { prose: '', tags: [] };
  const body = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();

  const lines = body.split('\n');
  const prose = [];
  const tags = [];
  let fence = false;
  let current;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    const tag = fence ? null : /^@([a-zA-Z][\w-]*)\s*(.*)$/.exec(line);
    if (tag !== null && tag !== undefined && TAGS.has(tag[1])) {
      const [, name, rest] = tag;
      if (name === 'param') {
        const m = /^(\[?[\w$.]+\]?)\s*-?\s*([\s\S]*)$/.exec(rest) ?? [, '', rest];
        current = { tag: name, name: m[1], text: m[2] };
      } else {
        current = { tag: name, name: '', text: rest };
      }
      tags.push(current);
    } else if (current !== undefined) {
      current.text = `${current.text}\n${line}`;
    } else {
      prose.push(line);
    }
  }
  for (const t of tags) t.text = t.text.trim();
  return { prose: prose.join('\n').trim(), tags };
}

/** Where a declaration came from, resolved through the emitted `.d.ts.map` back to the `.ts` the
 *  author wrote. Without the map the page would link a reader to a generated file they cannot
 *  edit; with it, `↳ source` lands on the line the comment above was written on. */
function originOf(decl, repo, maps) {
  const file = decl.getSourceFile();
  const { line, character } = file.getLineAndCharacterOfPosition(decl.getStart(file));
  const mapPath = `${file.fileName}.map`;
  if (!maps.has(mapPath)) {
    maps.set(mapPath, existsSync(mapPath) ? new SourceMap(JSON.parse(readFileSync(mapPath, 'utf8'))) : null);
  }
  const map = maps.get(mapPath);
  const rel = (p) => resolve(p).slice(resolve(repo).length + 1);
  const entry = map?.findEntry(line, character);
  if (entry === undefined || entry === null || entry.originalSource === undefined) {
    return { file: rel(file.fileName), line: line + 1 };
  }
  return { file: rel(join(dirname(file.fileName), entry.originalSource)), line: entry.originalLine + 1 };
}

/** The declaration's own text, minus the `export declare` the page states as a chip instead. */
const signatureOf = (decl) => {
  const file = decl.getSourceFile();
  const start = ts.isVariableDeclaration(decl) ? decl.parent.parent.getStart(file) : decl.getStart(file);
  return file.text
    .slice(start, decl.parent && ts.isVariableDeclaration(decl) ? decl.parent.parent.getEnd() : decl.getEnd())
    .replace(/^export\s+/, '')
    .replace(/^declare\s+/, '')
    .replace(/;$/, '');
};

/** The head of a container — everything up to the `{` — so an interface's members can be printed
 *  one at a time with their own prose instead of as one 4,000-character code block nobody reads. */
function headOf(decl) {
  const sig = signatureOf(decl);
  const brace = sig.indexOf('{');
  return brace === -1 ? sig : `${sig.slice(0, brace).trimEnd()} {`;
}

/** The members a container declares, each with the comment above it. An interface here is a
 *  contract with a paragraph per field, and those paragraphs are most of what `loop`, `input` and
 *  `audio` have to say. */
function membersOf(decl) {
  const list = ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)
    ? decl.members
    : ts.isTypeAliasDeclaration(decl) && ts.isTypeLiteralNode(decl.type)
      ? decl.type.members
      : [];
  const out = [];
  for (const m of list) {
    if (ts.isPropertySignature(m) || ts.isMethodSignature(m) || ts.isPropertyDeclaration(m) ||
        ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m) ||
        ts.isCallSignatureDeclaration(m) || ts.isConstructSignatureDeclaration(m) || ts.isIndexSignatureDeclaration(m)) {
      const file = m.getSourceFile();
      out.push({
        name: m.name === undefined ? '' : m.name.getText(file),
        text: file.text.slice(m.getStart(file), m.getEnd()).replace(/;$/, ''),
        doc: parseDoc(rawDoc(m)),
      });
    }
  }
  return out;
}

/**
 * The comment at the top of a file, which is where half of this kit's best writing lives.
 *
 * `createCamera`'s own comment is two lines and a `@throws`; the paragraph explaining why
 * pointer-anchored zoom exists at all — and the table splitting a camera's *position* from its
 * *policy* — is the header of `camera.ts`. A reference that printed only symbol comments would
 * drop exactly the passages worth the visit, so a module is a section with its own prose and its
 * symbols underneath it, which is also how the file reads.
 *
 * A file header is told apart from the first symbol's comment by what follows it. Four things say
 * "this belongs to the file": an `import` or a bare `export … from` (neither can be documented), a
 * declaration with no `export` on it (`time.d.ts` opens with two `unique symbol` brands, and a
 * comment above a symbol nobody can import is not that symbol's), a second `/** … *&#47;` block, or
 * a blank line. One comment sitting directly on the first *exported* declaration is that
 * declaration's, and taking it would print the same paragraph twice and leave the symbol bare.
 */
function moduleDoc(file) {
  const first = file.statements[0];
  if (first === undefined) return { prose: '', tags: [] };
  const ranges = (ts.getLeadingCommentRanges(file.text, first.getFullStart()) ?? [])
    .filter((r) => file.text.slice(r.pos, r.pos + 3) === '/**');
  const head = ranges[0];
  if (head === undefined) return { prose: '', tags: [] };
  const exported = ts.canHaveModifiers(first) &&
    (ts.getModifiers(first) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const detached =
    ts.isImportDeclaration(first) ||
    ts.isExportDeclaration(first) ||
    !exported ||
    ranges.length > 1 ||
    file.text.slice(head.end, first.getStart(file)).includes('\n\n');
  return detached ? parseDoc(file.text.slice(head.pos, head.end)) : { prose: '', tags: [] };
}

/**
 * Every exported symbol of one package, in the order the `.d.ts` declares them.
 *
 * Source order rather than alphabetical, because these files are written to be read top to bottom:
 * `camera.d.ts` puts `CameraOptions` above `createCamera` above `Camera` for the same reason a
 * tutorial would. The sidebar sorts alphabetically; the document keeps the author's order.
 */
function symbolsOf(program, checker, entry, repo, maps) {
  const file = program.getSourceFile(entry);
  if (file === undefined) throw new Error(`${entry} is missing — run \`npm run build\` at the repo root first`);
  const moduleSymbol = checker.getSymbolAtLocation(file);
  if (moduleSymbol === undefined) throw new Error(`${entry} is not a module`);

  const out = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const target = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported;
    const decls = (target.getDeclarations() ?? []).filter((d) => KIND.has(d.kind));
    if (decls.length === 0) continue;

    // Overloads are several declarations of one name: the doc comment is on whichever of them
    // carries it, and every signature is printed. Dropping the extra ones would hide the only
    // reason an overload exists.
    const doc = decls.map((d) => parseDoc(rawDoc(commentHost(d)))).find((p) => p.prose !== '' || p.tags.length > 0);
    const first = decls[0];
    const origin = originOf(first, repo, maps);
    out.push({
      name: exported.getName(),
      kind: KIND.get(first.kind) ?? 'symbol',
      module: first.getSourceFile().fileName.replace(/^.*\//, '').replace(/\.d\.ts$/, ''),
      // The file the declaration is actually in, which is not always inside this package: `input`
      // re-exports `Disposer` from `core` so that a caller wiring a controller never has to import
      // a second package for the thing it hands back. The page says so on the row.
      file: first.getSourceFile().fileName,
      owner: /packages\/([^/]+)\//.exec(origin.file)?.[1] ?? '',
      origin,
      signatures: decls.map((d) => (membersOf(d).length > 0 ? headOf(d) : signatureOf(d))),
      members: decls.flatMap(membersOf),
      doc: doc ?? { prose: '', tags: [] },
      order: first.getStart(first.getSourceFile()),
    });
  }
  return out;
}

/**
 * The manifest and the compiler have to agree about what a package exports, and this is where they
 * are made to.
 *
 * It is the property the old generator had that was worth keeping. `npm run lint` already fails
 * the build when a package exports a name `.lattice/kit.json` does not list; this runs the same
 * comparison from the other end — against the *built* declarations rather than the sources — and
 * fails in both directions, so a manifest listing a name that no longer exists is caught too.
 * Either way the page cannot describe an API that is not there.
 */
export function crossCheck(model, kit) {
  const problems = [];
  for (const pkg of model.packages) {
    const declared = [...(kit.packages[pkg.id]?.exports ?? [])].sort();
    const built = pkg.symbols.map((s) => s.name).sort();
    const missing = built.filter((n) => !declared.includes(n));
    const gone = declared.filter((n) => !built.includes(n));
    if (missing.length > 0) problems.push(`@latticekit/${pkg.id} exports ${missing.join(', ')} — .lattice/kit.json does not list ${missing.length === 1 ? 'it' : 'them'}`);
    if (gone.length > 0) problems.push(`.lattice/kit.json lists ${gone.join(', ')} for @latticekit/${pkg.id} — the built package does not export ${gone.length === 1 ? 'it' : 'them'}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `the API reference is generated from packages/*/dist/**/*.d.ts and cross-checked against .lattice/kit.json:\n  - ${problems.join('\n  - ')}\n` +
        'Run `npm run build` then `npm run lint -- --fix` at the repo root.',
    );
  }
}

/**
 * The reading order of a package's modules, taken from its own `index.d.ts`.
 *
 * `iso` re-exports projection, then camera, then depth, then tilemap — the order somebody would
 * teach it in, and the order its author put the lines in. Alphabetical would open `anchor` and
 * close `tilemap`, which is neither the order the package was written in nor one anybody chose.
 */
function moduleOrder(file) {
  const seen = [];
  for (const s of file.statements) {
    const spec = (ts.isExportDeclaration(s) || ts.isImportDeclaration(s)) && s.moduleSpecifier !== undefined
      ? s.moduleSpecifier.getText(file).slice(1, -1)
      : undefined;
    if (spec === undefined || !spec.startsWith('.')) continue;
    const id = spec.replace(/^\.\//, '').replace(/\.js$/, '');
    if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}

/** Build the model for every package named, in the order named. */
export function buildApiModel({ repo, packages }) {
  const entries = packages.map((id) => join(repo, `packages/${id}/dist/index.d.ts`));
  const program = ts.createProgram(entries, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    // No ambient `@types/*`: the page documents this kit's surface, and pulling Node's globals in
    // costs a second of parsing to describe nothing that appears on it.
    types: [],
  });
  const checker = program.getTypeChecker();
  const maps = new Map();
  return {
    packages: packages.map((id, i) => {
      const index = program.getSourceFile(entries[i]);
      if (index === undefined) throw new Error(`${entries[i]} is missing — run \`npm run build\` at the repo root first`);
      const symbols = symbolsOf(program, checker, entries[i], repo, maps).sort((a, b) => a.order - b.order);
      const order = [...moduleOrder(index), 'index'];
      const modules = [];
      for (const s of symbols) {
        let mod = modules.find((m) => m.id === s.module);
        if (mod === undefined) {
          const file = program.getSourceFile(s.file);
          // A symbol declared in `index.d.ts` itself — `VERSION`, in every package — would
          // otherwise reprint the package's own header as a module introduction, immediately
          // under it.
          const doc = file === undefined || s.module === 'index' ? { prose: '', tags: [] } : moduleDoc(file);
          mod = { id: s.module, doc, from: s.owner === id ? '' : s.owner, symbols: [] };
          modules.push(mod);
        }
        mod.symbols.push(s);
      }
      modules.sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
      });
      return { id, doc: moduleDoc(index), modules, symbols };
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = resolve(dirname(new URL(import.meta.url).pathname), '../..');
  const kit = JSON.parse(readFileSync(join(repo, '.lattice/kit.json'), 'utf8'));
  const model = buildApiModel({ repo, packages: Object.keys(kit.packages) });
  crossCheck(model, kit);
  for (const p of model.packages) {
    const docs = p.symbols.filter((s) => s.doc.prose !== '').length;
    console.log(`${p.id.padEnd(8)} ${String(p.symbols.length).padStart(3)} symbols  ${String(p.symbols.reduce((n, s) => n + s.members.length, 0)).padStart(3)} members  ${docs} documented`);
  }
}
