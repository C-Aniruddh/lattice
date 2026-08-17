/**
 * Everything alive in the dark that changes no number: fire, dust, and the glow-worms on the roof.
 *
 * @art
 *
 * It has its own module precisely *because* it is mechanically inert. In a world where only the
 * things that matter move, an eye learns that motion means something is happening, and a cave
 * reads as a diagram with lamps on it. A drop of water crossing a torch beam while nothing else
 * happens is what turns it back into a place.
 *
 * Everything here is closed form in `pen.t` and a hash of the tile it stands on, so it costs no
 * state, allocates nothing, and is identical on every reload of the same seed.
 *
 * ## The glow-worms are the answer to § Scale's fill row
 *
 * `docs/GALLERY.md` says no more than a third of the opening frame may be empty background, and
 * unlit rock is this exhibit's subject rather than its background — but *flat* unlit rock is
 * background in a darker costume. Something has to put texture into the far dark without lighting
 * it.
 *
 * That something is two hundred-odd glow-worms on the roof, each posting a pool of a **fiftieth**
 * of a torch's intensity over a couple of tiles. Individually none of them lights anything: you
 * cannot read the floor by one and you cannot tell what is under it. Together they carve a faint,
 * uneven relief out of the darkness across the whole frame, so the dark has depth and silhouette
 * in it and the eye can tell there is a cave out there. It is the exhibit's own subject used on
 * itself, which is the only honest way to solve it in a scene whose premise is that you cannot
 * see.
 *
 * They are placed by hashing the **visible tile range** rather than from a stored list, which is
 * what bounds their number by the viewport instead of by the map: a 128×128 cave with a stored
 * worm field would post ten thousand pools, of which forty are on screen.
 */
import { hash2, noise2, toUnit } from '@latticekit/core';
import { gridToScreen, type TileRange } from '@latticekit/iso';
import { LEVEL_H, mix, withAlpha, type LightField, type Pen } from '@latticekit/draw';
import { STEP_PX, type Cavern, type Flame } from './cavern.js';

/** Scratch, module scope. Nothing here is re-entrant and nothing retains either of them. */
const pt = { x: 0, y: 0 };
const range: TileRange = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };

/** How far above the floor the roof is, in world pixels. Six storeys: high enough that a
 *  glow-worm is clearly not standing on the floor, low enough that its pool still reads as
 *  belonging to the patch of ground under it. */
const ROOF = LEVEL_H * 6;

/** Project a world point and apply the frame's pixel snap. Every population needs it. */
function screen(pen: Pen, gx: number, gy: number, zPx: number): { x: number; y: number } {
  gridToScreen(pen.camera, gx, gy, zPx, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * A flame's brightness, 0.78 to 1, as two sine terms whose periods do not divide.
 *
 * One expression, used by both halves of a flame — the pool's intensity and the fire's height —
 * so that a fire can never get brighter as it gets shorter, which is what two copies of a gutter
 * produce the first time either is tuned.
 */
export function gutter(t: number, phase: number): number {
  /* @tier-b pixels only */
  return 0.89 + Math.sin(t * 7.1 + phase) * 0.06 + Math.sin(t * 2.7 + phase * 2.3) * 0.05;
}

/**
 * Snap a 0–1 brightness factor to nine levels **before it becomes a color**.
 *
 * ## The trap this exists for
 *
 * `Surface.softEllipse` is the only primitive that reaches `canvas2d.ts`'s ramp cache, and that
 * cache is keyed on the **exact** `(inner, outer)` `Rgba` pair with no quantization. A color that
 * moves continuously therefore misses every frame, and a miss allocates a `<canvas>`, a context,
 * a gradient and a fill. Worse, eviction is wholesale — `if (ramps.size >= RAMP_LIMIT)
 * ramps.clear()` at 96 entries — so an exhibit that generates more than 96 distinct colors per
 * frame destroys *every other* entry as collateral, and five hundred formations' constant-color
 * contact shadows become misses too.
 *
 * Measured in this exhibit before the fix, by wrapping `createRadialGradient` (which is reached
 * only on a miss): **4.3 misses per frame with the braziers alone, and 15.9 with every torch
 * lit** — a full cache drop about every six frames, and a canvas allocation rate that scales with
 * the light count. `crowd` found the same thing independently at 3.74 per frame.
 *
 * ## What is snapped and what is not
 *
 * **Only the number that becomes an alpha byte.** Every call site here keeps its radius, its
 * position, its sway, its height and its timing continuous, and snaps only the factor that is
 * about to be multiplied into a color. A flame's pool still breathes, because the *radius* is
 * still `reach * g`; what steps is a brightness nobody resolves at nine levels on a soft radial
 * ramp. `Surface.ellipse` never touches the cache, so every hot core, spark and mote in this
 * module stays on the raw value.
 *
 * With nine levels the whole exhibit holds about forty distinct ramp keys at any light count,
 * against a limit of 96 — so the cache reaches a steady state and never clears.
 *
 * **This is a workaround in an exhibit, not a fix in the kit**, and it becomes redundant the day
 * `rampFor` quantizes its own key and evicts per entry. Delete it then; the call sites lose a
 * function call and nothing else.
 */
export function snap(v: number): number {
  return Math.round(v * 8) / 8;
}

/**
 * **The exhibit's one idea, as four numbers.** A light is *two* pools, not one.
 *
 * A single `add` is a linear ramp from the center to the rim: bright in the middle, gone at the
 * edge, and — because it is linear — with a visible constant slope all the way out that the eye
 * reads as the *size of the lamp* rather than as the reach of its light. Nesting a hot narrow
 * core inside a wide weak halo and letting the accumulator's per-channel `max` union them gives a
 * compound curve that is steep in the middle and very flat at the edge, which is what a real
 * falloff looks like and what makes a pool end in darkness rather than at a circle.
 *
 * It is also the whole answer to "pools that meet without a bright seam". Two of these side by
 * side meet in each other's *halo*, where both curves are almost flat and both intensities are
 * about a third — so the union is barely brighter than either and has no edge anywhere in it. Two
 * single-pool lights meet in each other's ramp, where the slope is the same everywhere, and the
 * union has a visible crease along the line equidistant from them.
 *
 * **Neither call passes a `falloff`.** The per-call override exists and using it here would make
 * the panel's `pool edge` slider do nothing in the one exhibit built to demonstrate what it does.
 * These read the field's default, which is what keeps that slider live.
 *
 * `zPx` is the **ground under the flame**, not the height of the wick: the field pools light on
 * the floor, so a torch on a shelf lights the shelf.
 */
export function pool(field: LightField, gx: number, gy: number, zPx: number, g: number, reach: number, power: number): void {
  // The radius rides the raw gutter and the intensity rides the snapped one — see {@link snap}.
  // The pool still breathes; what it no longer does is invent a new color every frame.
  const q = snap(g) * power;
  field.add(gx, gy, zPx, reach * 0.3 * g, q, 'warn');
  field.add(gx, gy, zPx, reach * g, q * 0.32, 'ember');
}

/** The lantern's own light. The brightest and widest thing in the cave, because it is the one the
 *  visitor is steering and everything else is what it finds. */
export function lanternLight(pen: Pen, gx: number, gy: number, zPx: number): void {
  const field = pen.light;
  if (field !== undefined) pool(field, gx, gy, zPx, gutter(pen.t, 0.6), 10.5, 1);
}

/**
 * The fire itself: three stacked ellipses that shrink and lean on the gutter.
 *
 * Drawn in the Solids pass with the fixture it belongs to, so a column in front of a torch hides
 * the fire as well as the wood. The core is the hottest pixel in the exhibit and it is *tiny* —
 * a flame that is large and bright reads as a sprite, and a flame that is small and bright with a
 * huge soft pool under it reads as light.
 */
export function flame(pen: Pen, f: Flame): void {
  const g = gutter(pen.t, f.phase);
  const lift = f.big ? 0.56 : 0.61;
  const size = (f.big ? 1.5 : 1) * pen.camera.zoom;
  const p = screen(pen, f.gx + 0.5, f.gy + 0.5, f.base + lift * LEVEL_H);
  const warm = pen.palette.get('warn');
  const hot = mix(pen.palette.get('flame'), 0xffffffff, 0.45);
  const sway = Math.sin(pen.t * 5.3 + f.phase * 3.1) * 1.6 * size; /* @tier-b pixels only */
  pen.surface.softEllipse(p.x, p.y - 2 * size, 11 * size, 13 * size, withAlpha(warm, 0.4 * snap(g)), withAlpha(warm, 0));
  pen.surface.ellipse(p.x + sway * 0.4, p.y - 4 * size * g, 2.6 * size, 4.6 * size * g, withAlpha(pen.palette.get('ember'), 0.85));
  pen.surface.ellipse(p.x + sway * 0.2, p.y - 3 * size * g, 1.4 * size, 2.4 * size * g, withAlpha(hot, 0.95));
}

/**
 * The lantern the visitor carries: a hoop, a bright bead, and the halo it wears.
 *
 * Drawn in the Placement pass, above every solid, and that is the one deliberate break with depth
 * in the exhibit — you are holding it, so it is in front of the cave rather than in it.
 */
export function drawLantern(pen: Pen, gx: number, gy: number, zPx: number): void {
  const g = gutter(pen.t, 0.6);
  const k = pen.camera.zoom;
  const p = screen(pen, gx, gy, zPx + LEVEL_H * 1.05);
  const warm = pen.palette.get('warn');
  const hot = mix(pen.palette.get('flame'), 0xffffffff, 0.6);
  pen.surface.softEllipse(p.x, p.y, 26 * k, 26 * k, withAlpha(warm, 0.34 * snap(g)), withAlpha(warm, 0));
  // The frame: a cage of two arcs, drawn as strokes so it stays one device pixel at every zoom.
  pen.xy[0] = p.x - 5 * k;
  pen.xy[1] = p.y - 9 * k;
  pen.xy[2] = p.x - 7 * k;
  pen.xy[3] = p.y + 2 * k;
  pen.xy[4] = p.x + 7 * k;
  pen.xy[5] = p.y + 2 * k;
  pen.xy[6] = p.x + 5 * k;
  pen.xy[7] = p.y - 9 * k;
  pen.surface.stroke(pen.xy, 4, true, withAlpha(pen.palette.get('metal'), 0.95), Math.max(1, 1.4 * k));
  pen.surface.ellipse(p.x, p.y - 2 * k, 3.4 * k * g, 5 * k * g, withAlpha(pen.palette.get('ember'), 0.9));
  pen.surface.ellipse(p.x, p.y - 2 * k, 1.8 * k * g, 2.8 * k * g, withAlpha(hot, 1));
  // The hand that is holding it, as a shadow on the floor. Without it the lantern floats.
  const foot = screen(pen, gx, gy, zPx);
  pen.surface.softEllipse(foot.x, foot.y, 15 * k, 7 * k, withAlpha(pen.palette.get('ink'), 0.45), withAlpha(pen.palette.get('ink'), 0));
}

/**
 * Glow-worms on the roof and dust in the air, over exactly the tiles that are on screen.
 *
 * One walk of the visible range serves both, with different strides and different gates, because
 * a second walk would double the only per-tile cost in the pass — `open.get`, which is a bounds
 * check and an array read.
 */
export function drawAmbient(pen: Pen, cave: Cavern): void {
  const visible = pen.camera.visibleTileBounds(range, 0);
  const s = pen.surface;
  const k = pen.camera.zoom;
  const cold = pen.palette.get('worm');
  const dust = pen.palette.get('flow');
  // Stride three and a gate, so the population is bounded by the *viewport* and not by the map:
  // a stored worm field over a 128×128 cave would post ten thousand pools of which forty are on
  // screen, and § Scale's cost row is a gate rather than a trade.
  for (let gy = visible.gy0; gy <= visible.gy1; gy += 3) {
    for (let gx = visible.gx0; gx <= visible.gx1; gx += 3) {
      if (cave.open.get(gx, gy) !== 1) continue;
      const base = cave.field.heights.get(gx, gy) * STEP_PX;
      const h = toUnit(hash2(cave.seed ^ 0x11, gx, gy));
      if (h > 0.58) {
        const wx = gx + (h * 7) % 1;
        const wy = gy + (h * 13) % 1;
        // Breathing out of phase with its neighbours, and never fully out: a colony that blinked
        // would read as a hundred little UI elements rather than as one faint field.
        const beat = 0.55 + noise2(cave.seed ^ 0x77, gx * 0.7 + gy, pen.t * 0.26) * 0.45;
        // The speck is an `ellipse` and never reaches the ramp cache, so it keeps the raw beat.
        // The halo and the pool are both built from the snapped one — see {@link snap}.
        const q = snap(beat);
        const p = screen(pen, wx, wy, base + ROOF);
        s.ellipse(p.x, p.y, 1.3 * k, 1.3 * k, withAlpha(mix(cold, 0xffffffff, 0.4), beat * 0.9));
        s.softEllipse(p.x, p.y, 7 * k, 7 * k, withAlpha(cold, q * 0.22), withAlpha(cold, 0));
        // A fiftieth of a torch. This is the line the § Scale fill row rests on — see the header.
        pen.light?.add(wx, wy, base, 2.4, q * 0.055, 'worm');
      }
      if (h < 0.34) {
        // Dust turning slowly in whatever light finds it. Drawn under the mask, so a mote out in
        // the dark is invisible and the same mote inside a pool is not — which is the exhibit's
        // whole idea, playing out on the smallest object in it.
        const mx = gx + 0.5 + noise2(cave.seed ^ 0x21, gx + gy * 3, pen.t * 0.11) * 1.6;
        const my = gy + 0.5 + noise2(cave.seed ^ 0x22, gx * 3 + gy, pen.t * 0.1) * 1.6;
        const z = base + 8 + ((pen.t * 5 + h * 90) % 60);
        const p = screen(pen, mx, my, z);
        s.ellipse(p.x, p.y, 1.2 * k, 1.2 * k, withAlpha(dust, 0.4));
      }
    }
  }
}
