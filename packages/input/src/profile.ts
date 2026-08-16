/**
 * Every number that decides what a gesture is, in one place, with its derivation beside it.
 *
 * A magic `9` inside a `pointermove` handler is a number nobody can argue with: it cannot be
 * overridden, it cannot be compared against another game's, and the next person to tune it has
 * no way to know whether it came from a measurement or from a mood. Every default here carries
 * the reason it is that number, because the reasons are the part that does not survive a
 * refactor.
 *
 * **A profile is part of a replay's identity.** The same finger movements under a tap slop of
 * 8 px and of 12 px are a different sequence of actions, so {@link profileFingerprint} goes
 * into every recorded log and `@lattice/persist` refuses a replay whose fingerprint differs
 * rather than migrating it. That is why this module owns a canonical encoding and not merely
 * a set of numbers.
 *
 * Pure: no clock, no DOM, no allocation outside the two constructors.
 */

import { expectFinite, expectInt } from '@lattice/core';

/**
 * What the player is touching the game with.
 *
 * Not decoration: {@link GestureProfile.tapSlopPx} differs per kind by more than a factor of
 * two, and a recogniser that uses one threshold for all three either eats every short mouse
 * drag or turns half of a phone's taps into one-pixel drags.
 */
export type PointerKind = 'mouse' | 'touch' | 'pen';

/**
 * Every threshold the recogniser and the camera controller consult.
 *
 * Named in one interface so that a game that needs a different feel changes data rather than
 * forking a state machine, and so that a recorded session can carry the exact rules it was
 * recognised under. See the table in this module's source for the derivation of each default.
 */
export interface GestureProfile {
  /**
   * Travel above which a press is a drag and never a tap, in CSS pixels, per device.
   *
   * | kind | default | why |
   * |---|---:|---|
   * | `touch` | 9 | A fingertip's contact patch shifts several pixels during a press people experience as perfectly still, and the reported point moves as the patch grows. Shipped at 9 in the source game after tuning against real hands: below ~6 half the taps on a phone become one-pixel drags, above ~12 a deliberate small pan opens whatever was under the finger. |
   * | `mouse` | 4 | Windows' `SM_CXDRAG`. A mouse does not wobble, so touch's 9 would eat every short deliberate drag and make the camera feel stuck. |
   * | `pen` | 6 | A stylus wobbles more than a mouse and far less than a finger, and pen users make small deliberate movements. Between the two, nearer the mouse. |
   */
  readonly tapSlopPx: Readonly<Record<PointerKind, number>>;

  /**
   * How long a still press must last to become a `longpress`, in milliseconds.
   *
   * 450: iOS long-press is ~500 ms and Android ~400, so inside that band the duration is one
   * people's hands already know. Below ~350 it fires during ordinary taps; above ~600 people
   * let go first and report it broken. Counted in whole ticks, so the effective value is
   * `ceil(longPressMs / stepMs) * stepMs`.
   */
  readonly longPressMs: number;

  /**
   * How much the finger spread must change before a two-finger gesture is a pinch, in CSS
   * pixels.
   *
   * 12: two fingers never land in the same tick and the spread jitters as the second settles.
   * Without a start threshold every two-finger pan zooms slightly, which reads as the map
   * "breathing".
   */
  readonly pinchStartPx: number;

  /**
   * The smallest spread the scale ratio may be divided by, in CSS pixels.
   *
   * 24: the scale factor is a ratio of spreads, so near-touching fingers make its denominator
   * tiny and one noisy sample teleports the zoom.
   */
  readonly pinchMinSpreadPx: number;

  /**
   * CSS pixels per line for `WheelEvent.deltaMode === 1`.
   *
   * 16: Firefox reports 3 lines where Chrome reports 100 pixels, so without this conversion
   * the same flick zooms about 30× less on Firefox.
   */
  readonly wheelLinePx: number;

  /**
   * CSS pixels per page for `WheelEvent.deltaMode === 2`.
   *
   * 400: rare, and one page of scroll is about one viewport.
   */
  readonly wheelPagePx: number;

  /**
   * Zoom per normalised wheel pixel: `scale = exp(-dz * rate)`.
   *
   * 0.0016. Exponential rather than additive, so a notch feels the same at 0.6× and at 4× and
   * wheeling up then down returns exactly where you started; additive zoom is unusable above
   * 2×. 0.0016 puts a typical 100 px notch at ~1.17×, close to {@link keyZoomStep}.
   */
  readonly wheelZoomRate: number;

  /**
   * The same, for a trackpad pinch — which arrives as a `wheel` with `ctrlKey` set and much
   * smaller deltas.
   *
   * 0.0100: using the scroll rate for it makes pinch-to-zoom on a laptop feel dead.
   */
  readonly wheelPinchRate: number;

  /**
   * Multiplicative zoom step for one press of the zoom key.
   *
   * 1.15 — about five presses per doubling: coarse enough to get somewhere, fine enough to
   * frame a building.
   */
  readonly keyZoomStep: number;

  /**
   * Camera pan speed while a pan key is held, in CSS pixels per second.
   *
   * 700, about a viewport every two seconds. It is a **speed** and not a per-press step
   * because the source game panned 90 px per `keydown` and thereby inherited the operating
   * system's key-repeat rate — a camera whose speed is set in the player's accessibility
   * preferences, on a setting no game can read.
   */
  readonly keyPanPxPerS: number;

  /**
   * Below this release speed a drag ends without a glide, in CSS pixels per second.
   *
   * 120: below it a release is a stop rather than a flick. Without a floor every drag drifts
   * after the finger lifts and the camera can never be placed exactly.
   */
  readonly flingMinPxPerS: number;

  /**
   * Half-life of the glide's exponential decay, in milliseconds.
   *
   * 150, so the glide is frame-rate independent and a 1200 px/s flick coasts ~260 px: enough
   * to feel alive, short enough that a second gesture is never fighting the first.
   */
  readonly flingHalfLifeMs: number;

  /**
   * The window release velocity is averaged over, in milliseconds.
   *
   * 60. Averaged and never differenced: a finger that pauses before lifting has a
   * last-two-points velocity of nearly zero or of nearly anything, and both make flicks feel
   * random.
   */
  readonly flingSampleMs: number;

  /**
   * How many simultaneous pointers the recogniser tracks.
   *
   * 2: a third finger on a two-finger gesture is a palm, and ignoring it beats letting it move
   * the midpoint.
   */
  readonly maxPointers: number;

  /**
   * The stall ceiling: how many samples may wait for a tick before moves start collapsing.
   *
   * 4096, roughly a minute of pathological input. Beyond it something is wrong, and dropping
   * quietly would be worse than saying so — see the `buffer-overflow` diagnostic.
   */
  readonly maxBufferedSamples: number;
}

/**
 * Every field of {@link GestureProfile} that is a plain number.
 *
 * Exported as a type rather than written out twice because it is the domain of both the
 * validation loop and the fingerprint, and a list that appears in two places is a list that
 * will eventually disagree with itself.
 */
export type ProfileScalar = Exclude<keyof GestureProfile, 'tapSlopPx'>;

/**
 * The scalar fields, **in fingerprint order**.
 *
 * The order is part of the recorded format: {@link profileFingerprint} walks this array, so
 * reordering it changes every fingerprint and invalidates every log ever written. Add new
 * fields at the end.
 */
export const PROFILE_SCALARS: readonly ProfileScalar[] = [
  'longPressMs',
  'pinchStartPx',
  'pinchMinSpreadPx',
  'wheelLinePx',
  'wheelPagePx',
  'wheelZoomRate',
  'wheelPinchRate',
  'keyZoomStep',
  'keyPanPxPerS',
  'flingMinPxPerS',
  'flingHalfLifeMs',
  'flingSampleMs',
  'maxPointers',
  'maxBufferedSamples',
];

/** The two fields that are counted rather than measured, and so must be whole numbers. */
const PROFILE_INTEGERS: ReadonlySet<ProfileScalar> = new Set<ProfileScalar>([
  'maxPointers',
  'maxBufferedSamples',
]);

/** The three pointer kinds, in fingerprint order. See {@link PROFILE_SCALARS}. */
const POINTER_KINDS: readonly PointerKind[] = ['mouse', 'touch', 'pen'];

/**
 * The defaults, each one defended in the doc comment of its field.
 *
 * Frozen, and deliberately so: it is the value {@link resolveProfile} falls back to for every
 * field a game does not name, so a mutation here would silently retune every game in the
 * process — including one that overrode nothing and therefore has no idea this object exists.
 */
export const DEFAULT_PROFILE: Readonly<GestureProfile> = Object.freeze({
  tapSlopPx: Object.freeze({ mouse: 4, touch: 9, pen: 6 }),
  longPressMs: 450,
  pinchStartPx: 12,
  pinchMinSpreadPx: 24,
  wheelLinePx: 16,
  wheelPagePx: 400,
  wheelZoomRate: 0.0016,
  wheelPinchRate: 0.01,
  keyZoomStep: 1.15,
  keyPanPxPerS: 700,
  flingMinPxPerS: 120,
  flingHalfLifeMs: 150,
  flingSampleMs: 60,
  maxPointers: 2,
  maxBufferedSamples: 4096,
});

/**
 * What a game may override.
 *
 * A strict widening of `Partial<GestureProfile>`: the slop record may name one kind, two, or
 * all three. Requiring all three would mean a game that only wants a slightly larger touch slop
 * has to restate the mouse and pen numbers — which is how a game ends up with a stale copy of a
 * default that has since been retuned.
 */
export type ProfileOverrides = Partial<Omit<GestureProfile, 'tapSlopPx'>> & {
  readonly tapSlopPx?: Partial<Record<PointerKind, number>>;
};

/**
 * Fill in the defaults for everything a caller did not name, validating what it did.
 *
 * Every threshold is a positive number: a zero `pinchMinSpreadPx` divides by a spread of zero
 * and teleports the zoom, a zero `maxBufferedSamples` throws away the first sample of every
 * gesture, and a `NaN` anywhere spreads to the camera and blanks the screen a hundred frames
 * from the mistake. All three are cheaper to refuse here than to diagnose there.
 *
 * `tapSlopPx` may name one, two or three kinds; the ones it does not name keep their default.
 *
 * @param label Prefix for any error, so the message names the caller's option and not this
 *   function: `createInput.profile.longPressMs: …`.
 * @throws RangeError naming the field and the value for a non-finite or non-positive number,
 *   or a non-integer `maxPointers` / `maxBufferedSamples`.
 */
export function resolveProfile(
  overrides: ProfileOverrides | undefined,
  label: string,
): Readonly<GestureProfile> {
  // Split the defaults once, into the record half and the scalar half. Destructuring rather
  // than a hand-written copy so that adding a field to the interface cannot leave a field
  // behind here — the compiler fills it in.
  const { tapSlopPx: defaultSlop, ...defaultScalars } = DEFAULT_PROFILE;

  const slopIn = overrides?.tapSlopPx;
  const tapSlopPx: Record<PointerKind, number> = {
    mouse: defaultSlop.mouse,
    touch: defaultSlop.touch,
    pen: defaultSlop.pen,
  };
  if (slopIn !== undefined) {
    for (const kind of POINTER_KINDS) {
      const value = slopIn[kind];
      if (value === undefined) continue;
      tapSlopPx[kind] = positive(value, `${label}.tapSlopPx.${kind}`);
    }
  }

  const scalars: Record<ProfileScalar, number> = { ...defaultScalars };
  for (const key of PROFILE_SCALARS) {
    const value = overrides?.[key];
    if (value === undefined) continue;
    scalars[key] = positive(value, `${label}.${key}`);
    if (PROFILE_INTEGERS.has(key)) expectInt(value, `${label}.${key}`);
  }

  return Object.freeze({ ...scalars, tapSlopPx: Object.freeze(tapSlopPx) });
}

/** One threshold, rejected by name. Every number in a profile is finite and greater than zero. */
function positive(value: number, label: string): number {
  expectFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label}: expected a finite number > 0, got ${String(value)}`);
  }
  return value;
}

/**
 * The profile as one comparable string — the third member of a log's compatibility triple.
 *
 * `@lattice/persist` compares this for **exact equality** and refuses a replay that differs
 * rather than migrating it, so it has to be canonical: a fixed field order (never
 * `Object.keys`, whose order is an implementation detail of how the object was built) and
 * `String(number)`, which round-trips every double exactly.
 *
 * It is readable on purpose. A refusal that says `profile mismatch` sends someone reading five
 * things; one that shows `…|tap:4,9,6|…` against `…|tap:4,12,6|…` does not.
 */
export function profileFingerprint(profile: Readonly<GestureProfile>): string {
  let out = 'tap:';
  let first = true;
  for (const kind of POINTER_KINDS) {
    out += `${first ? '' : ','}${String(profile.tapSlopPx[kind])}`;
    first = false;
  }
  for (const key of PROFILE_SCALARS) out += `|${key}:${String(profile[key])}`;
  return out;
}
