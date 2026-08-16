/**
 * The seven passes, and the two things about them that are not conventions.
 *
 * **The light composite is not a callback.** It happens between Placement and Overlay and there
 * is no way to move it, because a game that painted its own light pass would eventually put the
 * HUD underneath the darkness and the player could not read their own coin at midnight.
 *
 * **The order is not reordered.** `renderFrame` calls `sort` itself, immediately before the
 * Solids callback, so no window exists in which a caller holds a sorted order and improves it.
 * The last block here is the `draw` half of the contract `iso.pickSorted` holds the other end
 * of: paint forwards, pick backwards, and the two are the same permutation or the game is lying
 * about what the player tapped.
 */

import { DepthSorter, pickSorted } from '@lattice/iso';
import type { Camera, Rect, TileRange } from '@lattice/iso';
import { describe, expect, it } from 'vitest';
import { createLightField } from '../src/light.js';
import { Layer, PASS_NAMES, renderFrame } from '../src/layers.js';
import type { Passes } from '../src/layers.js';
import { screenText } from '../src/text.js';
import type { Pen } from '../src/surface.js';
import { opsOf, scene } from './harness.js';

/** A `Passes` object whose callbacks each leave a marker in the op log. */
function markers(names: readonly string[], pen: Pen): Passes {
  const mark = (name: string) => (): void => screenText(pen, 0, 0, name, 'ink');
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = mark(name);
  return out as Passes;
}

describe('Layer and PASS_NAMES', () => {
  it('are seven, in order, and agree with each other', () => {
    expect(PASS_NAMES).toEqual([
      'backdrop',
      'terrain',
      'solids',
      'placement',
      'light',
      'overlay',
      'effects',
    ]);
    expect(Object.values(Layer)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Layer.Light).toBe(4);
    expect(Layer.Overlay).toBe(5);
  });
});

describe('renderFrame', () => {
  it('runs the passes in order, with the light composite between placement and overlay', () => {
    const { surface, pen } = scene();
    const light = createLightField(surface);
    const framePen: Pen = { ...pen, light };
    light.begin(framePen, 0.6, 'night');
    surface.reset();

    const order = new DepthSorter(8);
    order.add(0, 0, 1, 1, 0);
    const passes: Passes = {
      ...markers(['backdrop', 'terrain', 'placement', 'overlay', 'effects'], framePen),
      solids: (): void => screenText(framePen, 0, 0, 'solids', 'ink'),
    };
    renderFrame(framePen, passes, order);

    const script = surface.ops
      .filter((op) => op.op === 'text' || op.op === 'blit')
      .map((op) => (op.op === 'blit' ? 'composite' : op.text));
    expect(script).toEqual([
      'backdrop',
      'terrain',
      'solids',
      'placement',
      'composite',
      'composite',
      'overlay',
      'effects',
    ]);
  });

  it('composites the light even though no callback asked for it', () => {
    const { surface, pen } = scene();
    const light = createLightField(surface, { bloom: 0 });
    const framePen: Pen = { ...pen, light };
    light.begin(framePen, 1, 'night');
    surface.reset();
    renderFrame(framePen, {});
    expect(opsOf(surface, 'blit')).toHaveLength(1);
  });

  it('costs nothing at all when the frame has no light', () => {
    const { surface, pen } = scene();
    renderFrame(pen, {});
    expect(surface.ops).toHaveLength(0);
  });

  it('sorts the order itself, immediately before the Solids callback', () => {
    // Sorting here rather than in the caller closes the window in which somebody holds a sorted
    // order and is tempted to improve it.
    const { pen } = scene();
    const order = new DepthSorter(8);
    order.add(2, 2, 1, 1, 0);
    order.add(0, 0, 1, 1, 0);
    order.add(40, 40, 1, 1, 0); // far off screen: culled inside `sort`, never offered
    let painted: number[] = [];
    renderFrame(
      pen,
      {
        solids: (_p, sorted): void => {
          painted = [];
          for (let i = 0; i < sorted.count; i++) painted.push(sorted.indexAt(i));
        },
      },
      order,
    );
    // Back to front: the item nearer the origin is behind the one further down the map.
    expect(painted).toEqual([1, 0]);
  });

  it('refuses a solids pass with no sorter rather than skipping it silently', () => {
    // A frame that drew terrain and nothing else reads as "the save did not load" and has no
    // other symptom.
    const { pen } = scene();
    expect(() => renderFrame(pen, { solids: (): void => undefined })).toThrow(RangeError);
    expect(() => renderFrame(pen, { solids: (): void => undefined })).toThrow(/DepthSorter/);
  });

  it('culls once per pass and only when the pass exists', () => {
    let world = 0;
    let tiles = 0;
    const { pen, camera } = scene();
    const counted: Camera = {
      ...camera,
      visibleWorldBounds: (out: Rect, margin?: number): Rect => {
        world += 1;
        return camera.visibleWorldBounds(out, margin);
      },
      visibleTileBounds: (out: TileRange, margin?: number): TileRange => {
        tiles += 1;
        return camera.visibleTileBounds(out, margin);
      },
    };
    const framePen: Pen = { ...pen, camera: counted };
    renderFrame(framePen, {});
    expect([world, tiles]).toEqual([0, 0]);
    renderFrame(framePen, {
      backdrop: (): void => undefined,
      terrain: (): void => undefined,
    });
    expect([world, tiles]).toEqual([1, 1]);
  });

  it('hands the backdrop a world box and the terrain a tile range', () => {
    const { pen } = scene({ width: 400, height: 300 });
    let box: Readonly<Rect> | undefined;
    let range: Readonly<TileRange> | undefined;
    renderFrame(pen, {
      backdrop: (_p, visible): void => void (box = visible),
      terrain: (_p, visible): void => void (range = visible),
    });
    expect(box?.maxX).toBe(200);
    expect(range?.gx1).toBeGreaterThan(range?.gx0 ?? 0);
  });

  it('nests, so a minimap rendered inside an overlay does not corrupt the outer frame', () => {
    const { pen } = scene();
    const inner = scene();
    let outerRange: Readonly<TileRange> | undefined;
    let seenDuringOverlay: Readonly<TileRange> | undefined;
    renderFrame(pen, {
      terrain: (_p, visible): void => {
        outerRange = visible;
      },
      overlay: (): void => {
        renderFrame(inner.pen, {
          terrain: (_p, visible): void => {
            seenDuringOverlay = visible;
          },
        });
      },
      effects: (): void => {
        // The outer frame's range object must still hold the outer frame's answer.
        expect(outerRange?.gx0).toBeDefined();
      },
    });
    expect(seenDuringOverlay).toBeDefined();
    expect(seenDuringOverlay).not.toBe(outerRange);
  });

  it('unwinds its depth when a pass throws', () => {
    const { pen } = scene();
    expect(() =>
      renderFrame(pen, {
        terrain: (): void => {
          throw new Error('pass failed');
        },
      }),
    ).toThrow('pass failed');
    let seen: Readonly<TileRange> | undefined;
    renderFrame(pen, { terrain: (_p, visible): void => void (seen = visible) });
    expect(seen).toBeDefined();
  });
});

describe('paint order and pick order are the same order', () => {
  it('a forward walk and pickSorted’s backward walk are exact reverses', () => {
    // The `draw` half of the contract. `iso.pickSorted` walks the same instance backwards, so a
    // re-sort, a partition or a second collection between the two makes the player tap a rack
    // and open the headquarters behind it — with both suites green.
    const { pen } = scene();
    const order = new DepthSorter(16);
    for (let i = 0; i < 8; i++) order.add(i, (i * 5) % 8, 1, 1, 0);

    const painted: number[] = [];
    renderFrame(
      pen,
      {
        solids: (_p, sorted): void => {
          for (let i = 0; i < sorted.count; i++) painted.push(sorted.indexAt(i));
        },
      },
      order,
    );

    const offered: number[] = [];
    pickSorted(order, (index) => {
      offered.push(index);
      return false;
    });
    expect(offered).toEqual([...painted].reverse());
  });

  it('and a partitioned walk is a different sequence, which is why it is forbidden', () => {
    // Two forward walks preserve the order; one partitioned walk destroys it while looking like
    // it preserved it. This asserts the difference is real rather than theoretical.
    const order = new DepthSorter(16);
    for (let i = 0; i < 8; i++) order.add(i, (i * 5) % 8, 1, 1, 0);
    order.sort();

    const forward: number[] = [];
    for (let i = 0; i < order.count; i++) forward.push(order.indexAt(i));

    const partitioned: number[] = [];
    for (let i = 0; i < order.count; i++) {
      if (order.indexAt(i) % 2 === 0) partitioned.push(order.indexAt(i));
    }
    for (let i = 0; i < order.count; i++) {
      if (order.indexAt(i) % 2 === 1) partitioned.push(order.indexAt(i));
    }
    expect(partitioned).not.toEqual(forward);

    // Two forward walks, on the other hand, leave the order untouched — which is why "shadows
    // first, bodies second" is written that way and not as one partitioned sweep.
    const twice: number[] = [];
    for (let i = 0; i < order.count; i++) twice.push(order.indexAt(i));
    for (let i = 0; i < order.count; i++) twice.push(order.indexAt(i));
    expect(twice.slice(0, order.count)).toEqual(forward);
    expect(twice.slice(order.count)).toEqual(forward);
  });
});
