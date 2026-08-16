/**
 * The kit's own parameters, as controls — one per knob, each with the wrong end it has.
 *
 * ```ts
 * controlPanel(
 *   [
 *     { kind: 'group', label: 'camera' },
 *     knobs.minZoom(boot),
 *     knobs.keepVisible(boot),
 *     { kind: 'group', label: 'touch' },
 *     knobs.tapSlop(boot),
 *   ],
 *   { params: boot.params, title: 'Island' },
 * );
 * ```
 *
 * Every entry here names a real parameter of a real package and has been checked against that
 * package's source, not against its README. Where a knob has a documented failure at one end,
 * that end is marked and the failure is quoted in the caption — the wording comes from the doc
 * comment defending the default, so the panel and the package cannot drift apart.
 *
 * ## The thing this file discovered
 *
 * **Most kit parameters are construction-time, and the kit exposes no way to move them.** There
 * is no `camera.setZoomLimits`, `input.setProfile`, `field.setBloom` or `audio.setMaxVoices`;
 * `CameraOptions`, `GestureProfile`, `LightFieldOpts` and `AudioOptions` are all read once and
 * closed over, and three of the four are not even readable back off the object afterwards. So a
 * knob that moves one of them is not a setter call — it is *rebuild the subsystem and carry the
 * state across*, which is why {@link Boot.setCamera}, {@link Boot.setProfile} and
 * {@link Boot.setLight} exist and why every control here that uses one is `commit: 'change'`.
 *
 * That is a gallery workaround for a kit gap, and it is filed as one. It also has a visible
 * cost the panel does not hide: a rebuild drops the camera's glide and reallocates two render
 * targets, so those sliders act on release rather than under the finger.
 *
 * The one family that needs none of this is `sim`'s: an `OfflineCurve` is plain data handed to
 * `offlineCredit` per call, so its three knobs are genuinely live. It is worth noticing which
 * shape made that possible.
 */

import type { OfflineCurve } from '@lattice/sim';
import type { Boot } from './bootstrap.js';
import type { RangeControl, ToggleControl, TextControl } from './panel.js';

/**
 * A mutable holder for a value the exhibit reads every frame.
 *
 * `OfflineCurve` and friends are frozen records the kit takes by argument, so a knob cannot
 * mutate one in place; it replaces the whole record and the exhibit reads it back out of here.
 */
export interface Box<T> {
  value: T;
}

/** What a knob needs from an exhibit for a parameter this module cannot reach on its own. */
export interface Knob<T> {
  /** The value in force now. */
  readonly value: T;
  /** Put a new one in force. For a construction-time parameter this rebuilds something. */
  apply(value: T): void;
}

// ── @lattice/iso — the camera ────────────────────────────────────────────────────────────────

/**
 * How far out the player may pull.
 *
 * The wrong end is out: `iso` defends the default with "below this the art stops being readable
 * and the depth sort starts costing more than the pixels are worth", and both halves of that
 * are visible at 0.1 — the world becomes a smear, and the frame-time readout climbs because
 * every tile in the map is now on screen and in the sort.
 */
export function minZoom<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'minZoom',
    label: 'zoom out limit',
    param: '@lattice/iso CameraOptions.minZoom',
    min: 0.05,
    max: 2,
    step: 0.05,
    value: boot.cameraPolicy.minZoom,
    commit: 'change',
    wrong: {
      below: 0.2,
      says: 'Below about 0.2 the art stops being readable and every tile in the map is in the depth sort at once. Watch the frame time.',
    },
    apply: (v) => boot.setCamera({ minZoom: v, maxZoom: Math.max(v, boot.cameraPolicy.maxZoom) }),
  };
}

/** How far in. Vector art costs nothing to magnify, so this one has no wrong end — which is
 *  itself worth showing beside one that does. */
export function maxZoom<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'maxZoom',
    label: 'zoom in limit',
    param: '@lattice/iso CameraOptions.maxZoom',
    min: 0.5,
    max: 8,
    step: 0.1,
    value: boot.cameraPolicy.maxZoom,
    commit: 'change',
    apply: (v) => boot.setCamera({ maxZoom: v, minZoom: Math.min(v, boot.cameraPolicy.minZoom) }),
  };
}

/**
 * How much of the world must stay on screen after any gesture.
 *
 * Both ends are wrong and the panel can only mark one, so the caption names both. At 0 you can
 * fling the world away and be left on empty ground with nothing to tap and no way to know which
 * direction is back — which is the exact failure the default exists for, and it takes one
 * flick to reproduce.
 */
export function keepVisible<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'keepVisible',
    label: 'keep on screen',
    param: '@lattice/iso CameraOptions.keepVisible',
    min: 0,
    max: 1,
    step: 0.05,
    value: boot.cameraPolicy.keepVisible,
    commit: 'change',
    wrong: {
      below: 0.05,
      says: 'At 0 one flick strands you on empty ground with nothing to tap and no cue which way is back. At 1 the map is pinned and feels stuck.',
    },
    apply: (v) => boot.setCamera({ keepVisible: v }),
  };
}

// ── @lattice/input — the gestures ────────────────────────────────────────────────────────────

/**
 * The travel above which a press is a drag and never a tap.
 *
 * The canonical wrong end, and the one worth having a phone for. `input` shipped 9 px for touch
 * after tuning against real hands: a fingertip's contact patch shifts several pixels during a
 * press people experience as perfectly still, and the reported point moves as the patch grows.
 * At 1 px every one of those presses is a one-pixel drag and nothing in the exhibit can be
 * tapped at all — on a mouse it still works, which is exactly how the bug ships.
 *
 * All three pointer kinds move together here, because a visitor on a laptop who moves only
 * `touch` sees nothing happen and concludes the slider is broken.
 */
export function tapSlop<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'tapSlop',
    label: 'tap slop',
    param: '@lattice/input GestureProfile.tapSlopPx',
    note: 'Defaults: touch 9, mouse 4, pen 6.',
    min: 1,
    max: 30,
    step: 1,
    // Read off the live profile, not written as 9: `bootstrap` has already applied whatever the
    // URL asked for, and a knob that declared the shipped default instead would notice a
    // mismatch and rebuild the whole input system once more during boot for no reason.
    value: boot.input.profile.tapSlopPx.touch,
    commit: 'change',
    format: (v) => `${String(v)} px`,
    wrong: {
      below: 4,
      says: 'A fingertip moves several pixels during a press that feels still. Below about 4 every tap on a touchscreen becomes a one-pixel drag and nothing here can be tapped.',
    },
    apply: (v) => boot.setProfile({ tapSlopPx: { touch: v, mouse: v, pen: v } }),
  };
}

/**
 * How long a still press must last to become a long press.
 *
 * Counted in whole ticks, so the effective value is `ceil(longPressMs / stepMs) * stepMs` — a
 * detail the readout deliberately does not hide, because it is the reason `stepMs` has to be
 * the loop's own.
 */
export function longPress<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'longPress',
    label: 'long press',
    param: '@lattice/input GestureProfile.longPressMs',
    min: 60,
    max: 1200,
    step: 10,
    value: boot.input.profile.longPressMs,
    commit: 'change',
    format: (v) => `${String(v)} ms`,
    wrong: {
      below: 200,
      says: 'iOS long-press is ~500 ms and Android ~400. Below about 350 it fires during ordinary taps; at 60 every tap is a long press.',
    },
    apply: (v) => boot.setProfile({ longPressMs: v }),
  };
}

/** The half-life of the camera's glide after a flick. Long is the wrong end and you can feel it
 *  in one drag: the camera arrives somewhere you did not choose, seconds after you let go. */
export function flingHalfLife<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'flingHalfLife',
    label: 'glide half-life',
    param: '@lattice/input GestureProfile.flingHalfLifeMs',
    min: 0,
    max: 1500,
    step: 10,
    value: boot.input.profile.flingHalfLifeMs,
    commit: 'change',
    format: (v) => `${String(v)} ms`,
    wrong: {
      above: 700,
      says: 'The default coasts a 1200 px/s flick about 260 px. Past ~700 ms the camera is still moving when your next gesture starts, and the two fight.',
    },
    apply: (v) => boot.setProfile({ flingHalfLifeMs: Math.max(1, v) }),
  };
}

/** Below this release speed a drag stops dead instead of gliding. Near zero, every drag drifts
 *  and the camera can never be placed exactly — which is the floor's entire reason to exist. */
export function flingFloor<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'flingFloor',
    label: 'glide floor',
    param: '@lattice/input GestureProfile.flingMinPxPerS',
    min: 1,
    max: 600,
    step: 5,
    value: boot.input.profile.flingMinPxPerS,
    commit: 'change',
    format: (v) => `${String(v)} px/s`,
    wrong: {
      below: 15,
      says: 'Without a floor every drag drifts after the finger lifts, so the camera can never be put exactly where you want it.',
    },
    apply: (v) => boot.setProfile({ flingMinPxPerS: v }),
  };
}

// ── @lattice/draw — the night, and the pixels ────────────────────────────────────────────────

/**
 * How much accumulated light is added back as warm spill.
 *
 * The wrong end is quoted from the field's own doc comment: above about 0.6 an 8-bit buffer
 * blows out to white wherever two lamps meet. It is the single most legible failure in the kit
 * — drag it up in any lit scene and the overlap between two pools turns into a flat white
 * lozenge with a hard edge.
 */
export function lightBloom<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'lightBloom',
    label: 'bloom',
    param: '@lattice/draw LightFieldOpts.bloom',
    min: 0,
    max: 1,
    step: 0.02,
    value: boot.lightOpts.bloom,
    commit: 'change',
    wrong: {
      above: 0.6,
      says: 'Above about 0.6 an 8-bit buffer blows out to white wherever two pools meet. At 0 a pool is a hole in the dark and nothing more.',
    },
    apply: (v) => boot.setLight({ bloom: v }),
  };
}

/**
 * The light buffer's resolution relative to the surface.
 *
 * This is the one place in the kit that deliberately renders soft, and the slider is how you
 * find out what that bought: 1.0 is two full-screen RGBA targets at device resolution — 20 MB
 * resident and four times the fill rate — for a difference you will struggle to point at.
 * Open the frame-time readout before you move it.
 */
export function lightScale<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'lightScale',
    label: 'light buffer',
    param: '@lattice/draw LightFieldOpts.scale',
    min: 0.1,
    max: 1,
    step: 0.05,
    value: boot.lightOpts.scale,
    commit: 'change',
    format: (v) => `${String(Math.round(v * 100))}%`,
    wrong: {
      above: 0.9,
      says: 'At 1.0 this is two full-screen RGBA targets at device resolution: 20 MB resident and 4× the fill rate, for a softness nobody can point at.',
    },
    apply: (v) => boot.setLight({ scale: v }),
  };
}

/**
 * The pool's falloff exponent, expressed as a plateau.
 *
 * 1 is a pure linear ramp from the center; 2 holds full intensity to half the radius; 4 is a
 * disc with a soft rim. Neither end is *wrong* so much as a different look, which is why this
 * one carries no marker — a panel where everything is dangerous teaches as little as one where
 * nothing is.
 *
 * Note this only sets the field's **default**: `LightField.add` takes `falloff` per call, so an
 * exhibit that passes one per lamp will not see this move.
 */
export function lightFalloff<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'lightFalloff',
    label: 'pool edge',
    param: '@lattice/draw LightFieldOpts.falloff',
    note: 'The default only. LightField.add overrides it per light.',
    min: 1,
    max: 6,
    step: 0.1,
    value: boot.lightOpts.falloff,
    commit: 'change',
    apply: (v) => boot.setLight({ falloff: v }),
  };
}

/**
 * Whole-device-pixel snapping.
 *
 * Off is the wrong end and it is a two-second demonstration: turn it off and pan, and every
 * 1 px stroke in the scene shimmers between one and two device pixels while terrain seams open
 * and close. It is on by default for that reason, and the cost of having it is two adds per
 * point.
 */
export function snap<A extends string>(boot: Boot<A>): ToggleControl {
  return {
    kind: 'toggle',
    key: 'snap',
    label: 'pixel snap',
    param: '@lattice/draw FrameOpts.snap',
    value: true,
    wrong: {
      when: false,
      says: 'Pan now. Every 1 px stroke shimmers between one and two device pixels and terrain seams open and close.',
    },
    apply: (v) => boot.setSnap(v),
  };
}

/**
 * The surface's device pixel ratio.
 *
 * `createCanvas2dSurface` clamps the device's own ratio to 2 by default, and this is how you see
 * why: 3 on a phone is 2.25× the pixels of 2 for a difference no display can show, and the
 * frame-time readout says so immediately.
 */
export function pixelRatio<A extends string>(boot: Boot<A>): RangeControl {
  return {
    kind: 'range',
    key: 'dpr',
    label: 'pixel ratio',
    param: '@lattice/draw Canvas2dOpts.pixelRatio',
    note: `This device reports ${String(devicePixelRatio)}; the kit clamps to 2.`,
    min: 0.25,
    max: 4,
    step: 0.25,
    value: boot.surface.pixelRatio,
    commit: 'change',
    format: (v) => `${v.toFixed(2)}×`,
    wrong: {
      above: 2.5,
      says: 'Past the kit’s clamp of 2 the fill rate rises with the square and the picture does not change. Watch the frame time.',
    },
    apply: (v) => boot.setPixelRatio(v),
  };
}

// ── @lattice/sim — the offline curve, which is the family that got the shape right ───────────

/**
 * The softcap exponent on an absence.
 *
 * **The canonical wrong end.** At 1.0 the curve is the identity: a fourteen-hour absence is
 * credited fourteen hours, second for second, and closing the tab becomes the optimal way to
 * play. `sim` refuses anything above 1 outright — "above 1 pays a bonus for leaving, which is
 * not a softcap" — so 1.0 is as far wrong as the kit will let you go, and it is far enough.
 *
 * Prefer a dyadic rational with denominator ≤ 64 (0.5, 0.625, 0.75) and the credited time is
 * Tier A — bit-identical on every engine — for free. That is why this slider steps in 64ths and
 * the readout shows the fraction: 0.6 and 0.625 are three per cent apart in reward and a whole
 * determinism tier apart in kind, and you can see the tier change as you drag past it.
 */
export function offlineExponent(curve: Box<OfflineCurve>): RangeControl {
  return {
    kind: 'range',
    key: 'offlineExp',
    label: 'offline exponent',
    param: '@lattice/sim OfflineCurve.exponent',
    note: 'Steps of 1/64, so every value here is Tier A: bit-identical on every engine.',
    min: 1 / 64,
    max: 1,
    step: 1 / 64,
    value: curve.value.exponent,
    format: (v) => `${v.toFixed(4)}  (${String(Math.round(v * 64))}/64)`,
    wrong: {
      above: 1,
      says: 'At 1.0 the curve is the identity: fourteen hours away credits fourteen hours, and closing the tab is the optimal way to play.',
    },
    apply: (v) => {
      curve.value = { ...curve.value, exponent: v };
    },
  };
}

/**
 * How long an absence is credited second for second before the softcap begins.
 *
 * A design constraint and not only a generosity dial: if anything in the economy accrues on a
 * cycle — a nightly bill, an upkeep that bites only after dark — this must exceed that cycle's
 * period by a wide margin, or the cycle is skippable by closing the tab. Drag it under one day
 * in an exhibit with a day/night economy and watch the night stop costing anything.
 */
export function offlineUncapped(curve: Box<OfflineCurve>): RangeControl {
  return {
    kind: 'range',
    key: 'offlineFree',
    label: 'free window',
    param: '@lattice/sim OfflineCurve.uncappedSeconds',
    min: 60,
    max: 24 * 3600,
    step: 60,
    value: curve.value.uncappedSeconds,
    format: (v) => `${(v / 3600).toFixed(2)} h`,
    apply: (v) => {
      curve.value = { ...curve.value, uncappedSeconds: v, flatAfterSeconds: Math.max(v, curve.value.flatAfterSeconds) };
    },
  };
}

/**
 * The horizon past which nothing more is credited.
 *
 * This is the whole upper clamp on an offline gap — a device clock a year fast credits
 * `maxOfflineCredit(curve)` and not a year, because the *input* is clamped here before the
 * power is taken. There is no second cap anywhere in `sim` and no configuration for one.
 */
export function offlineHorizon(curve: Box<OfflineCurve>): RangeControl {
  return {
    kind: 'range',
    key: 'offlineFlat',
    label: 'horizon',
    param: '@lattice/sim OfflineCurve.flatAfterSeconds',
    min: 3600,
    max: 30 * 24 * 3600,
    step: 3600,
    value: curve.value.flatAfterSeconds,
    format: (v) => `${(v / 3600).toFixed(0)} h`,
    wrong: {
      above: 20 * 24 * 3600,
      says: 'This is the only clamp on an offline gap. Far out here a device clock that is wrong by a month pays out a month.',
    },
    apply: (v) => {
      curve.value = { ...curve.value, flatAfterSeconds: Math.max(v, curve.value.uncappedSeconds) };
    },
  };
}

// ── @lattice/audio — the ceiling ─────────────────────────────────────────────────────────────

/**
 * The hard ceiling on one-shot voices in flight.
 *
 * **The canonical audible wrong end.** At 2, `play` starts returning `false` for the third
 * simultaneous voice and a burst — the thing every player does first, which is mash everything
 * at once — comes back as a stutter with holes in it. `Audio.play` returns whether it was
 * *accepted*, so an exhibit that shows the rejection rate beside this slider makes the ceiling
 * legible as well as audible.
 *
 * `maxVoices` is read once by `createAudio` and there is no setter, so the exhibit must supply
 * a `Knob` whose `apply` disposes the engine and builds a new one. It is `commit: 'change'` for
 * a reason that is not politeness: `Audio.dispose` closes the `AudioContext`, browsers cap how
 * many one document may open — six, historically — and a live drag would exhaust that cap in
 * about a second and leave the exhibit permanently silent.
 */
export function voiceCeiling(audio: Knob<number>): RangeControl {
  return {
    kind: 'range',
    key: 'voices',
    label: 'voice ceiling',
    param: '@lattice/audio AudioOptions.maxVoices',
    note: 'Rebuilds the engine on release: there is no setter, and the context cap is six.',
    min: 1,
    max: 32,
    step: 1,
    value: audio.value,
    commit: 'change',
    wrong: {
      below: 4,
      says: 'Now play everything at once. Past the ceiling, play() returns false and the burst comes back with holes in it.',
    },
    apply: (v) => audio.apply(v),
  };
}

// ── @lattice/core — the world ────────────────────────────────────────────────────────────────

/**
 * The seed.
 *
 * Reloads, because a seed change rebuilds the world and every exhibit generates its world once
 * at boot. That is the honest implementation: the alternative is a `regenerate()` every exhibit
 * has to write and keep correct, and getting it half right is a world that is partly the old
 * seed's.
 */
export function seed<A extends string>(boot: Boot<A>): TextControl {
  return {
    kind: 'text',
    key: 'seed',
    label: 'seed',
    param: '@lattice/core createRng(seed)',
    note: 'Same seed, same world, same pixel. Changing it reloads.',
    value: boot.seed,
    placeholder: 'anything',
    apply: (v) => {
      const next = new URLSearchParams(location.search);
      if (v === '') next.delete('seed');
      else next.set('seed', v);
      location.search = next.toString();
    },
  };
}

/**
 * A frame-time readout for {@link PanelOptions.stats}.
 *
 * `loop.stats` is a live object the loop updates in place, so this reads it rather than
 * subscribing to anything. The panel samples it twice a second and only while it is open.
 */
export function frameTime<A extends string>(boot: Boot<A>): () => string {
  return () => `${boot.loop.stats.frameMs.toFixed(1)}ms · ${String(Math.round(boot.loop.stats.fps))}fps`;
}
