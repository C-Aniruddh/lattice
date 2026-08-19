/**
 * The marsh, and the bloom that crosses it — the state a replay has to land on.
 *
 * Everything here is Tier A: `+ - * /`, shifts, comparisons and integers. Nothing reads a clock,
 * nothing reads a frame delta, and the only randomness is seeded and addressed by position
 * (`hash2`, `fbm2`) rather than drawn from a stream — so this module cannot tell whether it is
 * running live or being re-run by `@latticekit/loop`'s driver, which is the whole point.
 *
 * ## Why the bloom is a queue and not a field sweep
 *
 * A cell is claimed once, by whichever neighbour reached it first, and lights a few ticks later —
 * fewer through the water, more up a ridge, so the front is the shape of the ground. The total
 * work of a session is therefore **one visit per cell**, 3,136 of them, rather than one sweep per
 * tick. That is what makes the scrub bar affordable: dragging it re-runs the whole session from
 * tick 0 on every pointer move, and a full re-run is bounded by the size of the map rather than
 * by its length in ticks. A field sweep would have cost tens of milliseconds a drag frame, and
 * the exhibit would have had to become a cache of screenshots, which proves nothing.
 *
 * Two details that are deliberate rather than sloppy. Cells claimed on the same tick may be
 * claimed in either order and the result is identical, because the delay is a property of the
 * *target* and not of whoever reached it — so the queue can be a plain array with no tie to
 * break, which is the Lattice ordering rule satisfied by having no ordering question at all. And
 * the queue is not perfectly sorted: a slow cell at its head briefly holds up faster cells behind
 * it, by at most seven ticks. That is invisible, it is identical on every run, and buying strict
 * order would have cost a heap that only this module would ever use.
 */

import { fbm2, hash2, hashStep, mix32, toUnit } from '@latticekit/core';
import { TileGrid } from '@latticekit/iso';
import type { Camera, HeightField } from '@latticekit/iso';

/**
 * `N` is tiles per side: 56 × 64 world px is 3,584 across, which is 1.8× a 1440-px frame at the
 * opening zoom, where `docs/GALLERY.md` § Scale asks for at least 1.6 on the long axis.
 * `STEP_PX` is world pixels per height unit — heights are integers 0–240 so the field can be a
 * `TileGrid`, and the step buys the relief back at a sixteenth of a unit. `WET` is where the
 * water stops and `GLOW_TICKS` is how long a cell takes to glow in; the art reads both of those
 * and no decision does. `NEVER` is ground the bloom has not been promised to — a sentinel far
 * below any tick rather than −1, because the marsh is stepped through negative ticks before the
 * visitor's tick 0 and "claimed" cannot mean "non-negative" while it is.
 */
export const N = 56, STEP_PX = 0.8, MAX_HEIGHT_PX = 192, WET = 96, GLOW_TICKS = 40, NEVER = -1e9;

/** `arrival` is the tick each cell lights, or {@link NEVER}; `seeds` is what the visitor
 *  tapped, in the order they tapped it. */
export interface Marsh {
  readonly field: HeightField; readonly grid: TileGrid; readonly seeds: number[];
  readonly arrival: Int32Array; readonly queue: Int32Array;
  head: number; tail: number; lit: number; tick: number;
}

/**
 * Where the camera is at `tick` — a function of the tick and of nothing else.
 *
 * This is not decoration; it is the exhibit's sharpest finding made structural. A recorded sample
 * carries `sx`/`sy` — *screen* coordinates — and the tile it means is resolved through the camera
 * at the moment the tick closes. So the camera decides what every tap in the log refers to, and
 * **nothing in `InputLog` records it**: a tape replayed under a camera that has since been panned
 * puts its seeds on different tiles and reports a divergence that is not one.
 *
 * There are exactly two ways out. Record the camera yourself, in a field the kit does not define.
 * Or make it a function of the tick so that it replays by construction — which is this, in three
 * lines, and which is also why a re-run here reproduces the *frame* and not merely the numbers
 * behind it. The visitor pays for it by not being able to drag: `control: false`, on both
 * systems, because a camera the player can move is an input nobody is recording.
 */
export function viewAt(camera: Camera, tick: number): void {
  const sweep = Math.abs((tick % 3600) / 1800 - 1) - 0.5;   // a triangle wave, and Tier A
  camera.centerOnTile(N / 2 + sweep * 7, N / 2 - sweep * 7);
}

/**
 * A `Math.random()` in the rules — the panel's one setting that is refused by nothing.
 *
 * It is a property of the *build*, not of the session, which is what makes it the honest
 * demonstration: switch it on and the tape recorded by the build without it stops agreeing with
 * the build that has it. `@latticekit/loop`'s driver is documented as *"the one test in the kit
 * that fails when someone adds `Math.random()` to a system months from now"*. This is that
 * sentence, with a switch on it.
 *
 * It is held off until tick 60, and its rate is high rather than rare, and both of those are
 * about the *report* rather than about the fault. A divergence at tick 0 has no bracket, and the
 * bracket — *the bug is between these two numbers* — is the whole value of a checkpoint interval
 * and the thing this exhibit exists to put on screen. And a rare fault is worse than no switch at
 * all: at one slip in five hundred the tape came back **green** about one time in fifty, which on
 * an exhibit about falsifiability is the one outcome that must never be a coin flip. At one in
 * twenty, with dozens of cells claimed every tick, it fires within a tick or two of the gate and
 * lands in the second checkpoint's bracket every time.
 */
let drift = false;
export const setDrift = (on: boolean): void => void (drift = on);

/** Offer the bloom to a neighbour: fast through the water, slow up a ridge. Ground already
 *  promised keeps the promise it has. */
function reach(m: Marsh, c: number, tick: number): void {
  if ((m.arrival[c] ?? 0) > NEVER / 10) return;
  m.arrival[c] = tick + 26 + (m.grid.get(c % N, (c / N) | 0) >> 4) + (drift && tick > 60 && Math.random() < 0.05 ? 1 : 0);
  m.queue[m.tail++] = c;
}


/** Seed a bloom. Refuses off the map, and on ground the bloom already holds. */
export function plant(m: Marsh, gx: number, gy: number, tick: number): void {
  const c = gy * N + gx;
  if (gx < 0 || gy < 0 || gx >= N || gy >= N || (m.arrival[c] ?? 0) > NEVER / 10) return;
  m.seeds.push(c);
  m.arrival[c] = tick + 1;
  m.queue[m.tail++] = c;
}


/**
 * One tick: light everything due by now, and offer the four neighbours of each.
 *
 * The tick index arrives as an argument and is never counted here, so a driver starting at 0 and
 * a live loop that has been running since the page opened step this identically.
 */
export function step(m: Marsh, tick: number): void {
  m.tick = tick;
  while (m.head < m.tail && (m.arrival[m.queue[m.head] ?? 0] ?? 0) <= tick) {
    const c = m.queue[m.head++] ?? 0;
    m.lit += 1;
    if (c % N > 0) reach(m, c - 1, tick);
    if (c % N < N - 1) reach(m, c + 1, tick);
    if (c >= N) reach(m, c - N, tick);
    if (c < N * (N - 1)) reach(m, c + N, tick);
  }
}

/**
 * "The same pixel", reduced to a uint32.
 *
 * `arrival` is the whole of the state — the queue is derivable from it, and `lit` counts what has
 * already fired — so this covers everything the next tick reads and nothing the camera touched.
 * It is a fold of `hashStep`, which is `Math.imul` and shifts, so two conforming engines cannot
 * disagree about it.
 */
export function digest(m: Marsh): number {
  let h = mix32(m.tick ^ 0x9e3779b9);
  for (let i = 0; i < m.arrival.length; i++) h = hashStep(h, (m.arrival[i] ?? NEVER) + 1);
  return hashStep(h, m.lit) >>> 0;
}

/** A fresh marsh, minted from the seed alone. Same seed, same marsh, on any machine. */
export function createMarsh(seed: number): Marsh {
  const grid = new TileGrid(N + 1, N + 1, { bits: 16 });
  grid.fillFrom((gx, gy) => {
    const v = (fbm2(seed, gx * 0.045, gy * 0.045, 4) * 0.74 + fbm2(seed ^ 0x9e37, gx * 0.135, gy * 0.135, 3) * 0.38 + 0.46) * 300;
    return v < 0 ? 0 : v > 240 ? 240 : Math.round(v);
  });
  const m: Marsh = {
    field: { heights: grid, stepPx: STEP_PX }, grid, seeds: [], head: 0, tail: 0, lit: 0, tick: 0,
    arrival: new Int32Array(N * N).fill(NEVER), queue: new Int32Array(N * N),
  };
  // Three blooms, seeded before tick 0 and stepped up to it, so the first frame opens on
  // something already halfway across the marsh rather than on a marsh where something could
  // happen. The head start is part of the rules and therefore part of the digest: a re-run
  // walks these same 240 ticks before it reaches the first one the visitor ever saw.
  const spot = (h: number): number => 6 + ((toUnit(h) * (N - 12)) | 0);
  for (let i = 0; i < 3; i++) plant(m, spot(hash2(seed ^ 0x5eed, i, 11)), spot(mix32(hash2(seed ^ 0x5eed, i, 11))), -241);
  for (let t = -240; t < 0; t++) step(m, t);
  return m;
}
