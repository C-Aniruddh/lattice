/**
 * The invariants no behavioural test can reach.
 *
 * Four of this package's promises are about what the code *does not* contain — no canvas outside
 * one module, no clock, no second sorted list, and no allocation on the frame path — and none of
 * them can be observed by calling anything. A function that allocates behaves identically to one
 * that does not until a profiler is attached.
 *
 * So this file reads the source. It is the same instrument `@latticekit/iso` uses, and the
 * allocation check in particular is a *source* check for the reason `iso` documented after
 * trying the alternatives: a heap delta cannot see the failure, because the objects a leaking
 * primitive creates are dead the instant they are made and a scavenge collects them before
 * `heapUsed` moves; and a garbage-collection count reports a few dozen collections for a loop
 * that allocates nothing at all, because the module loader and the runner are collecting too.
 * What is left is precise and cannot flake: read the bodies of the functions a frame calls and
 * check that no allocating syntax appears in them.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const TEST = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(SRC)
  .filter((name) => name.endsWith('.ts'))
  .sort();

/**
 * Blank comments and string literals, preserving line structure.
 *
 * Without this every rule fires on its own documentation: the sentence "never name a canvas" is
 * exactly the text the purity rule looks for, and an error message that quotes a banned global
 * is not a use of it.
 */
function strip(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j + 1;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

const sources = new Map(files.map((name) => [name, strip(readFileSync(SRC + name, 'utf8'))]));

describe('the source itself', () => {
  it('has a test file for every module', () => {
    // `test/` mirrors `src/` one file to one file, so a module that arrives without a suite is
    // noticed the day it arrives rather than at the next audit.
    const tests = new Set(
      readdirSync(TEST)
        .filter((name) => name.endsWith('.test.ts'))
        .map((name) => name.replace('.test.ts', '.ts')),
    );
    for (const name of files) {
      if (name === 'index.ts') continue;
      expect(tests.has(name), `${name} has no test file`).toBe(true);
    }
    expect(files.length).toBeGreaterThan(8);
  });

  it('I1: names a canvas in canvas2d.ts and nowhere else', () => {
    // The seam, checked rather than promised. A solid that reached for the context to do
    // something `Surface` would not allow is the way the WebGL backend becomes impossible.
    const canvas = /\b(CanvasRenderingContext2D|HTMLCanvasElement|OffscreenCanvas|document|window|navigator)\b/;
    for (const [name, code] of sources) {
      const found = canvas.exec(code);
      const allowed = name === 'canvas2d.ts';
      expect(found === null || allowed, `${name} names ${found?.[0] ?? ''}`).toBe(true);
    }
    expect(canvas.test(sources.get('canvas2d.ts') ?? '')).toBe(true);
  });

  it('the browser module declares itself the adapter', () => {
    expect(readFileSync(`${SRC}canvas2d.ts`, 'utf8').slice(0, 2000)).toContain('@browser-only');
  });

  it('I8: reads no clock and no random source anywhere', () => {
    // `t` arrives on the pen and every stream is seeded from a `Variant`. An `animate` that
    // closed over a counter would be the same failure one layer up, which is why the massing
    // signature is `(writer, variant, rng)` and nothing else.
    const nondeterminism = /\b(Math\.random|Date\.now|performance\.now|new Date|setTimeout|setInterval|requestAnimationFrame)\b/;
    for (const [name, code] of sources) {
      const found = nondeterminism.exec(code);
      expect(found?.[0] ?? null, `${name} reads a clock or a random source`).toBe(null);
    }
  });

  it('confines Tier B to the one site that needs it, evaluated once at module load', () => {
    // `cos`/`sin` are not required to be correctly rounded, so they may reach pixels and nothing
    // else. Here they build a cylinder's arc table at import and are never called again.
    const tierB =
      /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|sinh|cosh|tanh)\b/;
    const withTierB = [...sources]
      .filter(([, code]) => tierB.test(code))
      .map(([name]) => name);
    expect(withTierB).toEqual(['solids.ts']);
    expect(sources.get('solids.ts')).toContain('buildArc');
  });

  it('uses no non-null assertion and no any', () => {
    for (const [name, code] of sources) {
      expect(/[\w\])]![.[]/.test(code), `${name} has a non-null assertion`).toBe(false);
      expect(/:\s*any\b|<any>|as any\b/.test(code), `${name} has an any`).toBe(false);
    }
  });

  it('ends every relative import in .js, and imports no barrel from inside', () => {
    for (const [name, code] of sources) {
      for (const match of code.matchAll(/from\s+'(\.[^']*)'/g)) {
        const spec = match[1] as string;
        expect(spec.endsWith('.js'), `${name} imports ${spec} without .js`).toBe(true);
        if (name !== 'index.ts') {
          expect(/index\.js$/.test(spec), `${name} imports the barrel`).toBe(false);
        }
      }
    }
  });

  it('I25: contains nothing that orders drawables', () => {
    // There is one sorted list in the kit and it is `iso.DepthSorter`. A second ordering here is
    // how the two come to disagree about which building is in front.
    for (const [name, code] of sources) {
      for (const match of code.matchAll(/\.sort\s*\(/g)) {
        const before = code.slice(Math.max(0, (match.index ?? 0) - 60), match.index);
        // The only `sort(` this package may contain is the call that hands the frame's order to
        // `iso` — and `keys()`, which sorts strings for a stable error message.
        expect(
          /order\s*$|\[\.\.\.map\.keys\(\)\]\s*$/.test(before),
          `${name} sorts something that is not iso's order: …${before}`,
        ).toBe(true);
      }
    }
  });

  it('has no serialization, and must never grow any', () => {
    // The moment this package can write a color to a save, someone writes a presentation-tier
    // value into a document that travels between engines. Store the hue; derive on load.
    for (const [name, code] of sources) {
      expect(/JSON\.parse/.test(code), `${name} parses JSON`).toBe(false);
      expect(/localStorage|sessionStorage/.test(code), `${name} reaches a store`).toBe(false);
    }
  });
});

describe('I9: the frame path allocates nothing', () => {
  /** The body of a named function or method, brace-matched from its signature. `anchor::name`
   *  starts the search after `anchor`, which is what stops the matcher finding an interface's
   *  *declaration* of a method and walking off into whatever block came next. */
  function bodyOf(code: string, qualified: string): string {
    const sep = qualified.indexOf('::');
    const name = sep < 0 ? qualified : qualified.slice(sep + 2);
    const from = sep < 0 ? 0 : code.indexOf(qualified.slice(0, sep));
    expect(from, `${qualified}: anchor not found`).toBeGreaterThanOrEqual(0);
    const rest = code.slice(from);
    const offset = rest.search(new RegExp(`(^|[\\s.#])${name}\\s*\\(`, 'm'));
    expect(offset, `${qualified} not found`).toBeGreaterThanOrEqual(0);
    const at = from + offset;
    let i = code.indexOf('(', at);
    let depth = 0;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const open = code.indexOf('{', i);
    let braces = 0;
    for (let j = open; j < code.length; j++) {
      if (code[j] === '{') braces += 1;
      else if (code[j] === '}') {
        braces -= 1;
        if (braces === 0) return code.slice(open + 1, j);
      }
    }
    throw new Error(`${name}: unbalanced body`);
  }

  /** Drop `throw` statements: an error path allocates an `Error` by definition, and it ends the
   *  frame rather than running sixty times a second inside it. */
  function withoutThrows(body: string): string {
    return body.replace(/throw[\s\S]*?\);/g, '');
  }

  /**
   * Every function a frame calls, by module.
   *
   * The list is the point: it is what "the hot path" means for this package, written down where a
   * reviewer can disagree with it. A function that joins the frame and is not added here is a
   * gap, and one that leaves it should be removed in the same commit.
   */
  const perFrame: Readonly<Record<string, readonly string[]>> = {
    'color.ts': ['byteOf', 'redOf', 'greenOf', 'blueOf', 'alphaOf', 'rgba', 'shade', 'outlineOf', 'withAlpha', 'mix'],
    'solids.ts': [
      'levelsToPx',
      'pxToLevels',
      'expectFiniteBox',
      'pushAlpha',
      'popAlpha',
      'put',
      'groundQuad',
      'isoTile',
      'isoPatch',
      'isoBox',
      'isoCylinder',
      'isoRoof',
      'isoWall',
      'isoPost',
      'glowDot',
    ],
    'shadow.ts': ['contactShadow', 'wash'],
    // The widest loop in the package: every visible tile of every frame on a heightfield.
    'terrain.ts': ['isoTerrain'],
    'text.ts': ['wallText', 'screenText'],
    'light.ts': [
      'const field: LightField = {::begin',
      'const field: LightField = {::add',
      'const field: LightField = {::addScreen',
      'const field: LightField = {::composite',
      'pool',
      'unit',
      'bufferSize',
    ],
    'sprite.ts': [
      'streamFor',
      'expectFiniteGround',
      'drawSprite',
      'drawGhost',
      'drawFootprint',
      'class PenWriter::rewrite',
      'class PenWriter::tile',
      'class PenWriter::box',
      'class PenWriter::cylinder',
      'class PenWriter::roof',
      'class PenWriter::patch',
      'class PenWriter::wall',
      'class PenWriter::post',
      'class PenWriter::glow',
      'class PenWriter::sign',
      'class PenWriter::shadow',
    ],
    'palette.ts': ['quantise'],
  };

  it('checks every function the list names, and the list is not empty', () => {
    // The guard against a matcher that silently stops matching and turns the block below into a
    // loop over nothing.
    let checked = 0;
    for (const [file, names] of Object.entries(perFrame)) {
      const code = sources.get(file);
      expect(code, `${file} is missing`).toBeDefined();
      for (const name of names) {
        expect(bodyOf(code ?? '', name).length).toBeGreaterThan(0);
        checked += 1;
      }
    }
    expect(checked).toBe(54);
    // …and the bodies found are the right ones, not a neighboring block the matcher wandered
    // into. `isoBox` computes four x projections; `PenWriter.box` calls `isoBox`.
    expect(bodyOf(sources.get('solids.ts') ?? '', 'isoBox')).toContain('toScreenX');
    expect(bodyOf(sources.get('sprite.ts') ?? '', 'class PenWriter::box')).toContain('isoBox');
  });

  it('would catch an allocation if one appeared — the check is not vacuous', () => {
    // A test that cannot fail is worse than no test. `beginFrame` allocates the frame's pen, on
    // purpose and once per frame, so it is the honest control for the regex below.
    const allocating = /\bnew\b|=>|\bfunction\b|[=(:,]\s*[{[]|\breturn\s*[{[]/;
    const control = bodyOf(sources.get('surface.ts') ?? '', 'beginFrame');
    expect(allocating.test(withoutThrows(control))).toBe(true);
  });

  it('contains no object literal, array literal, closure or `new` in any of them', () => {
    // `{ x, y }` returned sixty times a second times four hundred sprites is a garbage collector
    // pause with a pleasant API. So is a closure allocated per sprite per frame.
    const allocating = /\bnew\b|=>|\bfunction\b|[=(:,]\s*[{[]|\breturn\s*[{[]/;
    for (const [file, names] of Object.entries(perFrame)) {
      const code = sources.get(file) ?? '';
      for (const name of names) {
        const body = withoutThrows(bodyOf(code, name));
        const found = allocating.exec(body);
        expect(found?.[0] ?? null, `${file}: ${name} allocates (${found?.[0] ?? ''})`).toBe(null);
      }
    }
  });

  it('confines every remaining allocation to setup, to a pool that fills once, or to the recorder', () => {
    // Everything that does allocate, named. `record.ts` is the one module in this package
    // permitted to allocate freely, because it never runs in a frame; `canvas2d.ts` allocates a
    // gradient object per ramped polygon and a ramp canvas per color pair, both documented at
    // the site; the rest build their buffers once and reuse them for ever.
    const allowed = new Set([
      'beginFrame',
      'subPen',
      'buildArc',
      'acquire',
      'renderFrame',
      'createLightField',
      'createPalette',
      'lerpPalette',
      'paletteVars',
      'measurePalette',
      'createNullSurface',
      'makeRecorder',
      'makeCanvasSurface',
      'makeElement',
      'rampFor',
      'polyRamp',
      'points',
      'push',
      'text',
      'createRecordingSurface',
      'createCanvas2dSurface',
      'createOffscreenSurface',
      'stroke',
      'setLineDash',
      'campus',
    ]);
    for (const [file, code] of sources) {
      if (file === 'index.ts' || file === 'record.ts') continue;
      for (const match of code.matchAll(/\bnew (?:Float64Array|Int32Array|Uint8Array|Map|WeakMap|PenWriter|MeasureWriter)\b/g)) {
        const before = code.slice(0, match.index);
        // `reject` and `expect` are calls that begin a line and read as declarations to the
        // scan below; neither owns anything.
        const control = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'expect', 'reject']);
        const owners = [
          ...before.matchAll(/(?:^|\n)\s*(?:export )?(?:function |get |)([A-Za-z_$#][\w$]*)\s*\(/g),
        ]
          .map((m) => m[1] as string)
          .filter((n) => !control.has(n));
        // A module-level `const x = new Map()` has no enclosing declaration at all, which is the
        // case this reports as the empty owner — and which is setup by definition.
        const line = code.slice(before.lastIndexOf('\n') + 1).split('\n')[0] ?? '';
        const owner = /^const\s/.test(line) ? '' : (owners[owners.length - 1] ?? '');
        expect(
          owner === '' || allowed.has(owner),
          `${file}: ${match[0]} inside ${owner || '(module scope)'}`,
        ).toBe(true);
      }
    }
  });
});
