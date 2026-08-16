/**
 * The palette — and the three failures it exists to make impossible.
 *
 * A recolour that never reaches a cache (`rev`), a dusk that invalidates one every frame
 * (quantisation), and a canvas whose blue disagrees with the HUD's at nightfall (one
 * interpolation, two renderings). All three are silent, all three are reported as something
 * else, and the last one is unnameable by the player who sees it.
 */

import { describe, expect, it } from 'vitest';
import { hexOf, rgba } from '../src/color.js';
import {
  BASE_SLOTS,
  DAY,
  DUSK,
  NIGHT,
  PALETTE_STEPS,
  createPalette,
  extendStops,
  lerpPalette,
  paletteVars,
} from '../src/palette.js';
import type { Stops } from '../src/palette.js';

describe('createPalette', () => {
  it('reads back what it was given, and copies rather than aliasing', () => {
    const slots: Record<string, number> = { sky: rgba(1, 2, 3) };
    const p = createPalette(slots);
    slots['sky'] = rgba(9, 9, 9);
    expect(p.get('sky')).toBe(rgba(1, 2, 3));
  });

  it('throws naming the slot and listing the known ones', () => {
    const p = createPalette(BASE_SLOTS);
    expect(() => p.get('brnd')).toThrow(RangeError);
    expect(() => p.get('brnd')).toThrow(/brnd/);
    expect(() => p.get('brnd')).toThrow(/brand/);
  });

  it('resolves an Ink: a number passes through, a string is a lookup', () => {
    const p = createPalette(BASE_SLOTS);
    expect(p.ink(0xff0000ff)).toBe(0xff0000ff);
    expect(p.ink('brand')).toBe(p.get('brand'));
    expect(() => p.ink('nope')).toThrow(/nope/);
  });

  it('normalizes a signed number to unsigned, so two spellings of red are one cache key', () => {
    const p = createPalette(BASE_SLOTS);
    expect(p.ink(-255)).toBe(0xffffff01);
    p.set('x', -1);
    expect(p.get('x')).toBe(0xffffffff);
  });

  it('has, keys and a stable key array until a slot is added', () => {
    const p = createPalette({ b: 1, a: 2 });
    expect(p.has('a')).toBe(true);
    expect(p.has('z')).toBe(false);
    expect(p.keys()).toEqual(['a', 'b']);
    const before = p.keys();
    p.set('a', 9);
    expect(p.keys()).toBe(before);
    p.set('z', 9);
    expect(p.keys()).toEqual(['a', 'b', 'z']);
  });

  it('bumps rev on every write — the field a cache keys on', () => {
    const p = createPalette(BASE_SLOTS);
    const before = p.rev;
    p.set('brand', rgba(1, 1, 1));
    expect(p.rev).toBe(before + 1);
    p.set('brand', rgba(1, 1, 1));
    expect(p.rev).toBe(before + 2);
  });
});

describe('Palette.lerp', () => {
  it('lands exactly on each stop set at the ends', () => {
    const p = createPalette(BASE_SLOTS);
    p.lerp(DAY, NIGHT, 0);
    for (const slot of p.keys()) expect(p.get(slot)).toBe(DAY[slot]);
    p.lerp(DAY, NIGHT, 1);
    for (const slot of p.keys()) expect(p.get(slot)).toBe(NIGHT[slot]);
  });

  it('clamps t rather than extrapolating past midnight', () => {
    const p = createPalette(BASE_SLOTS);
    p.lerp(DAY, NIGHT, 4);
    expect(p.get('sky')).toBe(NIGHT['sky']);
    p.lerp(DAY, NIGHT, -4);
    expect(p.get('sky')).toBe(DAY['sky']);
  });

  it('bumps rev at most PALETTE_STEPS times across a whole transition', () => {
    // A six-second dusk at 60 Hz. Bumping per frame would invalidate every cached sprite on
    // every frame of the prettiest moment in the game.
    const p = createPalette(BASE_SLOTS);
    const before = p.rev;
    for (let i = 0; i <= 360; i++) p.lerp(DAY, NIGHT, i / 360);
    expect(p.rev - before).toBeLessThanOrEqual(PALETTE_STEPS);
    expect(p.rev - before).toBeGreaterThan(1);
  });

  it('writes nothing and bumps nothing when the same step is asked for twice', () => {
    const p = createPalette(BASE_SLOTS);
    p.lerp(DAY, NIGHT, 0.5);
    const settled = p.rev;
    p.lerp(DAY, NIGHT, 0.5);
    p.lerp(DAY, NIGHT, 0.5001);
    expect(p.rev).toBe(settled);
  });

  it('notices when the stop sets change even though t has not', () => {
    const p = createPalette(BASE_SLOTS);
    p.lerp(DAY, NIGHT, 0.5);
    const settled = p.rev;
    p.lerp(DAY, DUSK, 0.5);
    expect(p.rev).toBe(settled + 1);
  });

  it('adds a slot the live palette did not have, and invalidates the key array', () => {
    const p = createPalette({ sky: 1 });
    p.lerp({ sky: 1, extra: 10 }, { sky: 2, extra: 20 }, 0);
    expect(p.keys()).toEqual(['extra', 'sky']);
    expect(p.get('extra')).toBe(10);
  });

  it('throws naming the first slot present in one stop set and not the other', () => {
    const p = createPalette(BASE_SLOTS);
    expect(() => p.lerp(DAY, { sky: 0 }, 0.5)).toThrow(RangeError);
    expect(() => p.lerp(DAY, { sky: 0 }, 0.5)).toThrow(/ground/);
    expect(() => p.lerp({ sky: 0 }, DAY, 0.5)).toThrow(/ground/);
  });
});

describe('the world and the HUD agree', () => {
  it('Palette.lerp and lerpPalette produce the same color for every slot at twenty values', () => {
    // Invariant 17. Two "obviously linear" blends drift because one of them quantised, and at
    // nightfall the mismatch is unmissable and unnameable.
    const p = createPalette(BASE_SLOTS);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      p.lerp(DAY, NIGHT, t);
      const vars = lerpPalette(DAY, NIGHT, t);
      for (const slot of p.keys()) expect(vars[slot]).toBe(hexOf(p.get(slot)));
    }
  });

  it('lerpPalette rejects a mismatched pair the same way', () => {
    expect(() => lerpPalette(DAY, { sky: 0 }, 0.5)).toThrow(/ground/);
    expect(() => lerpPalette({ sky: 0 }, DAY, 0.5)).toThrow(/ground/);
  });

  it('paletteVars renders the live palette, including slots a game added', () => {
    const p = createPalette(BASE_SLOTS);
    p.set('mine', rgba(1, 2, 3));
    expect(paletteVars(p)['mine']).toBe('#010203');
    expect(paletteVars(p)['brand']).toBe(hexOf(p.get('brand')));
  });
});

describe('the reference stop sets', () => {
  it('define exactly the same slots, so any pair may be crossfaded', () => {
    const keysOf = (s: Stops): string[] => Object.keys(s).sort();
    expect(keysOf(DUSK)).toEqual(keysOf(DAY));
    expect(keysOf(NIGHT)).toEqual(keysOf(DAY));
    expect(keysOf(BASE_SLOTS)).toEqual(keysOf(DAY));
  });

  it('cover the ten slots the kit itself draws with', () => {
    expect(Object.keys(BASE_SLOTS).sort()).toEqual([
      'bad',
      'brand',
      'glass',
      'ground',
      'ink',
      'metal',
      'night',
      'ok',
      'sky',
      'warn',
    ]);
  });

  it('are frozen, so a game cannot recolour the reference by accident', () => {
    expect(Object.isFrozen(DAY)).toBe(true);
    expect(Object.isFrozen(NIGHT)).toBe(true);
  });

  it('keeps the HUD slots legible at midnight — the darkness is the light field, not the palette', () => {
    for (const slot of ['warn', 'ok', 'bad']) {
      const day = DAY[slot] ?? 0;
      const night = NIGHT[slot] ?? 0;
      const brightness = (c: number): number =>
        ((c >>> 24) & 255) + ((c >>> 16) & 255) + ((c >>> 8) & 255);
      expect(brightness(night)).toBeGreaterThan(brightness(day) * 0.6);
    }
  });
});

describe('extendStops — a game slot that rolls with the rest', () => {
  it('adds a slot to a frozen stop set without touching it', () => {
    const extended = extendStops(DAY, { sand: rgba(232, 217, 168) });
    expect(extended['sand']).toBe(rgba(232, 217, 168));
    expect(extended['sky']).toBe(DAY['sky']);
    expect(Object.keys(DAY)).not.toContain('sand');
    expect(Object.isFrozen(extended)).toBe(true);
  });

  it('satisfies the same-slots rule, which is the whole point of it', () => {
    // `Palette.lerp` requires both stop sets to define exactly the same slots, and that rule is
    // right — a half-defined night palette is how one thing stays gold at midnight, silently.
    // Before this function there was no way to satisfy it *and* add a slot to the kit's own
    // frozen sets, so the exhibit's sand lived outside the palette and did not roll at dusk.
    const day = extendStops(DAY, { sand: rgba(232, 217, 168) });
    const night = extendStops(NIGHT, { sand: rgba(93, 100, 120) });
    const p = createPalette(day);
    expect(() => p.lerp(day, NIGHT, 0.5)).toThrow(/slot 'sand' is in one stop set and not the other/);
    p.lerp(day, night, 1);
    expect(p.get('sand')).toBe(rgba(93, 100, 120));
    p.lerp(day, night, 0);
    expect(p.get('sand')).toBe(rgba(232, 217, 168));
  });

  it('brings a slot the palette had never heard of into it, mid-transition', () => {
    // A game that started from the kit's defaults and adds its own color later: the slot arrives
    // through the lerp, `keys()` notices, and `get` stops throwing.
    const p = createPalette(BASE_SLOTS);
    expect(() => p.get('sand')).toThrow(RangeError);
    const day = extendStops(DAY, { sand: rgba(200, 180, 120) });
    const dusk = extendStops(DUSK, { sand: rgba(100, 90, 60) });
    p.lerp(dusk, day, 1);
    expect(p.get('sand')).toBe(rgba(200, 180, 120));
    expect(p.keys()).toContain('sand');
  });

  it('lets extra replace a base slot, because a biome recolouring ground is legitimate', () => {
    const extended = extendStops(DAY, { ground: rgba(1, 2, 3) });
    expect(extended['ground']).toBe(rgba(1, 2, 3));
    expect(Object.keys(extended)).toHaveLength(Object.keys(DAY).length);
  });

  it('normalises to an unsigned 32-bit color like every other entry point', () => {
    const extended = extendStops({ a: 0 }, { b: -1 });
    expect(extended['b']).toBe(0xffffffff);
  });

  it('hoisted once, a transition writes nothing and bumps nothing on a frame that repeats it', () => {
    // The trap worth stating: `Palette.lerp` compares its stop sets by identity, so a set
    // rebuilt inside the render callback is a new object every frame — every frame then bumps
    // `rev`, and `rev` is what every cache in the kit keys on. The symptom is not a wrong color;
    // it is a game that gets slower at dusk and stays slow.
    const day = extendStops(DAY, { sand: rgba(9, 9, 9) });
    const night = extendStops(NIGHT, { sand: rgba(1, 1, 1) });
    const p = createPalette(day);
    p.lerp(day, night, 0.5);
    const settled = p.rev;
    p.lerp(day, night, 0.5);
    expect(p.rev).toBe(settled);
    // …and the same colors through a set rebuilt per call do bump it, every time.
    p.lerp(extendStops(DAY, { sand: rgba(9, 9, 9) }), extendStops(NIGHT, { sand: rgba(1, 1, 1) }), 0.5);
    p.lerp(extendStops(DAY, { sand: rgba(9, 9, 9) }), extendStops(NIGHT, { sand: rgba(1, 1, 1) }), 0.5);
    expect(p.rev).toBe(settled + 2);
  });

  it('reaches the DOM seam too, so the HUD’s sand is the world’s sand', () => {
    const day = extendStops(DAY, { sand: rgba(232, 217, 168) });
    const night = extendStops(NIGHT, { sand: rgba(93, 100, 120) });
    const vars = lerpPalette(day, night, 0);
    expect(vars['sand']).toBe(hexOf(rgba(232, 217, 168)));
    const p = createPalette(day);
    p.lerp(day, night, 0.5);
    expect(paletteVars(p)['sand']).toBe(lerpPalette(day, night, 0.5)['sand']);
  });
});
