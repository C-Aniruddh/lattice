/**
 * The buildings. Twelve silhouettes, three scales of detail, and the window rhythm that carries
 * the whole look.
 *
 * @art
 *
 * Everything in this file follows the same six rules, and none of them is a preference.
 *
 * 1. **Setback massing.** A tower is a plinth, a body, a smaller storey set back from the edge
 *    below it, and furniture on the roof. Three stages minimum on anything tall, four on anything
 *    meant to be looked at. A single box is what generated geometry looks like, and no amount of
 *    color fixes it.
 * 2. **A rhythm of warm windows on a dark face.** Evenly spaced, most lit, a few dark, in two
 *    temperatures — {@link WARM} for a home and {@link COOL} for an office floor. It is one loop
 *    ({@link ribbon}) and it does more than everything else in this file combined.
 * 3. **Silhouette first.** Every definition below differs from every other in *outline* at 40 px,
 *    before any detail: stepped, brimmed, round, forked, skeletal, flat-with-a-tank, low-with-a-
 *    stack, pitched, needle-thin. Two buildings with the same outline and different colors read
 *    as one building with a skin, and that is the failure mode a seeded generator falls into on
 *    its own.
 * 4. **Detail at three scales** — massing, then panel and window rhythm, then trim, glints and
 *    small lights. Skipping the middle is what makes generated geometry look fake; uniform detail
 *    at one scale reads as noise.
 * 5. **Thin details that break the silhouette**: masts, aerials, water tanks on legs, dishes,
 *    fire escapes, guy wires, a crane's jib, cables between roofs. They are what make a shape read
 *    as *engineered* rather than extruded, and they cost one stroke each.
 * 6. **Cool shadows, warm highlights, from one color.** Every face here is derived by `draw`'s
 *    `shade` from a single slot. Three colors chosen by hand for three faces is how a palette
 *    stops being able to move — and this exhibit's palette moves through a whole hour.
 *
 * Two mechanical notes that are easy to get wrong:
 *
 * - **A massing may not read a slot the kit's `BASE_SLOTS` does not have.** `spriteHeightPx` and
 *   `spriteVolume` replay the massing against the kit's default palette with no frame, so a
 *   `w.palette.get('neon')` in here throws inside a measuring replay and nowhere else. Slot
 *   *names* are safe — the measuring writer never resolves an ink — so the rule is simply: pass
 *   `Ink`, never resolve one.
 * - **An animator is not told where the ground is except through `zPx`.** Convert once with
 *   `pxToLevels` and add it to every storey height, exactly as the massing's are already offset,
 *   or the beacon blinks at street level while its mast is fourteen floors up.
 */
import { hash2, noise2, toUnit, type Vec2 } from '@latticekit/core';
import { gridToScreen } from '@latticekit/iso';
import {
  FLAG_POWERED,
  LEVEL_H,
  defineSprite,
  glowDot,
  isoBox,
  mix,
  pxToLevels,
  withAlpha,
  type Ink,
  type Pen,
  type SolidWriter,
  type Variant,
} from '@latticekit/draw';
import { steam } from './ambient.js';
import { snap } from './palette.js';

/**
 * **Where the light in this city is, and where it is not.**
 *
 * A building has no `emit` until a visitor wakes it. That is the largest single change to how the
 * exhibit looks, and it is two rules meeting:
 *
 * - *Aesthetic.* A pool under every tower plus a pool under every lamp is a hundred overlapping
 *   discs, and a hundred overlapping discs is not a lit city — it is one flat sheet of warm ground
 *   with no edge anywhere. Light reads as light when it is scarce and it falls off. The only ground
 *   pools left are the ones a street actually has: lamps, headlights, a kiosk counter, a vent.
 * - *Mechanical.* `draw`'s light field is not occluded, by its own account the largest honest
 *   limitation in the package. A pool sits in the ground plane and composites in screen space, so
 *   a pool under a tower is also a pale ellipse on the roof of whatever stands in front of it. The
 *   towers were the worst offenders because they are the tall things the pools land on.
 *
 * What a tower is lit by instead is **its own windows**, which are solids and are therefore sorted,
 * occluded and correct — and which is the premise the exhibit is named for. Tapping one turns the
 * pool on at four tiles and full intensity, and it lands because everything around it is dark.
 */

/** A window with somebody home. */
const WARM: Ink = 'warn';
/** A window with a ceiling grid and nobody in it. Two temperatures is what stops a face reading
 *  as one repeated sticker. */
const COOL: Ink = 'lamp';
/** Building bodies. Dark, so the windows are the brightest thing on the face by a mile. */
const BODY: Ink = 'ink';
/** Concrete: plinths, cornices, roof furniture. */
const CONCRETE: Ink = 'metal';

const pt: Vec2 = { x: 0, y: 0 };

/**
 * How much of itself a massing draws, from the camera's zoom. **Set once per frame, read by every
 * massing in this file.**
 *
 * § Scale's cost row asks for the detail to be spent where the eye is, and in a dimetric
 * projection there is no perspective to hide behind: every building is the same size on screen and
 * the only thing that changes what a viewer can resolve is the zoom. At the opening zoom a water
 * tank's four legs are three pixels of grey inside a shape that is already grey, and a parapet's
 * four walls are one line — so both are drawn as one primitive instead of nine, and the *rhythm of
 * windows* keeps its full budget at every tier, because that is what the exhibit is for.
 *
 * A module variable rather than a parameter because `SolidWriter` deliberately has no camera:
 * `spriteHeightPx` replays a massing with no frame at all, and it must be able to. The default is
 * the finest tier so that a build-time replay measures the *tallest* form a sprite can take, which
 * keeps the cached `hPx` a valid upper bound for the cull at every tier below it.
 */
let detail = 2;

/** The two thresholds. Between them is the opening frame; above is a visitor who has zoomed in and
 *  is looking at one building, which is exactly when the roof furniture earns its cost. */
export function setDetail(zoom: number): void {
  detail = zoom >= 1.9 ? 2 : zoom >= 0.95 ? 1 : 0;
}

/** The screen point for a grid position at a storey height — the one conversion an animator needs. */
export function at(pen: Pen, gx: number, gy: number, levels: number): Vec2 {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * A contact shadow, at the tiers where there is any ground to put it on.
 *
 * **A shadow is bigger than the thing that casts it, and a depth sorter only promises the order of
 * the *footprints*.** So a soft ellipse drawn 0.18 tiles outside a tower's own base spills across
 * the boundary onto whatever was painted before it — which, in a grid this dense, is the roof of
 * the building behind. The result is a flat grey disc lying on a roof fourteen storeys up, and it
 * is the second most obvious tell in the frame after a car in the void.
 *
 * At the opening zoom the ground it would land on is about a twentieth of the picture and the cure
 * costs nothing. Pull in past the finest threshold and there is ground worth grounding things on,
 * and the shadows come back.
 */
function contact(w: SolidWriter, x: number, y: number, ww: number, dd: number, alpha: number): void {
  if (detail < 2) return;
  // Inset to a little over half the footprint, for two reasons that happen to want the same
  // number. A soft ellipse costs its **area**, and a shadow is the largest one any building draws:
  // at the closest zoom the full-footprint version measured about 5 ms of the frame all by itself,
  // and 0.56 of the width is 0.31 of that. It also stops the ellipse crossing the footprint
  // boundary the depth sorter is the only thing ordering, which is what used to lay a grey disc
  // across the roof of the building behind.
  w.shadow(x + ww * 0.22, y + dd * 0.22, ww * 0.56, dd * 0.56, alpha);
}

/**
 * A cable, a guy wire, a hoist rope, a washing line.
 *
 * Two projections and one stroke. These are rule 5 in its cheapest form: the thing that makes a
 * mast read as a mast rather than as a stick is the two wires going down from it.
 */
function wire(
  pen: Pen,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  ink: Ink,
  alpha: number,
  width = 1,
): void {
  const a = at(pen, ax, ay, az);
  pen.xy[0] = a.x;
  pen.xy[1] = a.y;
  const b = at(pen, bx, by, bz);
  pen.xy[2] = b.x;
  pen.xy[3] = b.y;
  pen.surface.stroke(pen.xy, 2, false, withAlpha(pen.palette.ink(ink), alpha), Math.max(0.8, width * pen.camera.zoom));
}

/**
 * An aircraft warning light. Off most of the second, and that is the point: a light that is
 * always on is a dot, and a light that blinks is a building tall enough to need one.
 */
function beacon(pen: Pen, gx: number, gy: number, levels: number, phase: number, ink: Ink = 'bad', size = 0.13): void {
  const k = (pen.t * 0.55 + phase) % 1;
  if (k > 0.26) return;
  const swell = Math.sin((k / 0.26) * Math.PI); /* @tier-b pixels only */
  glowDot(pen, gx, gy, levels, ink, size * (0.6 + swell * 0.7), snap(0.5 + swell * 0.5));
}

/**
 * **The exhibit.** A rhythm of lit and dark windows along one vertical face.
 *
 * One dark ribbon per floor, then only the *lit* panes on top of it — so a dark window costs
 * nothing at all and a face of forty windows is forty-eight quads rather than eighty. `all`
 * is what a tapped building sets: every pane on, which is a whole tower waking up at once.
 *
 * The lit test is `hash2` of the building's own seed with the column and the row, so the pattern
 * belongs to *that* building and survives a reload, a re-sort and a camera move. Anything keyed
 * on draw order shimmers, and a shimmering skyline is the tell of a generator.
 */
function ribbon(
  w: SolidWriter,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z0: number,
  rows: number,
  cols: number,
  seed: number,
  all: boolean,
  tone: Ink,
  pitch = 1,
): void {
  const other: Ink = tone === WARM ? COOL : WARM;
  // The one place the tiers touch the window rhythm, and only at the tier a visitor reaches by
  // pulling all the way out: two floors per band, so a forty-storey face is twenty bands of taller
  // glass rather than forty of the same total area. Nothing else in this file trades the rhythm.
  if (detail < 1 && rows > 5) { rows = Math.ceil(rows / 2); pitch *= 2; }
  for (let r = 0; r < rows; r++) {
    const zb = z0 + r * pitch;
    const lo = zb + 0.24 * pitch;
    const hi = zb + 0.76 * pitch;
    w.wall(ax, ay, bx, by, lo, hi, 'glass');
    for (let c = 0; c < cols; c++) {
      // **46% lit, not 64%.** A face where most panes are on is a face with no rhythm in it —
      // the eye reads the dark ones as the pattern, and there were not enough of them. It is also
      // the single largest primitive count in the exhibit, so the number that makes the art right
      // is the same number that makes the frame affordable, which is how a budget is supposed to
      // feel. `all` is the tapped state and is deliberately the opposite extreme.
      if (toUnit(hash2(seed, c, r)) < (all ? 0.02 : 0.54)) continue;
      const k = (c + 0.5) / cols;
      const half = 0.33 / cols;
      const x = ax + (bx - ax) * k;
      const y = ay + (by - ay) * k;
      const dx = (bx - ax) * half;
      const dy = (by - ay) * half;
      w.wall(x - dx, y - dy, x + dx, y + dy, lo + 0.03, hi - 0.03, toUnit(hash2(seed ^ 0x3f, c, r)) < 0.2 ? other : tone);
    }
  }
}

/** {@link ribbon} on both faces a viewer can see — the far-x face and the far-y face. */
function glazing(
  w: SolidWriter,
  x: number,
  y: number,
  ww: number,
  dd: number,
  z0: number,
  rows: number,
  cols: number,
  seed: number,
  all: boolean,
  tone: Ink,
  pitch = 1,
): void {
  const fx = x + ww;
  const fy = y + dd;
  ribbon(w, x + 0.08, fy, fx - 0.08, fy, z0, rows, cols, seed, all, tone, pitch);
  ribbon(w, fx, fy - 0.08, fx, y + 0.08, z0, rows, Math.max(1, Math.round((cols * dd) / ww)), seed ^ 0x51, all, tone, pitch);
}

/**
 * Punched windows: a hole in a wall with a sill, rather than a ribbon of glass.
 *
 * The whole difference between a nineteenth-century walkup and an office tower is here, and it is
 * why residential and commercial in this city are told apart at a glance instead of by color.
 */
function punched(
  w: SolidWriter,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z0: number,
  rows: number,
  cols: number,
  seed: number,
  all: boolean,
): void {
  for (let r = 0; r < rows; r++) {
    const zb = z0 + r;
    for (let c = 0; c < cols; c++) {
      const k = (c + 0.5) / cols;
      const half = 0.22 / cols;
      const x = ax + (bx - ax) * k;
      const y = ay + (by - ay) * k;
      const dx = (bx - ax) * half;
      const dy = (by - ay) * half;
      const lit = all || toUnit(hash2(seed, c, r)) > 0.58;
      // The reveal first, a shade wider than the pane: it is what gives a punched window a wall
      // thickness, and a wall with thickness is the difference between a building and a decal. It
      // is also two pixels of it at the opening zoom, so it is the finest tier's alone.
      if (detail >= 2) w.wall(x - dx * 1.5, y - dy * 1.5, x + dx * 1.5, y + dy * 1.5, zb + 0.26, zb + 0.78, CONCRETE);
      w.wall(x - dx, y - dy, x + dx, y + dy, zb + 0.3, zb + 0.74, lit ? WARM : 'glass');
    }
  }
}

/** {@link punched} on both visible faces. */
function punchedFaces(
  w: SolidWriter,
  x: number,
  y: number,
  ww: number,
  dd: number,
  z0: number,
  rows: number,
  cols: number,
  seed: number,
  all: boolean,
): void {
  const fx = x + ww;
  const fy = y + dd;
  punched(w, x + 0.12, fy, fx - 0.12, fy, z0, rows, cols, seed, all);
  punched(w, fx, fy - 0.12, fx, y + 0.12, z0, rows, Math.max(1, Math.round((cols * dd) / ww)), seed ^ 0x2d, all);
}

/** A parapet: four thin walls standing above a roof deck. Nothing says *roof* like an edge. */
function parapet(w: SolidWriter, x: number, y: number, ww: number, dd: number, z: number, h = 0.16): void {
  // Four walls at three pixels each is four fills to draw one line. Below the finest tier it is
  // a single slab, which is the same line from anywhere a visitor is standing.
  if (detail < 2) { w.box(x, y, ww, dd, { color: CONCRETE, h: h * 0.55, z, outline: false }); return; }
  w.box(x, y, ww, 0.09, { color: CONCRETE, h, z, outline: false });
  w.box(x, y + dd - 0.09, ww, 0.09, { color: CONCRETE, h, z, outline: false });
  w.box(x, y, 0.09, dd, { color: CONCRETE, h, z, outline: false });
  w.box(x + ww - 0.09, y, 0.09, dd, { color: CONCRETE, h, z, outline: false });
}

/**
 * Roof furniture: a tank on legs, plant, a bulkhead, an aerial.
 *
 * The third scale of detail, and the one that reads at 40 px because it is the only thing up
 * there breaking a straight line. Everything is keyed on `seed`, so two towers of the same
 * archetype still have different junk on the roof.
 */
function clutter(w: SolidWriter, x: number, y: number, ww: number, dd: number, z: number, seed: number): void {
  if (detail < 1) return;
  const r = (n: number): number => toUnit(hash2(seed, n, 5));
  // The stair bulkhead — every real roof has one, and it is the biggest thing on it.
  w.box(x + 0.14, y + 0.14, 0.52 + r(1) * 0.2, 0.46, { color: CONCRETE, h: 0.42 + r(2) * 0.2, z });
  // The water tank, on four legs, which is the silhouette people actually recognize.
  const tx = x + ww - 0.72 - r(3) * 0.2;
  const ty = y + dd - 0.7;
  if (detail >= 2) {
    for (const ox of [0.08, 0.44]) {
      for (const oy of [0.08, 0.44]) w.post(tx + ox, ty + oy, z, 0.34, BODY, 0.045);
    }
  } else {
    // One box under the drum instead of four legs. At the opening zoom a leg is a grey pixel
    // against grey, and there are four of them on every roof in the frame.
    w.box(tx + 0.1, ty + 0.1, 0.36, 0.36, { color: BODY, h: 0.34, z, outline: false });
  }
  w.cylinder(tx + 0.26, ty + 0.26, 0.27, { color: 'brand', h: 0.44, z: z + 0.32 });
  if (detail < 2) return;
  w.cylinder(tx + 0.26, ty + 0.26, 0.2, { color: BODY, h: 0.07, z: z + 0.76, outline: false });
  // Plant: two chillers and a vent stack.
  w.box(x + ww * 0.5, y + 0.2, 0.34, 0.3, { color: CONCRETE, h: 0.2, z, outline: false });
  w.box(x + 0.24, y + dd * 0.55, 0.26, 0.26, { color: CONCRETE, h: 0.16, z, outline: false });
  w.post(x + ww - 0.3, y + 0.26, z, 0.5 + r(4) * 0.4, CONCRETE, 0.05);
}

// ── the downtown towers ──────────────────────────────────────────────────────────────────────

/**
 * **Setback spire.** The exhibit's argument in one object: plinth, body, two setbacks, crown,
 * mast. Six stages, each narrower than the last, and the outline alone says *tall*.
 */
export const spire = defineSprite({
  id: 'spire',
  w: 3,
  d: 3,
  massing(w, v, rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    const body = Math.max(5, Math.min(16, v.level));
    const tone = toUnit(hash2(s, 9, 9)) < 0.6 ? COOL : WARM;
    contact(w, -0.18, -0.18, 3.36, 3.36, 0.55);

    // 1 — massing. Plinth, canopy lip, body, two setbacks, crown, mast.
    w.box(0, 0, 3, 3, { color: CONCRETE, h: 0.62 });
    // The lobby, which is always lit: a warm slot at street level is what makes a tower look
    // occupied rather than modeled, and it is the only warm thing at eye height.
    w.wall(0.3, 3, 2.7, 3, 0.12, 0.5, WARM);
    w.wall(3, 2.7, 3, 0.3, 0.12, 0.5, WARM);
    for (const k of [0.6, 1.2, 1.8, 2.4]) w.post(k, 3, 0.1, 0.44, BODY, 0.05);
    w.box(-0.16, -0.16, 3.32, 3.32, { color: BODY, h: 0.1, z: 0.58, outline: false });

    const z1 = 0.68;
    w.box(0.2, 0.2, 2.6, 2.6, { color: BODY, h: body, z: z1 });
    glazing(w, 0.2, 0.2, 2.6, 2.6, z1, body, 5, s, all, tone);
    // 2 — rhythm. A string course every fifth floor: the middle scale, and the thing that stops
    // a forty-storey face reading as wallpaper.
    for (let f = 5; f < body; f += detail < 1 ? 10 : 5) {
      w.box(0.14, 0.14, 2.72, 2.72, { color: CONCRETE, h: 0.14, z: z1 + f, outline: false });
    }

    const z2 = z1 + body;
    parapet(w, 0.2, 0.2, 2.6, 2.6, z2);
    w.box(0.5, 0.5, 2, 2, { color: BODY, h: 4, z: z2 });
    glazing(w, 0.5, 0.5, 2, 2, z2, 4, 4, s ^ 0x77, all, tone);
    const z3 = z2 + 4;
    parapet(w, 0.5, 0.5, 2, 2, z3);
    w.box(0.82, 0.82, 1.36, 1.36, { color: BODY, h: 2.6, z: z3 });
    glazing(w, 0.82, 0.82, 1.36, 1.36, z3, 2, 3, s ^ 0x91, all, tone);

    // 3 — trim. Crown, dish, mast, and the beacon fixture the animator blinks.
    const z4 = z3 + 2.6;
    w.box(1.02, 1.02, 0.96, 0.96, { color: CONCRETE, h: 0.7, z: z4 });
    w.roof(0.9, 0.9, 1.2, 1.2, z4 + 0.7, 0.85, CONCRETE);
    w.post(1.5, 1.5, z4 + 1.5, 2.6 + rng.next() * 1.2, BODY, 0.05);
    w.cylinder(0.66, 2.3, 0.22, { color: CONCRETE, h: 0.06, z: z3 + 0.16, outline: false });
    clutter(w, 0.55, 0.55, 1.9, 1.9, z3, s);
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const body = Math.max(5, Math.min(16, v.level));
    const top = 0.68 + body + 4 + 2.6 + 1.5;
    const mast = top + 2.6 + rng.next() * 1.2;
    beacon(pen, gx + 1.5, gy + 1.5, z + mast, rng.next() * 3, 'bad', 0.14);
    // Guy wires. Two strokes, and they are why the mast reads as engineered.
    wire(pen, gx + 1.5, gy + 1.5, z + mast - 0.3, gx + 1.05, gy + 1.95, z + top - 0.9, BODY, 0.5);
    wire(pen, gx + 1.5, gy + 1.5, z + mast - 0.3, gx + 1.95, gy + 1.05, z + top - 0.9, BODY, 0.5);
    // One office where somebody is still working, and it flickers.
    const flick = noise2(0x5c1, rng.next() * 30, pen.t * 1.7) * 0.5 + 0.5;
    if (flick > 0.55) {
      glowDot(pen, gx + 2.1, gy + 2.9, z + 0.68 + body * 0.72, WARM, 0.16, snap((flick - 0.55) * 1.4));
    }
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1.5, gy + 1.5, zPx, 4.4, 0.95, WARM);
  },
});

/**
 * **Cornice crown.** The other way a tall building ends: piers up the whole face, a brim that
 * throws a shadow, and a stepped cap. Same height as the spire and nothing like it in outline.
 */
export const crown = defineSprite({
  id: 'crown',
  w: 3,
  d: 3,
  massing(w, v, _rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    const body = Math.max(6, Math.min(15, v.level));
    contact(w, -0.16, -0.16, 3.32, 3.32, 0.55);

    // 1 — massing: two-stage base, body, brim, stepped cap.
    w.box(-0.06, -0.06, 3.12, 3.12, { color: 'brand', h: 0.5 });
    w.box(0.12, 0.12, 2.76, 2.76, { color: 'brand', h: 0.9, z: 0.5 });
    w.wall(0.4, 3.06, 2.66, 3.06, 0.1, 0.44, WARM);
    w.wall(3.06, 2.66, 3.06, 0.4, 0.1, 0.44, WARM);

    const z1 = 1.4;
    w.box(0.3, 0.3, 2.4, 2.4, { color: BODY, h: body, z: z1 });
    glazing(w, 0.3, 0.3, 2.4, 2.4, z1, body, 4, s, all, WARM);
    // 2 — rhythm: five piers standing proud of each face, corner to corner. Deco, and the reason
    // this tower reads vertical while the spire reads stacked.
    const piers = detail < 1 ? 2 : 4;
    for (let i = 0; i <= piers; i++) {
      const k = 0.3 + (i / piers) * 2.4;
      w.box(k - 0.07, 2.62, 0.14, 0.14, { color: 'brand', h: body, z: z1, outline: false });
      w.box(2.62, k - 0.07, 0.14, 0.14, { color: 'brand', h: body, z: z1, outline: false });
    }

    // 3 — trim: the brim, three steps, a finial, and lamps under the overhang.
    const z2 = z1 + body;
    w.box(0.04, 0.04, 2.92, 2.92, { color: 'brand', h: 0.34, z: z2 });
    w.box(0.16, 0.16, 2.68, 2.68, { color: CONCRETE, h: 0.18, z: z2 + 0.34, outline: false });
    w.box(0.52, 0.52, 1.96, 1.96, { color: 'brand', h: 1.1, z: z2 + 0.52 });
    glazing(w, 0.52, 0.52, 1.96, 1.96, z2 + 0.52, 1, 3, s ^ 0x13, all, WARM);
    w.box(0.86, 0.86, 1.28, 1.28, { color: 'brand', h: 0.9, z: z2 + 1.62 });
    w.box(1.14, 1.14, 0.72, 0.72, { color: CONCRETE, h: 0.6, z: z2 + 2.52 });
    w.roof(1.0, 1.0, 1.0, 1.0, z2 + 3.12, 0.7, CONCRETE);
    w.post(1.5, 1.5, z2 + 3.8, 1.7, CONCRETE, 0.05);
    w.glow(1.5, 2.9, z2 + 0.2, WARM, 0.24, 0.7);
    w.glow(2.9, 1.5, z2 + 0.2, WARM, 0.24, 0.7);
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const body = Math.max(6, Math.min(15, v.level));
    const tip = 1.4 + body + 5.5;
    beacon(pen, gx + 1.5, gy + 1.5, z + tip, rng.next() * 3, 'bad', 0.12);
    // The cap is floodlit, and the floods breathe. A crown nobody lights is a crown at night.
    const pulse = 0.6 + (noise2(0x2f1, rng.next() * 20, pen.t * 0.4) * 0.5 + 0.5) * 0.4;
    glowDot(pen, gx + 1.5, gy + 1.5, z + tip - 1.9, WARM, 0.18, snap(0.7 * pulse));
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1.5, gy + 1.5, zPx, 4.2, 0.95, WARM);
  },
});

/**
 * **The drum.** Round, so its window rhythm cannot be a grid of quads — it is stacked rings of
 * light with fins between them, which is a different technique reaching the same place. The one
 * curved outline in the city, and it reads from anywhere.
 */
export const drum = defineSprite({
  id: 'drum',
  w: 3,
  d: 3,
  massing(w, v, rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    const body = Math.max(5, Math.min(13, v.level));
    contact(w, 0.1, 0.1, 2.8, 2.8, 0.5);

    // 1 — massing: a square plinth under a round body, a balcony ring, a smaller drum, a cap.
    w.box(0.1, 0.1, 2.8, 2.8, { color: CONCRETE, h: 0.55 });
    w.wall(0.5, 2.9, 2.4, 2.9, 0.1, 0.46, WARM);
    w.cylinder(1.5, 1.5, 1.32, { color: CONCRETE, h: 0.14, z: 0.55, outline: false });
    w.cylinder(1.5, 1.5, 1.16, { color: BODY, h: body, z: 0.69 });

    // 2 — rhythm: a lit ring per floor, and eight fins running the full height between them.
    for (let f = 0; f < body; f += detail < 1 ? 2 : 1) {
      const lit = all || toUnit(hash2(s, f, 2)) > 0.24;
      w.cylinder(1.5, 1.5, 1.17, {
        color: lit ? (toUnit(hash2(s, f, 7)) < 0.35 ? WARM : COOL) : 'glass',
        h: 0.46,
        z: 0.69 + f + 0.27,
        outline: false,
      });
    }
    // Eight fins is what a drum looks like from six feet away and four is what it looks like from
    // a block, because the far side's four are behind the near side's four in either case.
    const fins = detail < 2 ? 4 : 8;
    for (let i = 0; i < fins; i++) {
      const a = (i / fins) * Math.PI * 2; /* @tier-b pixels only */
      w.post(1.5 + Math.cos(a) * 1.18, 1.5 + Math.sin(a) * 1.18, 0.69, body, CONCRETE, 0.055);
    }

    // 3 — trim: the balcony ring two thirds up, the upper drum, a dish, a mast.
    const zr = 0.69 + body * 0.66;
    w.cylinder(1.5, 1.5, 1.42, { color: CONCRETE, h: 0.16, z: zr });
    w.cylinder(1.5, 1.5, 1.42, { color: BODY, h: 0.18, z: zr + 0.16, outline: false });
    const z2 = 0.69 + body;
    w.cylinder(1.5, 1.5, 1.24, { color: CONCRETE, h: 0.2, z: z2, outline: false });
    w.cylinder(1.5, 1.5, 0.86, { color: BODY, h: 2.2, z: z2 + 0.2 });
    w.cylinder(1.5, 1.5, 0.87, { color: all ? WARM : COOL, h: 0.5, z: z2 + 0.7, outline: false });
    w.cylinder(1.5, 1.5, 0.5, { color: CONCRETE, h: 0.4, z: z2 + 2.4 });
    w.post(1.5, 1.5, z2 + 2.8, 2.2 + rng.next(), BODY, 0.05);
    w.box(2.0, 1.2, 0.36, 0.36, { color: CONCRETE, h: 0.1, z: z2 + 0.24, outline: false });
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const body = Math.max(5, Math.min(13, v.level));
    const top = 0.69 + body + 2.8;
    beacon(pen, gx + 1.5, gy + 1.5, z + top + 2.2 + rng.next(), rng.next() * 3);
    // The dish turns, slowly, all night. One rotating thing in a city of static ones.
    const a = pen.t * 0.16 + rng.next() * 6; /* @tier-b pixels only */
    const dx = Math.cos(a) * 0.3;
    const dy = Math.sin(a) * 0.3;
    isoBox(pen, gx + 2.18 - 0.1, gy + 1.38 - 0.1, 0.2, 0.2, { color: CONCRETE, h: 0.28, z: z + top - 2.5, outline: false });
    wire(pen, gx + 2.18, gy + 1.38, z + top - 2.22, gx + 2.18 + dx, gy + 1.38 + dy, z + top - 2.0, CONCRETE, 0.9, 2.4);
    // The revolving floor: one bright arc chasing round the upper drum.
    const p = at(pen, gx + 1.5 + Math.cos(-a * 0.7) * 0.85, gy + 1.5 + Math.sin(-a * 0.7) * 0.85, z + top - 2.1);
    const warm = pen.palette.get('warn');
    pen.surface.softEllipse(p.x, p.y, 10 * pen.camera.zoom, 6 * pen.camera.zoom, withAlpha(warm, 0.6), withAlpha(warm, 0));
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1.5, gy + 1.5, zPx, 4.1, 0.95, WARM);
  },
});

/**
 * **The twins.** Two shafts of unequal height with a sky bridge between them. The only outline in
 * the city with a hole in it, which is worth more than any amount of surface detail.
 */
export const twins = defineSprite({
  id: 'twins',
  w: 3,
  d: 3,
  massing(w, v, _rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    const tall = Math.max(6, Math.min(15, v.level));
    const short = Math.max(4, tall - 3 - Math.round(toUnit(hash2(s, 4, 4)) * 3));
    contact(w, -0.1, -0.1, 3.2, 3.2, 0.52);

    // 1 — massing: a shared podium, then two slabs with a gap you can see the sky through.
    w.box(0, 0, 3, 3, { color: CONCRETE, h: 0.7 });
    w.wall(0.3, 3, 2.7, 3, 0.14, 0.56, WARM);
    w.box(-0.12, -0.12, 3.24, 3.24, { color: BODY, h: 0.1, z: 0.66, outline: false });

    const z1 = 0.76;
    w.box(0.12, 0.3, 1.16, 2.4, { color: BODY, h: tall, z: z1 });
    glazing(w, 0.12, 0.3, 1.16, 2.4, z1, tall, 3, s, all, COOL);
    w.box(1.72, 0.3, 1.16, 2.4, { color: BODY, h: short, z: z1 });
    glazing(w, 1.72, 0.3, 1.16, 2.4, z1, short, 3, s ^ 0x44, all, COOL);

    // 2 — rhythm: the bridge, three storeys deep, and a service band on each shaft.
    const zb = z1 + short * 0.62;
    w.box(1.24, 0.62, 0.52, 1.3, { color: CONCRETE, h: 0.9, z: zb });
    w.wall(1.24, 1.92, 1.76, 1.92, zb + 0.2, zb + 0.7, all ? WARM : COOL);
    w.box(0.06, 0.24, 1.28, 2.52, { color: CONCRETE, h: 0.16, z: z1 + short * 0.3, outline: false });
    w.box(1.66, 0.24, 1.28, 2.52, { color: CONCRETE, h: 0.16, z: z1 + short * 0.3, outline: false });

    // 3 — trim: parapets, plant, two masts of different heights.
    parapet(w, 0.12, 0.3, 1.16, 2.4, z1 + tall);
    parapet(w, 1.72, 0.3, 1.16, 2.4, z1 + short);
    clutter(w, 1.74, 0.34, 1.1, 2.3, z1 + short, s ^ 0x9);
    w.box(0.3, 0.9, 0.5, 0.7, { color: CONCRETE, h: 0.4, z: z1 + tall });
    w.post(0.7, 1.5, z1 + tall + 0.16, 2.4, BODY, 0.05);
    w.post(2.3, 1.5, z1 + short + 0.16, 1.4, BODY, 0.045);
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const s = v.seed;
    const tall = Math.max(6, Math.min(15, v.level));
    const short = Math.max(4, tall - 3 - Math.round(toUnit(hash2(s, 4, 4)) * 3));
    beacon(pen, gx + 0.7, gy + 1.5, z + 0.76 + tall + 2.6, 0.1);
    beacon(pen, gx + 2.3, gy + 1.5, z + 0.76 + short + 1.6, 0.6);
    // A cable strung between the two masts, and a maintenance light crawling along it.
    const ax = gx + 0.7;
    const ay = gy + 1.5;
    const az = z + 0.76 + tall + 2.4;
    const bx = gx + 2.3;
    const bz = z + 0.76 + short + 1.5;
    wire(pen, ax, ay, az, bx, ay, bz, BODY, 0.45);
    const k = (pen.t * 0.07) % 1;
    const sag = Math.sin(k * Math.PI) * 0.5; /* @tier-b pixels only */
    glowDot(pen, ax + (bx - ax) * k, ay, az + (bz - az) * k - sag, COOL, 0.09, 0.8);
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1.5, gy + 1.5, zPx, 4.2, 0.95, COOL);
  },
});

/**
 * **The site.** A tower that is not there yet: a core, slabs, columns, netting, and a crane whose
 * jib turns all night. The skeletal outline is the strongest silhouette in the city precisely
 * because it is the only one you can see through.
 */
export const site = defineSprite({
  id: 'site',
  w: 3,
  d: 3,
  massing(w, v, _rng) {
    const s = v.seed;
    const floors = Math.max(3, Math.min(9, Math.round(v.level * 0.6)));
    contact(w, -0.1, -0.1, 3.2, 3.2, 0.42);

    // 1 — massing: hoarding, spoil, the concrete core, the slabs, the columns.
    w.box(0, 0, 3, 0.12, { color: 'brand', h: 0.6, outline: false });
    w.box(0, 2.88, 3, 0.12, { color: 'brand', h: 0.6, outline: false });
    w.box(0, 0, 0.12, 3, { color: 'brand', h: 0.6, outline: false });
    w.box(2.88, 0, 0.12, 3, { color: 'brand', h: 0.6, outline: false });
    w.box(0.9, 0.9, 1.0, 1.0, { color: CONCRETE, h: floors + 1.4, z: 0.1 });
    for (let f = 0; f < floors; f++) {
      w.patch(0.3, 0.3, 2.4, 2.4, 0.6 + f * 1.1, CONCRETE, BODY);
    }
    const cols = detail < 2 ? [0.36, 2.52] : [0.36, 1.44, 2.52];
    for (const ox of cols) {
      for (const oy of cols) w.post(ox, oy, 0.1, 0.6 + floors * 1.1, CONCRETE, 0.06);
    }

    // 2 — rhythm: safety netting on the two exposed faces, and a lit floor where the night shift is.
    for (let f = 0; f < floors; f++) {
      const zb = 0.6 + f * 1.1;
      if (toUnit(hash2(s, f, 3)) > 0.55) {
        w.wall(0.32, 2.7, 2.68, 2.7, zb + 0.05, zb + 0.95, 'glass');
      } else {
        w.wall(0.32, 2.7, 2.68, 2.7, zb + 0.1, zb + 0.5, toUnit(hash2(s, f, 8)) > 0.5 ? COOL : 'glass');
      }
    }

    // 3 — trim: site hut, materials, a ladder cage on the core, and the crane mast.
    w.box(2.0, 0.24, 0.62, 0.46, { color: 'brand', h: 0.42, z: 0.1 });
    w.wall(2.0, 0.7, 2.62, 0.7, 0.16, 0.4, WARM);
    for (let i = 0; i < 4; i++) {
      w.box(0.26 + i * 0.12, 2.1 + i * 0.05, 0.5, 0.34, { color: CONCRETE, h: 0.1, z: 0.1 + i * 0.1, outline: false });
    }
    const mastTop = 0.1 + floors * 1.1 + 5.5;
    for (const ox of [1.34, 1.62]) {
      for (const oy of [1.34, 1.62]) w.post(ox, oy, 0.1, mastTop, WARM, 0.045);
    }
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const floors = Math.max(3, Math.min(9, Math.round(v.level * 0.6)));
    const top = z + 0.1 + floors * 1.1 + 5.5;
    const cx = gx + 1.5;
    const cy = gy + 1.5;
    // The jib. One slow revolution every couple of minutes — a city has to have one thing in it
    // that is unmistakably *working*, and this is it.
    const a = pen.t * 0.05 + rng.next() * 6; /* @tier-b pixels only */
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tipX = cx + dx * 3.4;
    const tipY = cy + dy * 3.4;
    const backX = cx - dx * 1.3;
    const backY = cy - dy * 1.3;
    wire(pen, cx, cy, top + 0.5, tipX, tipY, top + 0.5, CONCRETE, 0.95, 2.6);
    wire(pen, cx, cy, top + 0.22, tipX, tipY, top + 0.42, CONCRETE, 0.7, 1.4);
    wire(pen, backX, backY, top + 0.5, cx, cy, top + 0.5, CONCRETE, 0.95, 2.6);
    wire(pen, cx, cy, top + 1.5, tipX, tipY, top + 0.5, CONCRETE, 0.55);
    wire(pen, cx, cy, top + 1.5, backX, backY, top + 0.5, CONCRETE, 0.55);
    isoBox(pen, backX - 0.22, backY - 0.22, 0.44, 0.44, { color: CONCRETE, h: 0.4, z: top + 0.1 });
    isoBox(pen, cx - 0.18, cy - 0.18, 0.36, 0.36, { color: WARM, h: 0.3, z: top + 0.5, outline: false });
    // The trolley runs out and back, and the load hangs under it.
    const run = 1.1 + (noise2(0x71c, rng.next() * 12, pen.t * 0.13) * 0.5 + 0.5) * 2.1;
    const hx = cx + dx * run;
    const hy = cy + dy * run;
    const hookZ = z + 0.6 + floors * 1.1 * (0.35 + 0.5 * (noise2(0x71c, 3, pen.t * 0.11) * 0.5 + 0.5));
    wire(pen, hx, hy, top + 0.5, hx, hy, hookZ, CONCRETE, 0.5);
    isoBox(pen, hx - 0.24, hy - 0.24, 0.48, 0.48, { color: 'brand', h: 0.24, z: hookZ });
    beacon(pen, tipX, tipY, top + 0.7, 0.2, 'bad', 0.11);
    beacon(pen, cx, cy, top + 1.7, 0.5, 'bad', 0.1);
    // A welder on the top slab. Blue-white, five frames long, and the whole face flashes with it.
    const arc = noise2(0x9d2, rng.next() * 40, pen.t * 4.2);
    if (arc > 0.62) {
      const p = at(pen, gx + 2.2, gy + 2.5, z + 0.6 + (floors - 1) * 1.1);
      const k = pen.camera.zoom;
      const white = mix(pen.palette.get('lamp'), 0xffffffff, 0.6);
      pen.surface.softEllipse(p.x, p.y, 26 * k, 18 * k, withAlpha(white, 0.5), withAlpha(white, 0));
      pen.surface.ellipse(p.x, p.y, 2.4 * k, 2.4 * k, white);
      pen.light?.add(gx + 2.2, gy + 2.5, zPx, 3.4, 0.8, 'lamp');
    }
  },
});

/**
 * **The park.** The block that is not a building, and the exhibit needs one: a skyline with no
 * gap in it has no rhythm, and the eye has nowhere to rest. Trees, a fountain, four path lamps,
 * and the only ground-level light in the city that is not a street lamp.
 */
export const park = defineSprite({
  id: 'park',
  w: 3,
  d: 3,
  massing(w, v, rng) {
    const s = v.seed;
    contact(w, 0.1, 0.1, 2.8, 2.8, 0.3);
    // 1 — massing: a lawn, a raised terrace, a low wall, a basin.
    w.box(0.06, 0.06, 2.88, 2.88, { color: 'ok', h: 0.12, topColor: 'ok' });
    w.box(0.9, 0.9, 1.2, 1.2, { color: CONCRETE, h: 0.1, z: 0.12, outline: false });
    for (const [x, y, ww, dd] of [
      [0.06, 0.06, 2.88, 0.1],
      [0.06, 2.84, 2.88, 0.1],
    ] as const) {
      w.box(x, y, ww, dd, { color: CONCRETE, h: 0.2, outline: false });
    }
    w.cylinder(1.5, 1.5, 0.42, { color: CONCRETE, h: 0.24, z: 0.12 });
    w.cylinder(1.5, 1.5, 0.34, { color: 'glass', h: 0.06, z: 0.3, outline: false });
    w.cylinder(1.5, 1.5, 0.1, { color: CONCRETE, h: 0.36, z: 0.3, outline: false });

    // 2 — rhythm: six trees on a loose grid, each a trunk and three canopy volumes.
    for (let i = 0; i < 6; i++) {
      const tx = 0.4 + toUnit(hash2(s, i, 1)) * 2.2;
      const ty = 0.4 + toUnit(hash2(s, i, 2)) * 2.2;
      if (Math.abs(tx - 1.5) < 0.7 && Math.abs(ty - 1.5) < 0.7) continue;
      const h = 0.9 + rng.next() * 0.7;
      w.post(tx, ty, 0.12, h * 0.6, 'brand', 0.08);
      w.cylinder(tx, ty, 0.32 + rng.next() * 0.1, { color: 'ok', h: h * 0.5, z: 0.12 + h * 0.4 });
      if (detail >= 2) w.cylinder(tx, ty, 0.24, { color: 'ok', h: h * 0.4, z: 0.12 + h * 0.75, outline: false });
    }

    // 3 — trim: four path lamps and two benches.
    for (const [lx, ly] of [
      [0.42, 0.42],
      [2.58, 0.42],
      [0.42, 2.58],
      [2.58, 2.58],
    ] as const) {
      w.post(lx, ly, 0.12, 0.85, BODY, 0.05);
      w.cylinder(lx, ly, 0.09, { color: WARM, h: 0.14, z: 0.97, outline: false });
      w.glow(lx, ly, 1.04, WARM, 0.17, 0.85);
    }
    w.box(1.15, 2.35, 0.7, 0.12, { color: 'brand', h: 0.16, z: 0.12, outline: false });
    w.box(2.35, 1.15, 0.12, 0.7, { color: 'brand', h: 0.16, z: 0.12, outline: false });
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const s = v.seed;
    // The canopies move on one wind field with a per-tree phase, so the park moves together
    // without moving in lockstep.
    for (let i = 0; i < 6; i++) {
      const tx = gx + 0.4 + toUnit(hash2(s, i, 1)) * 2.2;
      const ty = gy + 0.4 + toUnit(hash2(s, i, 2)) * 2.2;
      if (Math.abs(tx - gx - 1.5) < 0.7 && Math.abs(ty - gy - 1.5) < 0.7) continue;
      const h = 0.9 + rng.next() * 0.7;
      const gust = noise2(0x4e2, tx * 0.4 + pen.t * 0.5, ty * 0.4) * 0.09;
      isoBox(pen, tx - 0.16 + gust, ty - 0.16 + gust * 0.6, 0.32, 0.32, {
        color: 'ok',
        h: 0.2,
        z: z + 0.12 + h * 1.1,
        outline: false,
      });
    }
    // The fountain: a jet that never repeats and a ring of light in the basin.
    const k = pen.camera.zoom;
    const jet = noise2(0x3a7, 1, pen.t * 2.2) * 0.5 + 0.5;
    const p = at(pen, gx + 1.5, gy + 1.5, z + 0.66 + jet * 0.24);
    const glass = pen.palette.get('glass');
    const lamp = pen.palette.get('lamp');
    pen.surface.softEllipse(p.x, p.y, 7 * k, 13 * k, withAlpha(mix(glass, lamp, 0.6), 0.6), withAlpha(lamp, 0));
    const b = at(pen, gx + 1.5, gy + 1.5, z + 0.36);
    pen.surface.softEllipse(b.x, b.y, 15 * k, 8 * k, withAlpha(lamp, 0.34), withAlpha(lamp, 0));
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    // One pool, in the basin. Four path lamps each throwing their own put a park's whole lawn
    // inside a single flat wash, which is the opposite of what a park is for at night.
    field.add(gx + 1.5, gy + 1.5, zPx, 0.95, 0.55, 'lamp');
  },
});

// ── the middle of the block ──────────────────────────────────────────────────────────────────

/**
 * **The slab.** Wide, flat-topped, and asymmetric: one shoulder two storeys higher than the
 * other, because a symmetrical slab is a wall. A roof deck with a tank, a sign, and an aerial.
 */
export const slab = defineSprite({
  id: 'slab',
  w: 3,
  d: 2,
  massing(w, v, rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    const body = Math.max(4, Math.min(11, v.level));
    const step = 1 + Math.round(rng.next() * 2);
    contact(w, -0.1, -0.1, 3.2, 2.2, 0.5);

    // 1 — massing: plinth, shopfront, body, one shoulder taller than the other.
    w.box(0, 0, 3, 2, { color: 'brand', h: 0.62 });
    w.wall(0.2, 2, 2.8, 2, 0.12, 0.5, WARM);
    w.wall(3, 1.8, 3, 0.2, 0.12, 0.5, WARM);
    w.box(-0.14, -0.14, 3.28, 2.28, { color: BODY, h: 0.1, z: 0.56, outline: false });
    const z1 = 0.68;
    w.box(0.14, 0.14, 2.72, 1.72, { color: BODY, h: body, z: z1 });
    glazing(w, 0.14, 0.14, 2.72, 1.72, z1, body, 6, s, all, COOL);
    w.box(1.5, 0.14, 1.36, 1.72, { color: BODY, h: step, z: z1 + body });
    glazing(w, 1.5, 0.14, 1.36, 1.72, z1 + body, step, 3, s ^ 0x62, all, COOL);

    // 2 — rhythm: a service band a third of the way up, and a cornice under each roof.
    w.box(0.08, 0.08, 2.84, 1.84, { color: CONCRETE, h: 0.16, z: z1 + Math.floor(body / 3), outline: false });
    w.box(0.06, 0.06, 2.88, 1.88, { color: CONCRETE, h: 0.14, z: z1 + body, outline: false });

    // 3 — trim: parapets, roof clutter on the low half, a rooftop sign, an aerial.
    parapet(w, 0.14, 0.14, 2.72, 1.72, z1 + body + 0.14);
    parapet(w, 1.5, 0.14, 1.36, 1.72, z1 + body + step);
    clutter(w, 0.2, 0.2, 1.2, 1.6, z1 + body + 0.14, s);
    const words = ['HOTEL', 'UNION', 'ATLAS', 'ORIENT', 'CIVIC', 'METRO'];
    w.sign(1.56, 1.86, 2.8, 1.86, z1 + body + step + 0.9, 0.5, words[Math.floor(rng.next() * words.length)] ?? 'HOTEL', WARM);
    w.post(1.7, 0.4, z1 + body + step, 1.4, BODY, 0.045);
    w.post(2.6, 0.4, z1 + body + step, 0.9, BODY, 0.04);
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const body = Math.max(4, Math.min(11, v.level));
    const step = 1 + Math.round(rng.next() * 2);
    const roof = z + 0.68 + body + step;
    beacon(pen, gx + 1.7, gy + 0.4, roof + 1.4, rng.next() * 3);
    wire(pen, gx + 1.7, gy + 0.4, roof + 1.35, gx + 2.6, gy + 0.4, roof + 0.9, BODY, 0.4);
    // The rooftop sign buzzes: a warm halo that dips every few seconds, which is what a neon
    // transformer looks like from three blocks away.
    const buzz = 0.75 + (noise2(0x6b2, rng.next() * 15, pen.t * 1.1) * 0.5 + 0.5) * 0.25;
    glowDot(pen, gx + 2.2, gy + 1.9, roof + 0.7, WARM, 0.2, snap(0.6 * buzz));
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1.5, gy + 1, zPx, 3.9, 0.95, WARM);
  },
});

/**
 * **The shed.** Two storeys of nothing, a sawtooth roof, and one chimney seven storeys tall with
 * steam coming off it. The whole silhouette is a flat line and a needle, and it is the strongest
 * contrast the skyline has.
 */
export const shedWide = defineSprite({
  id: 'shed',
  w: 3,
  d: 2,
  massing(w, v, rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    contact(w, -0.06, -0.06, 3.12, 2.12, 0.45);
    // 1 — massing: a yard wall, the shed, three sawtooth bays, the stack.
    w.box(0, 0, 3, 2, { color: 'brand', h: 1.5 });
    for (let i = 0; i < 3; i++) {
      const x = 0.08 + i * 0.98;
      w.box(x, 0.08, 0.9, 1.84, { color: 'brand', h: 0.3, z: 1.5, outline: false });
      // The north light: the glazed face of each saw tooth, which is the roof's whole rhythm.
      w.wall(x, 1.92, x + 0.9, 1.92, 1.8, 2.3, all || toUnit(hash2(s, i, 6)) > 0.4 ? COOL : 'glass');
      // BODY, not CONCRETE: a saw tooth is the only pitched face in the city that catches the top
      // shade, and three pale triangles standing off a dark roof read as an artifact rather than a
      // roof. Dark, they read as what they are and the glazed north light is the only bright thing.
      w.roof(x, 0.08, 0.9, 1.84, 1.8, 0.5, BODY, false);
    }
    // 2 — rhythm: a band of small high windows and two roller doors.
    punched(w, 0.2, 2, 2.8, 2, 0.4, 1, 6, s, all);
    w.wall(0.35, 2, 1.15, 2, 0.02, 0.9, CONCRETE);
    w.wall(1.55, 2, 2.35, 2, 0.02, 0.9, CONCRETE);
    w.box(0.3, 1.88, 0.9, 0.12, { color: BODY, h: 0.1, z: 0.9, outline: false });
    // 3 — trim: the stack with its bands, a vent fan, crates in the yard.
    w.cylinder(2.55, 0.5, 0.19, { color: 'brand', h: 7 + rng.next() * 2 });
    for (let b = 0; b < 3; b++) {
      w.cylinder(2.55, 0.5, 0.2, { color: CONCRETE, h: 0.2, z: 5.4 + b * 0.5, outline: false });
    }
    w.box(0.35, 0.3, 0.4, 0.4, { color: CONCRETE, h: 0.24, z: 1.8, outline: false });
    for (let i = 0; i < 3; i++) {
      w.box(0.2 + i * 0.26, 0.08 + i * 0.1, 0.34, 0.3, { color: 'brand', h: 0.24, z: 0, outline: false });
    }
    w.glow(1.35, 2.02, 1.0, WARM, 0.2, 0.8);
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const z = pxToLevels(zPx);
    const h = 7 + rng.next() * 2;
    steam(pen, gx + 2.55, gy + 0.5, zPx + h * LEVEL_H, 0x51c, 1);
    beacon(pen, gx + 2.55, gy + 0.5, z + h + 0.1, rng.next() * 3, 'bad', 0.1);
    // The extract fan on the roof, turning. Two ticks a second, and it is the only motion at
    // this end of the block.
    const a = pen.t * 2.1 + rng.next() * 6; /* @tier-b pixels only */
    wire(pen, gx + 0.55, gy + 0.5, z + 2.06, gx + 0.55 + Math.cos(a) * 0.16, gy + 0.5 + Math.sin(a) * 0.16, z + 2.06, CONCRETE, 0.8, 1.6);
  },
});

/**
 * **The walkup.** Brick, punched windows, a cornice, a fire escape zig-zagging down the front and
 * a tank on the roof. Nothing in it is tall; everything in it is the texture the towers are not.
 */
export const walkup = defineSprite({
  id: 'walkup',
  w: 2,
  d: 3,
  massing(w, v, rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    const body = Math.max(3, Math.min(7, v.level));
    contact(w, -0.06, -0.06, 2.12, 3.12, 0.48);
    // 1 — massing: a stoop, the brick body, a cornice, a roof.
    w.box(0, 0, 2, 3, { color: 'brand', h: body + 0.9 });
    w.box(-0.1, -0.1, 2.2, 3.2, { color: CONCRETE, h: 0.14, z: body + 0.9 });
    // 2 — rhythm: shopfront at street level, punched windows above it, a string course between.
    w.wall(0.15, 3, 1.85, 3, 0.1, 0.68, all ? WARM : COOL);
    w.wall(2, 2.85, 2, 0.15, 0.1, 0.68, 'glass');
    w.box(-0.06, -0.06, 2.12, 3.12, { color: CONCRETE, h: 0.12, z: 0.78, outline: false });
    punchedFaces(w, 0, 0, 2, 3, 0.9, body, 3, s, all);
    // The awning over the shop, which is the one warm thing at eye level on this side.
    w.patch(0.15, 3.0, 1.7, 0.34, 0.74, 'bad');
    w.box(0.15, 3.3, 1.7, 0.06, { color: 'bad', h: 0.1, z: 0.66, outline: false });
    // 3 — trim: fire escape, tank on legs, chimney pot, a satellite dish.
    for (let f = 1; f < body; f += detail < 1 ? 2 : 1) {
      const zb = 0.9 + f;
      w.box(2.0, 0.5, 0.34, 1.5, { color: BODY, h: 0.06, z: zb + 0.06, outline: false });
      w.post(2.3, 0.55, zb, 0.94, BODY, 0.035);
      w.post(2.3, 1.95, zb, 0.94, BODY, 0.035);
      w.box(2.0, f % 2 === 0 ? 0.5 : 1.6, 0.3, 0.4, { color: BODY, h: 0.05, z: zb + 0.5, outline: false });
    }
    const zr = body + 1.04;
    for (const ox of [0.3, 0.72]) {
      for (const oy of [1.9, 2.32]) w.post(ox, oy, zr, 0.3, BODY, 0.04);
    }
    w.cylinder(0.51, 2.11, 0.3, { color: 'brand', h: 0.5, z: zr + 0.28 });
    w.cylinder(0.51, 2.11, 0.22, { color: BODY, h: 0.08, z: zr + 0.78, outline: false });
    w.box(1.45, 0.3, 0.3, 0.3, { color: 'brand', h: 0.5, z: zr, outline: false });
    w.box(1.7, 1.2, 0.24, 0.24, { color: CONCRETE, h: 0.06, z: zr, outline: false });
    w.post(1.3, 0.8, zr, 0.7, BODY, 0.035);
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const body = Math.max(3, Math.min(7, v.level));
    const zr = z + body + 1.34;
    // A washing line between the roof and the tank legs, sagging and moving.
    const sway = noise2(0x8c1, rng.next() * 20, pen.t * 0.8) * 0.06;
    wire(pen, gx + 0.3, gy + 1.9, zr, gx + 1.7, gy + 1.2 + sway, zr - 0.2, BODY, 0.5);
    for (let i = 1; i < 4; i++) {
      const k = i / 4;
      const wx = gx + 0.3 + 1.4 * k;
      const wy = gy + 1.9 - (0.7 - sway) * k;
      const wz = zr - 0.2 * k - Math.sin(k * Math.PI) * 0.12; /* @tier-b pixels only */
      isoBox(pen, wx - 0.06, wy - 0.06, 0.12, 0.12, {
        color: i === 2 ? 'ok' : 'lamp',
        h: 0.16,
        z: wz - 0.16,
        outline: false,
      });
    }
    // One window with a television in it. Cool, flickering, and unmistakable.
    const tv = noise2(0x2d7, rng.next() * 30, pen.t * 3.4) * 0.5 + 0.5;
    const p = at(pen, gx + 1.35, gy + 3.02, z + 1.4 + Math.floor(rng.next() * Math.max(1, body - 1)) + 0.5);
    const k = pen.camera.zoom;
    const glow = mix(pen.palette.get('lamp'), pen.palette.get('glass'), 0.35);
    pen.surface.softEllipse(p.x, p.y, 11 * k, 9 * k, withAlpha(glow, snap(0.25 + tv * 0.55)), withAlpha(glow, 0));
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1, gy + 2.4, zPx, 3.4, 0.92, WARM);
  },
});

/**
 * **The row.** Three narrow houses under three pitched roofs at three heights, sharing party
 * walls. The only roofline in the city that is not flat, which is exactly why it is here.
 */
export const rowHouses = defineSprite({
  id: 'row',
  w: 2,
  d: 3,
  massing(w, v, rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    contact(w, -0.04, -0.04, 2.08, 3.08, 0.42);
    // Three units along the deep axis, each its own height and its own roof.
    for (let i = 0; i < 3; i++) {
      const y = i;
      const h = 1.9 + toUnit(hash2(s, i, 1)) * 1.3;
      const hue: Ink = i % 2 === 0 ? 'brand' : CONCRETE;
      // 1 — massing: the box, the roof, a chimney on the party wall.
      w.box(0, y + 0.04, 2, 0.92, { color: hue, h });
      w.roof(-0.08, y - 0.02, 2.16, 1.04, h, 0.62 + toUnit(hash2(s, i, 4)) * 0.2, BODY);
      w.box(0.2, y + 0.28, 0.24, 0.24, { color: CONCRETE, h: h + 0.85, outline: false });
      // 2 — rhythm: two windows up, a door and a window down, all on the visible long face.
      punched(w, 2, y + 0.9, 2, y + 0.1, 0.9, 1, 2, s ^ (i * 7), all);
      w.wall(2, y + 0.86, 2, y + 0.5, 0.04, 0.72, all ? WARM : 'glass');
      w.wall(2, y + 0.44, 2, y + 0.12, 0.04, 0.6, BODY);
      // 3 — trim: a lamp beside the door, a sill course, a gutter.
      w.box(1.98, y + 0.06, 0.06, 0.9, { color: BODY, h: 0.07, z: 0.78, outline: false });
      w.glow(2.06, y + 0.32, 0.8, WARM, 0.13, 0.7);
    }
    w.box(-0.06, 0, 0.12, 3, { color: CONCRETE, h: 0.24, outline: false });
    w.post(1.7, 2.6, 0, 1.1, BODY, 0.04);
    w.cylinder(1.7, 2.6, 0.16, { color: 'ok', h: 0.3, z: 1.1, outline: false });
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const s = v.seed;
    // Chimney smoke from whichever unit has the fire lit tonight.
    const lit = Math.floor(toUnit(hash2(s, 3, 3)) * 3);
    const h = 1.9 + toUnit(hash2(s, lit, 1)) * 1.3;
    steam(pen, gx + 0.32, gy + lit + 0.4, zPx + (h + 0.85) * LEVEL_H, 0x77a, 0.7);
    // A television in the middle house, out of phase with the walkup's.
    const tv = noise2(0x2d7, rng.next() * 30, pen.t * 2.6) * 0.5 + 0.5;
    const p = at(pen, gx + 2.02, gy + 1.7, z + 1.3);
    const k = pen.camera.zoom;
    const glow = mix(pen.palette.get('lamp'), pen.palette.get('glass'), 0.4);
    pen.surface.softEllipse(p.x, p.y, 9 * k, 8 * k, withAlpha(glow, snap(0.2 + tv * 0.5)), withAlpha(glow, 0));
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1.8, gy + 1.5, zPx, 3.2, 0.92, WARM);
  },
});

/**
 * **The pencil.** Two tiles of ground and fourteen storeys of building: the tower a leftover lot
 * gets. Nothing else in the city is this thin, and one of them at a block corner does more for a
 * skyline than three more slabs.
 */
export const pencil = defineSprite({
  id: 'pencil',
  w: 2,
  d: 2,
  massing(w, v, rng) {
    const all = (v.flags & FLAG_POWERED) !== 0;
    const s = v.seed;
    const body = Math.max(7, Math.min(18, v.level + 3));
    contact(w, 0.06, 0.06, 1.88, 1.88, 0.5);
    // 1 — massing: a small plinth, a very tall shaft, one setback near the top, a cap.
    w.box(0, 0, 2, 2, { color: CONCRETE, h: 0.5 });
    w.wall(0.2, 2, 1.8, 2, 0.1, 0.4, WARM);
    w.box(0.24, 0.24, 1.52, 1.52, { color: BODY, h: body, z: 0.5 });
    glazing(w, 0.24, 0.24, 1.52, 1.52, 0.5, body, 3, s, all, toUnit(hash2(s, 1, 1)) < 0.5 ? WARM : COOL);
    // 2 — rhythm: an outrigger band every four floors, which is what stops a thin tower reading
    // as a chimney.
    for (let f = 4; f < body; f += 4) {
      w.box(0.16, 0.16, 1.68, 1.68, { color: CONCRETE, h: 0.18, z: 0.5 + f, outline: false });
    }
    // 3 — trim: a set-back crown, a slot through it, a tank, a mast.
    const z2 = 0.5 + body;
    w.box(0.36, 0.36, 1.28, 1.28, { color: BODY, h: 1.6, z: z2 });
    w.wall(0.44, 1.64, 1.56, 1.64, z2 + 0.3, z2 + 1.1, all ? WARM : COOL);
    parapet(w, 0.36, 0.36, 1.28, 1.28, z2 + 1.6, 0.12);
    w.cylinder(1.05, 1.05, 0.2, { color: 'brand', h: 0.36, z: z2 + 1.6 });
    w.post(0.7, 0.7, z2 + 1.6, 2.2 + rng.next(), BODY, 0.04);
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const body = Math.max(7, Math.min(18, v.level + 3));
    const mast = z + 0.5 + body + 1.6 + 2.2 + rng.next();
    beacon(pen, gx + 0.7, gy + 0.7, mast, rng.next() * 3);
    wire(pen, gx + 0.7, gy + 0.7, mast - 0.2, gx + 1.5, gy + 1.5, z + 0.5 + body + 1.7, BODY, 0.4);
  },
  emit(field, gx, gy, v, _rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    field.add(gx + 1, gy + 1, zPx, 3.7, 0.95, WARM);
  },
});

/**
 * **The kiosk.** One storey, a neon sign on a pole, an awning and a lit counter. It exists so
 * that the eye has something at street level to land on between two hundred feet of glass.
 */
export const kiosk = defineSprite({
  id: 'kiosk',
  w: 2,
  d: 2,
  massing(w, v, rng) {
    const s = v.seed;
    contact(w, 0.04, 0.04, 1.92, 1.92, 0.42);
    // 1 — massing: a paved apron, the unit, a flat roof, a taller back store.
    w.box(0.06, 0.06, 1.88, 1.88, { color: CONCRETE, h: 0.08, outline: false });
    w.box(0.2, 0.5, 1.5, 1.2, { color: 'brand', h: 1.2, z: 0.08 });
    w.box(0.2, 0.5, 0.6, 1.2, { color: 'brand', h: 0.5, z: 1.28 });
    // 2 — rhythm: a glazed counter the whole width, and a shutter beside it.
    w.wall(0.28, 1.7, 1.62, 1.7, 0.4, 1.05, WARM);
    w.wall(1.7, 1.6, 1.7, 0.6, 0.4, 1.05, WARM);
    for (let i = 0; i < 5; i++) {
      w.post(0.32 + i * 0.32, 1.7, 0.38, 0.7, BODY, 0.035);
    }
    // 3 — trim: awning, crates, a bin, and the sign on its pole.
    w.patch(0.2, 1.7, 1.5, 0.4, 1.12, 'bad');
    w.box(0.2, 2.06, 1.5, 0.06, { color: 'bad', h: 0.12, z: 1.0, outline: false });
    w.box(1.75, 0.16, 0.24, 0.24, { color: CONCRETE, h: 0.3, z: 0.08, outline: false });
    w.cylinder(0.42, 0.24, 0.14, { color: BODY, h: 0.3, z: 0.08, outline: false });
    w.post(1.82, 1.86, 0.08, 2.5 + rng.next() * 0.6, BODY, 0.05);
    const words = ['NOODLE', 'COFFEE', 'NEWS', 'RAMEN', 'BAR'];
    w.sign(1.2, 1.94, 1.98, 1.94, 2.9 + rng.next() * 0.4, 0.42, words[Math.floor(toUnit(hash2(s, 2, 2)) * words.length)] ?? 'BAR', 'neon');
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const z = pxToLevels(zPx);
    const ph = rng.next() * 30;
    const top = z + 2.6 + rng.next() * 0.6;
    // The sign flickers, and once in a while it drops out entirely for a frame or two. A neon
    // sign that never fails is a light bulb.
    const n = noise2(0x1f4, ph, pen.t * 2.6) * 0.5 + 0.5;
    const on = n > 0.18;
    glowDot(pen, gx + 1.6, gy + 1.94, top, 'neon', 0.19, on ? snap(0.7 + n * 0.3) : 0.12);
    glowDot(pen, gx + 0.95, gy + 1.72, z + 0.9, WARM, 0.16, 0.75);
    // Somebody at the counter, shifting their weight.
    const bob = noise2(0x1f4, ph + 3, pen.t * 0.9) * 0.05;
    isoBox(pen, gx + 1.1 + bob, gy + 1.94, 0.22, 0.22, { color: BODY, h: 0.5, z, outline: false });
    isoBox(pen, gx + 1.08 + bob, gy + 1.92, 0.26, 0.26, { color: 'brand', h: 0.12, z: z + 0.5, outline: false });
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    // The counter only. The sign is a `glowDot` on the pole and does not need a second pool
    // underneath it saying the same thing a tile further out.
    field.add(gx + 1, gy + 1.8, zPx, 1.1, 0.72, WARM);
  },
});

// ── street furniture: the thin things ────────────────────────────────────────────────────────

/**
 * **The street lamp.** A base, a tapered post, a curved arm and a hooded head. It is four
 * primitives and it is doing more work than any of them: the pools it drops on the asphalt are
 * what make the streets read as *between* the buildings rather than as a floor under them.
 */
export const streetLamp = defineSprite({
  id: 'lamp',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    const lean = rng.next() * 0.04 - 0.02;
    // **The most repeated object in the city, so it is the one whose primitive count matters most.**
    // Every `post` is a gradient-filled quad, and there are three of them here against eighty
    // lamps in a frame. Below the finest tier the base and the column are one post and the head
    // is one box, which is four primitives instead of seven for a shape twelve pixels wide.
    if (detail >= 2) {
      contact(w, 0.3, 0.3, 0.4, 0.4, 0.3);
      w.box(0.4, 0.4, 0.2, 0.2, { color: CONCRETE, h: 0.12, outline: false });
    }
    w.post(0.5, 0.5, 0.1, detail >= 2 ? 2.5 : 3.0, BODY, 0.07);
    if (detail >= 2) {
      w.post(0.5 + lean, 0.5 + lean, 2.6, 0.5, BODY, 0.05);
      // The arm reaches out over the road, which is the whole reason a street lamp has a shape.
      w.post(0.62, 0.62, 3.0, 0.16, BODY, 0.09);
      w.box(0.56, 0.56, 0.26, 0.26, { color: CONCRETE, h: 0.1, z: 2.98, outline: false });
    }
    w.box(0.58, 0.58, 0.22, 0.22, { color: WARM, h: 0.06, z: 2.94, outline: false });
    w.glow(0.69, 0.69, 2.96, WARM, 0.26, 0.95);
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const z = pxToLevels(zPx);
    // A cone of light in the air under the hood: what a lamp looks like through city haze.
    const p = at(pen, gx + 0.69, gy + 0.69, z + 2.3);
    const k = pen.camera.zoom;
    const warm = pen.palette.get('warn');
    const flick = 0.9 + noise2(0x3b1, rng.next() * 40, pen.t * 0.6) * 0.1;
    pen.surface.softEllipse(p.x, p.y, 17 * k, 23 * k, withAlpha(warm, snap(0.09 * flick)), withAlpha(warm, 0));
  },
  emit(field, gx, gy, _v, rng, zPx) {
    const flick = 0.94 + noise2(0x3b1, rng.next() * 40, 0) * 0.06;
    // Two tiles, near full intensity, and a falloff steeper than the field's own default. A lamp
    // is the only thing in this city that throws a pool a visitor should be able to trace the rim
    // of, and the rim is the whole difference between lighting a street and tinting it.
    field.add(gx + 0.69, gy + 0.69, zPx, 0.95, snap(0.82 * flick), WARM, 4.6);
  },
});

/**
 * **The signal.** A mast, a gantry over the junction, and a head with three lamps in it — of
 * which exactly one is on, and it changes. Small, and it is the only object in the city that a
 * visitor will *wait* on.
 */
export const signal = defineSprite({
  id: 'signal',
  w: 1,
  d: 1,
  massing(w, _v, _rng) {
    contact(w, 0.32, 0.32, 0.36, 0.36, 0.3);
    if (detail >= 2) {
      w.box(0.42, 0.42, 0.16, 0.16, { color: CONCRETE, h: 0.1, outline: false });
      w.post(0.62, 0.62, 1.85, 0.12, CONCRETE, 0.07);
    }
    w.post(0.5, 0.5, 0.08, 1.9, CONCRETE, 0.06);
    w.box(0.62, 0.62, 0.2, 0.2, { color: BODY, h: 0.52, z: 1.32 });
    w.box(0.58, 0.58, 0.28, 0.06, { color: BODY, h: 0.06, z: 1.84, outline: false });
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    // Green, amber, red, on an eight-second cycle offset by the junction's own seed. Two
    // junctions changing together would look like one machine; offset, it looks like a city.
    const phase = (pen.t / 8 + toUnit(hash2(v.seed, 1, 1))) % 1;
    const lamp: Ink = phase < 0.46 ? 'ok' : phase < 0.56 ? WARM : 'bad';
    const zTop = phase < 0.46 ? 1.42 : phase < 0.56 ? 1.6 : 1.76;
    glowDot(pen, gx + 0.72, gy + 0.72, z + zTop, lamp, 0.13, 0.95);
  },
});

/**
 * **The vent.** A manhole with its cover off, a hazard barrier and a column of steam. Three
 * primitives, and it is the cheapest atmosphere in the whole exhibit: warm light from below
 * through moving vapor is what a night city *is*.
 */
export const vent = defineSprite({
  id: 'vent',
  w: 1,
  d: 1,
  massing(w, _v, _rng) {
    w.tile(0, 0, BODY, undefined, 0.3, 0.004);
    w.cylinder(0.5, 0.5, 0.2, { color: BODY, h: 0.05, outline: false });
    if (detail >= 2) {
      for (const [x, y] of [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.2, 0.8],
      ] as const) {
        w.post(x, y, 0, 0.4, WARM, 0.035);
      }
    }
    w.box(0.16, 0.16, 0.68, 0.06, { color: 'bad', h: 0.06, z: 0.34, outline: false });
    w.glow(0.5, 0.5, 0.1, WARM, 0.2, 0.6);
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    steam(pen, gx + 0.5, gy + 0.5, zPx, 0x2b8, 0.85 + rng.next() * 0.3);
  },
});
