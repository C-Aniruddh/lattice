/**
 * The things that stand on the floor, the arch a gate is, and the dust in the lamp.
 *
 * @art
 *
 * Delete this file and the cave is a painted heightfield with nothing in it: the gates still
 * exist, still hum, still open, and you would have no way to see where any of them are. Nothing
 * here decides anything — {@link Look} arrives already computed, and every number in it was read
 * off `Audio.onScheduled` by `main.ts`.
 *
 * ## A gate is a standing arch and not a door in a wall
 *
 * A door has to face somewhere, and a door facing the wrong way in a 2:1 projection is a black
 * rectangle. An arch standing free on the floor reads from every direction, needs no orientation
 * in the generator, and gives the exhibit the one shape it actually needs: **a ring**, carrying
 * exactly as many bright stones as the chord has notes, lighting one at a time as the gate
 * arpeggiates them. That ring is the visual half of the puzzle and it is why this shape was
 * chosen over a door.
 *
 * ## The formations have no array anywhere
 *
 * They are minted per frame from a hash of their own tile, inside a radius of the lamp, into a
 * pool that is refilled every frame and read once. That is not a line-rule dodge — it is the
 * cull § Scale asks for, arriving for free: a formation forty tiles away in a cave lit only by
 * what you are carrying is a shape nobody can see, and the cheapest way to draw it is not to.
 *
 * ## What is driven by sound and what is driven by the clock
 *
 * The arch's stones light from `onScheduled` — real scheduled voices, compared against the audio
 * clock, with no `AnalyserNode` anywhere. The crystals' shine, the dust and the drips run on
 * `pen.t`, because they are weather: they have to keep moving in a silent tab and in a browser
 * that refused a context, or the opening frame is a photograph of a cave.
 */
import { clamp01, hash2, noise2, toUnit, type Vec2 } from '@lattice/core';
import { gridToScreen, heightAt } from '@lattice/iso';
import {
  GROUND_LIFT,
  glowDot,
  isoBox,
  isoCylinder,
  isoPatch,
  mix,
  pxToLevels,
  withAlpha,
  type Pen,
} from '@lattice/draw';
import { CX, CY, type Cavern, type Gate } from './cavern.js';

/**
 * Everything the picture needs and nothing it can change: where the lamp is, how dark the cave
 * is, which gate is answering and what it is doing this instant.
 *
 * One object rather than eight parameters, because it crosses two art modules and a `Passes`
 * table, and eight positional numbers threaded through three call sites is where a `lampGy` ends
 * up in a `lampZ`. It is rebuilt in `main.ts` once per frame; nothing here retains it.
 */
export interface Look {
  /** The one gate the lamp is over, or nothing. */
  readonly gate: Gate | undefined;
  /**
   * The audio clock this frame, and the three instants everything that pulses is measured from.
   *
   * **Instants and not levels**, which is the one structural decision in this interface. A `beat`
   * that `main.ts` decayed per frame would be visual state living in the logic module, and the
   * line rule would be right to charge for it; an instant is a fact about a voice that was
   * scheduled, and how brightly it reads is a question only the picture has. It also means a
   * dropped frame cannot desynchronise the glow from the sound: both are read off `Audio.now()`
   * on the frame that draws, rather than integrated across the frames that did not.
   */
  readonly now: number;
  /** When the most recent voice of any kind was scheduled for. */
  readonly voiceAt: number;
  /** When a wrong answer was given. */
  readonly refusedAt: number;
  /** The current hum's note times, and how many of them are live. */
  readonly notes: Readonly<Float64Array>;
  readonly noteCount: number;
  /** Where the lamp is, in tiles — the camera's own center. */
  readonly lampGx: number;
  readonly lampGy: number;
  /** 0–1, gates opened. The darkness, the palette and the bed all come off this one number. */
  readonly progress: number;
}

/** How hard the last voice is still ringing, 0–1. The light's pulse and the ring's both read it,
 *  so there is one decay curve in this exhibit and not two that can disagree. */
export function beatOf(look: Look): number {
  return clamp01(1 - (look.now - look.voiceAt) * 2.2);
}

/** A formation, pooled. Mutable because it is refilled in place sixty times a second. */
export interface Spire {
  gx: number;
  gy: number;
  kind: number;
  h: number;
  zPx: number;
}

/** Stones on a gate's arch, formations kept per frame, and motes in the lamp. */
const STONES = 11;
const SPIRE_MAX = 420;
const MOTES = 64;
/** Tiles of lamp-radius the formations are minted inside. Past it nothing is lit enough to see. */
export const SPIRE_REACH = 24;

const pool: Spire[] = [];
let live = 0;
const pt: Vec2 = { x: 0, y: 0 };

/**
 * Snap a brightness to a handful of levels before it can reach `softEllipse` — directly, or through
 * {@link glowDot}, which is `softEllipse` wearing a friendlier name.
 *
 * **This is the single most important line in this module and it is not a rounding nicety.**
 * `canvas2d`'s `rampFor` keys its radial-ramp cache on the *exact* `(inner, outer)` pair with no
 * quantization, and evicts **wholesale** — `ramps.clear()` at 96 entries. So one continuously
 * varying color misses every frame, and each miss allocates a `<canvas>`, a context, a gradient
 * and a fill; worse, it takes every constant-color call site down with it. `examples/crowd`
 * measured 3.74 misses a frame and about 3.7 MB/s of garbage from twenty-seven animated flames.
 *
 * This exhibit is the worst possible shape for that trap. Its glow is driven from
 * `Audio.onScheduled`, so the color moves on **every voice**, and it moves hardest during the one
 * thing every player does first — mashing all six strings — which is already the heaviest frame
 * and the loudest moment. And the cost lands differently here than anywhere else in the gallery:
 * a GC pause is *audible*, because the ring answering a note and the note itself come apart and
 * a player reads that as the puzzle being wrong rather than the renderer being late.
 *
 * The split is a happy one. **The timing is the mechanic and stays exact; only the brightness is
 * snapped.** Six levels is six ramps for the life of the page, and nobody can see the step.
 */
export function snapGlow(a: number): number {
  return Math.round(clamp01(a) * LEVELS) / LEVELS;
}

/**
 * How many brightness levels every glow in this exhibit is allowed.
 *
 * Six rather than sixteen, and the number is a **budget** rather than a taste: the ramp cache
 * holds 96 pairs and clears wholesale when it fills, so the exhibit has to fit *all* of its
 * softEllipse colors inside that. Six levels across three light inks is 36 pairs for the lamps,
 * about 21 for the arches and under ten for the lichen — call it 65, with room for the palette
 * to warm underneath it as gates open. Sixteen levels would not fit and the symptom would be a
 * page that ran beautifully for a minute and then started dropping a frame every second.
 */
const LEVELS = 6;

/** Project a world point and apply the frame's pixel snap. */
function screen(pen: Pen, gx: number, gy: number, zPx: number): Vec2 {
  gridToScreen(pen.camera, gx, gy, zPx, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * Mint the formations standing within reach of the lamp, into the pool. Returns how many.
 *
 * Read them back with {@link spireAt}. Nothing is allocated after the first few frames: the pool
 * grows to its high-water mark and every entry is overwritten in place thereafter.
 */
export function mintSpires(cave: Cavern, cx: number, cy: number): number {
  live = 0;
  const lo = Math.max(1, Math.round(cx) - SPIRE_REACH);
  const hi = Math.min(cave.rock.w - 2, Math.round(cx) + SPIRE_REACH);
  const lo2 = Math.max(1, Math.round(cy) - SPIRE_REACH);
  const hi2 = Math.min(cave.rock.h - 2, Math.round(cy) + SPIRE_REACH);
  for (let gy = lo2; gy <= hi2 && live < SPIRE_MAX; gy += 1) {
    for (let gx = lo; gx <= hi && live < SPIRE_MAX; gx += 1) {
      if (cave.rock.get(gx, gy) > 5) continue;
      const roll = hash2(cave.seed ^ 0x3c19, gx, gy);
      if (toUnit(roll) > 0.18) continue;
      let spire = pool[live];
      if (spire === undefined) {
        spire = { gx: 0, gy: 0, kind: 0, h: 1, zPx: 0 };
        pool.push(spire);
      }
      spire.gx = gx;
      spire.gy = gy;
      spire.kind = roll % 7 === 0 ? 2 : roll % 2;
      spire.h = 0.35 + toUnit(roll >>> 9) * 1.5;
      spire.zPx = heightAt(cave.field, gx, gy);
      live += 1;
    }
  }
  return live;
}

/** The `i`th formation minted this frame, or `undefined`. */
export function spireAt(index: number): Spire | undefined {
  return pool[index];
}

/** One formation. Three kinds, and the third glows, so a walked cave has landmarks that are
 *  not gates and a player can tell one junction from another. */
export function paintSpire(pen: Pen, spire: Spire): void {
  const z = pxToLevels(spire.zPx);
  if (spire.kind === 0) {
    isoCylinder(pen, spire.gx, spire.gy, 0.26, { color: 'rock', h: spire.h * 0.7, z });
    isoCylinder(pen, spire.gx, spire.gy, 0.13, { color: 'rock', h: spire.h * 0.9, z: z + spire.h * 0.7, outline: false });
  } else if (spire.kind === 1) {
    isoCylinder(pen, spire.gx, spire.gy, 0.19, { color: 'rock', h: spire.h * 2.6, z, topColor: 'damp' });
  } else {
    const shine = snapGlow(0.35 + Math.sin(pen.t * 0.7 + spire.h * 9) * 0.25); /* @tier-b pixels only */
    isoCylinder(pen, spire.gx, spire.gy, 0.15, { color: 'damp', h: spire.h * 0.8, z });
    glowDot(pen, spire.gx, spire.gy, z + spire.h * 0.8, 'vein', 0.13, shine);
  }
}

/**
 * A gate: a plinth, two uprights, and an arch of eleven stones with the chord's own stones on it.
 *
 * The bright stones are spread evenly across the arch rather than mapped to a string, on purpose.
 * A ring whose left stone always meant the lowest string would turn this into a game you can
 * *read*, and the exhibit's one idea is a game you can only hear. What the ring shows is how many
 * notes there are and when each lands — the rhythm, never the pitch.
 */
export function paintGate(pen: Pen, gate: Gate, look: Look): void {
  const z = pxToLevels(gate.zPx);
  const active = look.gate === gate;
  const beat = active ? beatOf(look) : 0;
  // Snapped to four levels, because it feeds a *color* — see {@link step8}. The fade still
  // reads as a fade; what it must not do is mint a gradient canvas on every frame of it.
  const refused = active ? Math.round(clamp01(1 - (look.now - look.refusedAt) * 1.4) * 2) / 2 : 0;
  // How many of the chord's notes have been reached on the audio clock. This is the whole of the
  // `onScheduled` promise made visible: real scheduled voices, compared against `Audio.now()`,
  // with no `AnalyserNode` and no second timeline running beside the first.
  let lit = 0;
  if (active) for (let i = 0; i < look.noteCount; i += 1) if ((look.notes[i] ?? 0) <= look.now) lit += 1;
  const warm = pen.palette.get('ember');
  const hue = gate.open ? warm : mix(pen.palette.get('vein'), pen.palette.get('bad'), refused);

  // A low sill and two slim jambs, both deliberately understated: a hundred gates with a bright
  // plinth each is a frame of plates, which is what the first build shipped and what made the
  // cave read as scattered platforms rather than as rock with holes in it. The *arch* is the
  // object; the stonework is only what it stands on.
  isoBox(pen, gate.gx - 0.1, gate.gy + 0.15, 1.2, 0.7, { color: mix(pen.palette.get('rock'), pen.palette.get('ink'), 0.45), h: 0.18, z });
  if (gate.open) isoPatch(pen, gate.gx - 0.3, gate.gy - 0.3, 1.7, 1.7, z + GROUND_LIFT, withAlpha(warm, 0.45));
  isoCylinder(pen, gate.gx - 0.05, gate.gy + 0.5, 0.11, { color: 'metal', h: 1.5, z: z + 0.18 });
  isoCylinder(pen, gate.gx + 1.05, gate.gy + 0.5, 0.11, { color: 'metal', h: 1.5, z: z + 0.18 });

  // The arch, in the gx–z plane: eleven structural stones, dim, so the ring exists in the dark
  // even when nothing is sounding, and bright enough at rest to be the thing you steer toward.
  const idle = snapGlow(gate.open ? 0.8 : 0.22 + beat * 0.4 + (active ? 0.16 : 0));
  for (let i = 0; i < STONES; i += 1) {
    const a = (i / (STONES - 1)) * Math.PI;
    glowDot(pen, gate.gx + 0.5 - Math.cos(a) * 0.62, gate.gy + 0.5, z + 1.65 + Math.sin(a) * 1.5, hue, 0.11, idle); /* @tier-b pixels only */
  }
  // The chord's own stones, lighting in the order the notes were scheduled for.
  for (let n = 0; n < gate.size; n += 1) {
    const a = ((n + 1) / (gate.size + 1)) * Math.PI;
    const on = gate.open ? 1 : n < lit ? 1 : 0.26;
    glowDot(pen, gate.gx + 0.5 - Math.cos(a) * 0.62, gate.gy + 0.5, z + 1.65 + Math.sin(a) * 1.5, hue, 0.26, on); /* @tier-b pixels only */
  }
}

/**
 * Dust in the lamp and water off the roof, in the Overlay pass.
 *
 * Above the mask, because a mote is a thing catching the light rather than a thing the light has
 * to reach. Both populations are closed form in `pen.t` and a hash of their own index, so they
 * cost no state and are identical on every reload of a seed — and they run on the very first
 * frame, before any gesture, which is the whole of what stands between a dark cave and a
 * screenshot of a dark cave.
 */
export function drawDust(pen: Pen, cave: Cavern, cx: number, cy: number): void {
  const s = pen.surface;
  const k = pen.camera.zoom;
  const pale = mix(pen.palette.get('glass'), 0xffffffff, 0.4);
  for (let i = 0; i < MOTES; i += 1) {
    const gx = cx - 11 + toUnit(hash2(cave.seed ^ 0x7c11, i, 1)) * 22 + noise2(cave.seed, i * 1.9, pen.t * 0.13) * 4;
    const gy = cy - 11 + toUnit(hash2(cave.seed ^ 0x7c11, i, 2)) * 22 + noise2(cave.seed, i * 8.1, pen.t * 0.11) * 4;
    const p = screen(pen, gx, gy, 8 + ((pen.t * 5 + i * 31) % 70));
    const fade = clamp01(1.2 - (Math.abs(gx - cx) + Math.abs(gy - cy)) / 16);
    s.ellipse(p.x, p.y, 1.2 * k, 1.2 * k, withAlpha(pale, fade * 0.3));
  }
  // Twenty drips on a slow loop. Nothing else in this exhibit falls, and one thing falling is
  // what makes the rest read as still rather than as frozen.
  const water = pen.palette.get('glass');
  for (let i = 0; i < 20; i += 1) {
    const gx = CX + (toUnit(hash2(cave.seed ^ 0x11a3, i, 1)) - 0.5) * 76;
    const gy = CY + (toUnit(hash2(cave.seed ^ 0x11a3, i, 2)) - 0.5) * 76;
    const cycle = (pen.t * 0.55 + toUnit(hash2(cave.seed ^ 0x11a3, i, 3))) % 1;
    const p = screen(pen, gx, gy, 130 - cycle * 130);
    s.ellipse(p.x, p.y, 0.9 * k, 3.2 * k, withAlpha(water, (1 - cycle) * 0.4));
  }
}


