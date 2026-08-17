/**
 * The invariants no behavioural test can reach.
 *
 * Three of this package's promises are about what the code *does not* contain — no DOM global,
 * no transcendental function, no function that returns an object the caller did not hand in —
 * and none of them can be observed by calling anything. There is no input that makes a
 * `Math.atan2` visible in a return value, and a function that allocates behaves identically to
 * one that does not until a profiler is attached.
 *
 * So this file reads the source. It is the same instrument `@latticekit/core` uses for its own
 * Tier B audit, and it is deliberately blunt: a regex over the stripped source, with the
 * comment and string content blanked so that a doc comment mentioning `window` does not fail
 * the rule it is documenting.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(SRC)
  .filter((name) => name.endsWith('.ts'))
  .sort();

/**
 * Blank comments and string literals, preserving line structure.
 *
 * Without this every rule fires on its own documentation: the sentence "never call
 * `Math.random()`" is exactly the text the determinism rule looks for, and an error message
 * that quotes a banned global is not a use of it.
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
  it('has a module for every name kit.json lists, and a test for every module', () => {
    // The one structural check: `test/` mirrors `src/` one file to one file, so a module that
    // arrives without a suite is noticed the day it arrives rather than at the next audit.
    const tests = new Set(
      readdirSync(fileURLToPath(new URL('.', import.meta.url)))
        .filter((n) => n.endsWith('.test.ts'))
        .map((n) => n.replace('.test.ts', '.ts')),
    );
    for (const name of files) {
      if (name === 'index.ts') continue;
      expect(tests.has(name), `${name} has no test file`).toBe(true);
    }
  });

  it('I16: names no DOM global and reads no clock', () => {
    // `iso` is isomorphic: the depth sort and the pathfinder are the two things most worth
    // testing and neither should need a browser to test.
    const banned =
      /\b(window|document|localStorage|sessionStorage|navigator|HTMLElement|CanvasRenderingContext2D|AudioContext|requestAnimationFrame|devicePixelRatio)\b/;
    const time = /\b(Math\.random|Date\.now|performance\.now|new Date|setTimeout|setInterval)\b/;
    for (const [name, code] of sources) {
      expect(banned.test(code), `${name} names a DOM global`).toBe(false);
      expect(time.test(code), `${name} reads a clock or a random source`).toBe(false);
    }
  });

  it('I17: calls no trigonometric, exponential or logarithmic function', () => {
    // Tier A only. ECMA-262 specifies `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise
    // operators exactly; it does not require correctly-rounded `sin`, `cos`, `atan2`, `pow`,
    // `exp` or `log`. A path, a depth order and a tile address all reach save files.
    const tierB =
      /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|sinh|cosh|tanh)\b/;
    for (const [name, code] of sources) {
      const match = tierB.exec(code);
      expect(match?.[0] ?? null, `${name} calls a Tier B function`).toBe(null);
    }
  });

  it('I17: uses Math.sqrt only where arc length needs it', () => {
    // `sqrt` is Tier A and is permitted. Listing where it appears keeps the claim auditable:
    // if a third module grows one, somebody has to decide whether that value is ever hashed.
    const withSqrt = [...sources]
      .filter(([, code]) => /\bMath\.sqrt\b/.test(code))
      .map(([name]) => name);
    expect(withSqrt).toEqual(['path.ts']);
  });

  it('holds no module-level mutable state', () => {
    // `let` or `var` at the top level of a module is state two interleaved callers share.
    // A `PathFinder` is one instance per caller for exactly this reason, and a scratch buffer
    // hoisted to module scope would quietly undo that.
    for (const [name, code] of sources) {
      const mutable = /^(let|var)\s/m.exec(code);
      expect(mutable?.[0] ?? null, `${name} has module-level mutable state`).toBe(null);
    }
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
});

describe('I26: the allocation contract', () => {
  /**
   * Every exported function signature in the package, as `[file, name, params, returnType]`.
   *
   * A regex over `export function name(...): T {`, which is the only shape this package uses.
   * Reading the emitted `.d.ts` would be the RFC's letter, but it would make the suite depend
   * on a build having happened, and the property being checked is visible in the source that
   * produces the `.d.ts`.
   */
  function signatures(): [string, string, string, string][] {
    const out: [string, string, string, string][] = [];
    for (const [file, code] of sources) {
      for (const match of code.matchAll(
        /^export function ([A-Za-z0-9_$]+)\(([\s\S]*?)\):\s*([A-Za-z0-9_$<>[\]| ]+)\s*\{/gm,
      )) {
        out.push([file, match[1] as string, match[2] as string, (match[3] as string).trim()]);
      }
    }
    return out;
  }

  it('finds the exported functions it is about to check', () => {
    // A test that cannot fail is worse than no test: if the regex ever stops matching, this
    // whole block would silently pass over an empty list.
    const found = signatures();
    expect(found.length).toBeGreaterThanOrEqual(30);
    expect(found.map(([, name]) => name)).toContain('gridToWorld');
    expect(found.map(([, name]) => name)).toContain('pathSample');
  });

  /**
   * The two exported functions that build something, both at setup time.
   *
   * Named as a list rather than left as a habit: a constructor has to allocate or there would
   * be nothing to write into, and the honest form of the rule is "everything except the
   * things whose entire job is construction". A third name appearing here is a design change
   * and should read as one.
   */
  const FACTORIES = new Set(['createCamera', 'tileSourceOf']);

  it('returns a primitive, void, or a parameter it was given — never a fresh object', () => {
    // The rule `@latticekit/draw` cannot meet constitution rule 7 without. `{ x, y }` returned
    // sixty times a second times four hundred sprites is a garbage collector pause with a
    // pleasant API.
    const primitive = new Set(['number', 'boolean', 'void', 'string']);
    for (const [file, name, params, returns] of signatures()) {
      if (primitive.has(returns) || FACTORIES.has(name)) continue;
      // Otherwise the return type must be the declared type of one of the parameters — the
      // out-parameter form — which is what makes "the caller owns every object" checkable.
      const declared = params
        .split(',')
        .map((p) => p.split(':')[1]?.trim())
        .filter((t): t is string => t !== undefined);
      expect(
        declared.includes(returns),
        `${file}: ${name} returns ${returns}, which is not a parameter it was given`,
      ).toBe(true);
    }
  });

  it('has exactly the two factories it declares, and no more', () => {
    // If a third allocating export is ever added, the allowlist above has to grow and this
    // assertion is where the decision gets made rather than assumed.
    const declared = new Set(signatures().map(([, name]) => name));
    for (const factory of FACTORIES) expect(declared).toContain(factory);
    expect(FACTORIES.size).toBe(2);
  });
});

describe('I15: nothing on the per-frame path allocates', () => {
  /**
   * The body of a named function or method, brace-matched from its signature.
   *
   * **Why this is a source check and not a measurement.** The RFC asks for a heap delta, and a
   * heap delta cannot see this failure: the objects a leaking projection creates are dead the
   * instant they are made, so a scavenge collects them and `heapUsed` ends where it started. A
   * garbage-collection *count* survives that argument but not this environment — the observer
   * reports a few dozen collections for a loop that allocates nothing at all, because module
   * loading and the test runner are collecting too, and a threshold wide enough not to flake is
   * wide enough not to fail. Both instruments were tried before this one was written.
   *
   * What is left is precise and cannot flake: read the bodies of the functions a frame calls
   * and check that no allocating syntax appears in them. It catches the thing that actually
   * happens — somebody writes `const p = { x, y }` inside a projection — and it is checkable
   * by a reviewer with the same effort.
   */
  function bodyOf(code: string, qualified: string): string {
    // `anchor::name` starts the search after `anchor`. Without it the brace matcher finds the
    // *declaration* of a method — `Camera` declares every one of its methods in an interface
    // before `createCamera` implements them, and `TileSource` declares `get` before `TileGrid`
    // does — and then walks off into whatever block happened to come next. That is not a
    // hypothetical: this test passed a deliberately allocating `toScreenX` before the anchor
    // was added, which is precisely the failure mode the file's own header warns about.
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

  /** Drop `throw` statements: an error path allocates an `Error` by definition, and it ends
   *  the frame rather than running sixty times a second inside it. */
  function withoutThrows(body: string): string {
    return body.replace(/throw[\s\S]*?\);/g, '');
  }

  /**
   * Every function a frame calls, by module.
   *
   * The list is the point: it is what "the hot path" means for this package, written down
   * where a reviewer can disagree with it. A function that joins the frame and is not added
   * here is a gap, and a function that leaves it should be removed from the list in the same
   * commit.
   */
  const perFrame: Readonly<Record<string, readonly string[]>> = {
    'projection.ts': [
      'gridToWorldX',
      'gridToWorldY',
      'gridToWorld',
      'worldToGridX',
      'worldToGridY',
      'worldToGrid',
      'worldToTile',
      'depthOf',
      'tileDiamond',
      'footprintBounds',
      'rectSet',
      'rectContains',
      'rectIntersects',
      'rectUnion',
    ],
    'camera.ts': [
      'const camera: Camera = {::toScreenX',
      'const camera: Camera = {::toScreenY',
      'const camera: Camera = {::toScreen',
      'const camera: Camera = {::toWorldX',
      'const camera: Camera = {::toWorldY',
      'const camera: Camera = {::toWorld',
      'const camera: Camera = {::normalizedX',
      'const camera: Camera = {::panByScreen',
      'const camera: Camera = {::zoomAt',
      'const camera: Camera = {::isVisible',
      'const camera: Camera = {::visibleTileBounds',
      'const camera: Camera = {::visibleWorldBounds',
      'clampAxis',
      'reclamp',
      'gridToScreen',
    ],
    'depth.ts': ['add', 'addPoint', 'sort', 'indexAt', 'pickSorted'],
    'height.ts': ['heightAt', 'slopeAt'],
    'anchor.ts': ['anchorToScreen', 'anchorVisible', 'anchorPan'],
    'hittest.ts': ['screenToTile', 'surfaceGap', 'boxSilhouette', 'pointInPolygon', 'pointInTile'],
    'path.ts': ['pathSample', 'pathDirAt', 'dirCodeOf', 'octile', 'segmentWorst'],
    'heap.ts': ['push', 'pop', 'sortIndicesByKey'],
    'tilemap.ts': ['class TileGrid::get', 'class TileGrid::has'],
  };

  it('checks every function the list names, and the list is not empty', () => {
    // The guard against a regex that silently stops matching and turns the block below into a
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
    // 14 projection + 15 camera + 5 depth + 2 height + 3 anchor + 5 hittest + 5 path + 3 heap
    // + 2 tilemap. It was 56 when `tilemap` listed a second storage class's `get` and `has`
    // as well; that class was deleted by K22 and `docs/rfc/chunkgrid.md` says why. Recount
    // from the list above when you change it — do not fit the number to the failure.
    expect(checked).toBe(54);
  });

  it('contains no object literal, array literal, closure or `new` in any of them', () => {
    // `{ x, y }` returned sixty times a second times four hundred sprites is a garbage
    // collector pause with a pleasant API. So is a closure allocated per item per frame — the
    // source game pushed `{ depth, x0, x1, y0, y1, draw: () => … }` per sprite per frame and
    // it was the largest avoidable allocation in the whole renderer.
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

  it('confines allocation to the constructors, the growth paths and one documented function', () => {
    // Everything that does allocate, named. `pathSimplify` needs a list of the nodes to keep
    // and runs on a re-route rather than on a frame; the rest build buffers once and grow them
    // by doubling, so a sorter sized right never allocates again after its first frame.
    const allowed = new Set([
      'constructor',
      '#grow',
      '#growNodes',
      '#growIndex',
      'addGoal',
      '#emit',
      'push',
      'pathSimplify',
      'createCamera',
      'tileSourceOf',
      'makeStore',
      'set',
    ]);
    // Locate every `new Float64Array` / `new Int32Array` / `new Map` / object literal return
    // and check the enclosing declaration is one of those.
    for (const [file, code] of sources) {
      if (file === 'index.ts') continue;
      for (const match of code.matchAll(/\bnew (?:Float64Array|Int32Array|Uint8Array|Uint16Array|Uint32Array|Map|MinHeap)\b/g)) {
        const before = code.slice(0, match.index);
        // The nearest declaration above the site, skipping the control keywords that also
        // read as `name (` and would otherwise be reported as the owner.
        const control = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'expect']);
        const owners = [
          ...before.matchAll(/(?:^|\n)\s*(?:export )?(?:function |get |)([A-Za-z_$#][\w$]*)\s*\(/g),
        ]
          .map((m) => m[1] as string)
          .filter((n) => !control.has(n));
        // A class field initialiser runs in the constructor and belongs to it, but it has no
        // enclosing declaration for the scan above to find.
        const line = code.slice(before.lastIndexOf('\n') + 1).split('\n')[0] ?? '';
        const owner = /^ {2}(readonly )?[#A-Za-z_$][\w$]*(:[^=]*)? =/.test(line)
          ? 'constructor'
          : (owners[owners.length - 1] ?? '');
        expect(allowed.has(owner), `${file}: ${match[0]} inside ${owner}`).toBe(true);
      }
    }
  });
});
