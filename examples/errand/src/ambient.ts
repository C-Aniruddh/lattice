/**
 * @art — everything that moves and changes no number: rooks over the ridge, smoke from the
 * chimneys, chaff in the low sun, and the dotted line under the route you are walking.
 *
 * It has its own module precisely because it is mechanically inert. Delete it and the errand plays
 * out identically, in a valley where nothing happens that a player did not do — which is exactly
 * the failure `docs/GALLERY.md` rule 3 names: *"a static first frame reads as a screenshot of a game
 * rather than a game."* Something has to be moving before the visitor touches anything, and in this
 * exhibit that is four things, none of which is on the critical path of any of the five verbs.
 *
 * ## The route line is here, and it is a real decision
 *
 * A dotted line along the path the player is walking is the one piece of UI a point-and-click RPG
 * cannot do without, and it is *art*: it is `pathSample` read at twenty offsets and drawn, it holds
 * nothing, and the walk is identical without it. Putting it in the logic modules would have bought
 * the exhibit nothing and cost it eight of the two hundred lines it has.
 */
import { hash2, toUnit } from '@latticekit/core';
import { gridToScreen, pathSample, type GridPoint, type Path } from '@latticekit/iso';
import { LEVEL_H, mix, withAlpha, type Pen } from '@latticekit/draw';
import { WALL, type Valley } from './valley.js';

const pt = { x: 0, y: 0 };
const here: GridPoint = { gx: 0, gy: 0 };

/**
 * The remaining walk, as a line of fading dots.
 *
 * Sampled by **arc length**, not by node, which is the point: twenty evenly spaced dots along a
 * route whose nodes are anything but evenly spaced, from one call each and no per-dot state. It is
 * the same expression the walker's own position comes from, which is why the dots are exactly under
 * where they are about to be.
 */
export function drawRoute(pen: Pen, route: Path, from: number): void {
  const total = route.arcLength;
  if (total <= 0) return;
  const warn = pen.palette.get('warn');
  const k = pen.camera.zoom;
  for (let i = 1; i <= 20; i++) {
    const s = from + ((total - from) * i) / 20;
    if (s > total) break;
    pathSample(route, s, here);
    gridToScreen(pen.camera, here.gx, here.gy, 0, pt);
    const fade = 0.5 - (i / 20) * 0.34;
    pen.surface.ellipse(pt.x + pen.snapX, pt.y + pen.snapY, 3.4 * k, 1.7 * k, withAlpha(warn, fade));
  }
}

/**
 * Smoke, from the chimney of every house near enough to make out.
 *
 * Three puffs per chimney rising and spreading on a per-house phase, so a village of thirty has
 * thirty columns going at their own rates rather than one animation played thirty times. Drawn in
 * the overlay pass — above the solids, because smoke is in front of the roof it comes out of.
 */
export function drawSmoke(pen: Pen, valley: Valley): void {
  if (pen.camera.zoom < 0.5) return;
  const k = pen.camera.zoom, seed = valley.seed;
  const sky = pen.palette.get('sky');
  const range = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
  pen.camera.visibleTileBounds(range, 1);
  valley.kind.forEach(range, (gx, gy, kind) => {
    if (kind !== WALL || gx % 7 !== 2 || gy % 7 !== 2) return;
    gridToScreen(pen.camera, gx + 0.5, gy + 0.5, 3.2 * LEVEL_H, pt);
    if (pt.x < -40 || pt.x > pen.surface.width + 40) return;
    const phase = toUnit(hash2(seed ^ 0x9c, gx, gy));
    for (let i = 0; i < 3; i++) {
      const life = (pen.t * 0.24 + phase + i * 0.333) % 1;
      const r = (5 + life * 17) * k;
      pen.surface.ellipse(
        pt.x + pen.snapX + life * 22 * k,
        pt.y + pen.snapY - life * 44 * k,
        r, r * 0.62,
        withAlpha(mix(sky, 0xffffffff, 0.6), (1 - life) * 0.2),
      );
    }
  });
}

/**
 * Rooks. Six of them, circling above the ridge on one shared ellipse at six different phases, and
 * the only thing in the frame that is above the horizon.
 *
 * Screen space, not grid space. A bird is not standing on anything, so putting it through the depth
 * sorter would be asking a question that has no answer — and the whole flight is six pairs of
 * strokes with no allocation.
 */
export function drawRooks(pen: Pen, seed: number): void {
  const w = pen.surface.width;
  const h = pen.surface.height;
  const ink = withAlpha(pen.palette.get('ink'), 0.5);
  const xy = pen.xy;
  for (let i = 0; i < 6; i++) {
    const phase = (pen.t * 0.055 + toUnit(hash2(seed ^ 0x2b7, i, 3))) % 1;
    // A diamond orbit rather than a circle: exact arithmetic, and at this size a bird's path is a
    // shape nobody could pick out of a lineup anyway.
    const q = phase * 4;
    const s = q < 1 ? q : q < 3 ? 2 - q : q - 4;
    const c = q < 2 ? 1 - q : q - 3;
    const x = w * (0.5 + c * 0.42);
    const y = h * (0.1 + s * 0.06) + i * 9;
    // The wingbeat, as a triangle. Half the birds are gliding at any moment, which is what stops
    // six identical flaps reading as a loop.
    const beat = (pen.t * 3.1 + i * 0.37) % 1;
    const lift = (beat < 0.5 ? beat * 4 - 1 : 3 - beat * 4) * 3.2;
    xy[0] = x - 7; xy[1] = y + lift; xy[2] = x; xy[3] = y; xy[4] = x + 7; xy[5] = y + lift;
    pen.surface.stroke(xy, 3, false, ink, 1.6);
  }
}

/**
 * Chaff in the low sun: forty motes drifting across the lower half of the frame.
 *
 * Screen space and closed form — a mote's whole life is `hash2(i)` and `pen.t`, so there is no
 * particle system, no pool, and nothing to reset when the camera moves. It is the cheapest possible
 * proof that the air in front of the camera is air.
 */
export function drawChaff(pen: Pen): void {
  const w = pen.surface.width;
  const h = pen.surface.height;
  const warm = withAlpha(mix(pen.palette.get('warn'), 0xffffffff, 0.5), 0.32);
  for (let i = 0; i < 40; i++) {
    const speed = 0.35 + toUnit(hash2(0x6d, i, 1)) * 0.5;
    const x = (toUnit(hash2(0x6d, i, 2)) * 1.4 - 0.2 + pen.t * speed * 0.045) % 1;
    const drift = ((pen.t * speed * 0.09 + toUnit(hash2(0x6d, i, 3))) % 1) - 0.5;
    pen.surface.ellipse(x * w, h * (0.45 + toUnit(hash2(0x6d, i, 4)) * 0.5) + drift * 26, 1.7, 1.7, warm);
  }
}
