/**
 * Samples, the per-tick bucket, and the log — the join that makes a session replayable.
 *
 * Browser events arrive when the browser feels like it and a fixed-step loop runs on its own
 * schedule. Something has to reconcile those two, and if it is not this package it is game
 * code, which will drop a tap on a slow frame and fire two on a fast one. The reconciliation
 * is one rule:
 *
 * > **A tick sees a bucket that was closed before it started.**
 *
 * | situation | what happens |
 * |---|---|
 * | an event arrives between ticks | it joins the open bucket and is delivered by the next tick |
 * | an event arrives *during* a tick — including one a handler synthesises | it joins the **next** bucket, never the running one. Otherwise delivery order would depend on when the browser dispatched, which is not reproducible, and a handler that submits input could recurse |
 * | a pump runs **no** ticks | nothing is delivered, nothing is lost; the bucket keeps filling |
 * | a pump runs **five** ticks | the first gets the backlog; the other four are normally empty, which is correct — they are catch-up for time that already passed, and a tap did not happen five times |
 * | the bucket reaches `maxBufferedSamples` | consecutive `move`s for one pointer collapse to the newest. **A `down`, `up`, `cancel`, `key` or `wheel` is never dropped**: a stall costs precision, never an event, and one `buffer-overflow` diagnostic is raised |
 *
 * The consequence worth stating out loud: **a tap cannot be dropped by a slow frame and cannot
 * fire twice on a fast one**, because ticks — not frames, not events — are what deliver, and
 * each sample is in exactly one bucket.
 *
 * ## Why there are two representations of a sample
 *
 * {@link RawSample} is the public, serialisable one: a discriminated union of plain objects
 * that goes in a log and through JSON unchanged. {@link SampleSlot} is the internal one: a
 * flat, fully-populated record that the buffer owns for ever and overwrites in place. A
 * fixed-shape slot is what makes a thousand `pointermove`s through one tick allocate nothing,
 * and keeping it internal is what stops that optimization leaking into the recorded format,
 * where a field-per-kind union is far easier to read a year later.
 *
 * Pure: no clock, no DOM.
 */

import type { PointerKind } from './profile.js';

/**
 * The format version of {@link InputLog}.
 *
 * Bumped whenever the meaning of a sample stream changes — a new sample kind, a changed field,
 * or a change in how the recognizer reads one. `@lattice/persist` compares it for equality and
 * **refuses** a replay that differs, because a migrated input log is a log that no longer
 * replays and a divergence report from one is worse than no report at all.
 */
export const LOG_VERSION = 1;

/**
 * The entire input to the recognizer. Plain data, serialisable, no clock, no DOM.
 *
 * `tick` is how time enters — {@link InputSystem.tick} appends one — which means a log is a
 * complete description of a session's input *including its timing*, expressed on the only axis
 * a fixed-step loop can replay against: tick indices. **Wall-clock timestamps are deliberately
 * absent.** Replayed against a loop whose pumps fall differently, timestamped events land in
 * different ticks and the run diverges; they look like they would help, which is what makes
 * them worse than nothing.
 */
export type RawSample =
  | {
      readonly kind: 'down';
      readonly id: number;
      readonly sx: number;
      readonly sy: number;
      readonly pointerType: PointerKind;
    }
  | { readonly kind: 'move'; readonly id: number; readonly sx: number; readonly sy: number }
  | { readonly kind: 'up'; readonly id: number; readonly sx: number; readonly sy: number }
  /** The pointer was taken away: `pointercancel`, `lostpointercapture`, blur, or dispose. */
  | { readonly kind: 'cancel'; readonly id: number }
  /** `dz` is already normalized to CSS pixels; `pinch` marks a trackpad pinch arriving as a wheel. */
  | {
      readonly kind: 'wheel';
      readonly sx: number;
      readonly sy: number;
      readonly dz: number;
      readonly pinch: boolean;
    }
  | { readonly kind: 'key'; readonly code: string; readonly down: boolean }
  /** The window lost focus. Everything held is released, and no `up` was needed. */
  | { readonly kind: 'blur' }
  | { readonly kind: 'tick'; readonly index: number };

/** The discriminant of {@link RawSample}, named so the buffer can switch on it exhaustively. */
export type SampleKind = RawSample['kind'];

/**
 * A recorded session's input, and everything needed to know the recording is still valid.
 *
 * `@lattice/persist` owns the envelope this goes in — versioning, integrity, storage — and
 * stores this **verbatim**: it never reorders `samples` and never rewrites a field. The three
 * scalars are its `ReplayCompat` triple, compared for exact equality before the first tick,
 * because recognition rules change with the package version, gesture durations are counted in
 * ticks, and the same finger movements under different thresholds are a different session.
 *
 * Read the triple off a freshly created log — see `createLog` — rather than typing it at a
 * call site, so the recorded and the current cannot drift apart in a refactor.
 */
export interface InputLog {
  /** See {@link LOG_VERSION}. */
  readonly version: number;
  /** The fixed step the session was recorded at, in milliseconds. */
  readonly stepMs: number;
  /** The recognition thresholds in force, canonically encoded. See `profileFingerprint`. */
  readonly profile: string;
  /** Arrival order, `tick` samples included, exactly as submitted. */
  readonly samples: readonly RawSample[];
}

/** Things this package can detect about its host that are always bugs. */
export type DiagnosticCode =
  | 'covered-by-overlay'
  | 'touch-action-overridden'
  | 'unknown-key-code'
  | 'pointer-events-none'
  | 'buffer-overflow';

/**
 * A problem worth a sentence, not a throw.
 *
 * Every one of these has a legitimate cause as well as a broken one — a modal legitimately
 * covers the world, a keyboard legitimately has a code this build's table does not list — so
 * refusing would be wrong and silence would be worse. The message names the caller's mistake
 * and the element responsible, never a bare description.
 */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  /** The element responsible, where there is one. Absent for anything the DOM did not cause. */
  readonly element?: Element;
}

/** Where a diagnostic goes. One call, at most once per code per system. */
export type DiagnosticSink = (diagnostic: Diagnostic) => void;

/**
 * The buffer's internal, mutable, fixed-shape sample.
 *
 * Every field of every {@link RawSample} kind, always present, never optional: a monomorphic
 * object is what lets the buffer own its slots for the life of the system and overwrite them
 * in place, which is the whole of "1,000 moves through one tick allocate zero bytes". Fields
 * that do not apply to `kind` hold their zero value and must not be read — {@link toRawSample}
 * is the only thing that decides which fields a kind has.
 */
export interface SampleSlot {
  kind: SampleKind;
  id: number;
  sx: number;
  sy: number;
  pointerType: PointerKind;
  dz: number;
  pinch: boolean;
  code: string;
  down: boolean;
  index: number;
}

/**
 * A slot in its zero state.
 *
 * Called once per slot, for ever. Exported because the recorder needs a scratch one to
 * normalize a caller's sample through — {@link writeSlot} then {@link toRawSample} is one
 * definition of what each kind carries, and a second copy of that switch is a second place for
 * a field to go missing.
 */
export function createSampleSlot(): SampleSlot {
  return {
    kind: 'blur',
    id: 0,
    sx: 0,
    sy: 0,
    pointerType: 'mouse',
    dz: 0,
    pinch: false,
    code: '',
    down: false,
    index: 0,
  };
}

/**
 * Copy a public sample into a slot, zeroing everything the kind does not carry.
 *
 * The zeroing is not tidiness. A slot is reused, so a `move` written over an old `wheel`
 * would inherit that wheel's `dz`, and the first thing to read it would be a zoom nobody
 * performed — a bug that only appears once the buffer has wrapped, which is to say in
 * production and not in a test.
 */
export function writeSlot(slot: SampleSlot, sample: RawSample): void {
  slot.kind = sample.kind;
  slot.id = 0;
  slot.sx = 0;
  slot.sy = 0;
  slot.pointerType = 'mouse';
  slot.dz = 0;
  slot.pinch = false;
  slot.code = '';
  slot.down = false;
  slot.index = 0;
  switch (sample.kind) {
    case 'down':
      slot.id = sample.id;
      slot.sx = sample.sx;
      slot.sy = sample.sy;
      slot.pointerType = sample.pointerType;
      return;
    case 'move':
    case 'up':
      slot.id = sample.id;
      slot.sx = sample.sx;
      slot.sy = sample.sy;
      return;
    case 'cancel':
      slot.id = sample.id;
      return;
    case 'wheel':
      slot.sx = sample.sx;
      slot.sy = sample.sy;
      slot.dz = sample.dz;
      slot.pinch = sample.pinch;
      return;
    case 'key':
      slot.code = sample.code;
      slot.down = sample.down;
      return;
    case 'tick':
      slot.index = sample.index;
      return;
    default:
      return;
  }
}

/**
 * A slot as a public sample — one fresh object, for the log.
 *
 * The only allocation in the sample path, and it happens **only while recording**. A log is an
 * array that grows for the length of a session, so there is no version of it that allocates
 * nothing; a game that is not recording pays none of it.
 */
export function toRawSample(slot: SampleSlot): RawSample {
  switch (slot.kind) {
    case 'down':
      return {
        kind: 'down',
        id: slot.id,
        sx: slot.sx,
        sy: slot.sy,
        pointerType: slot.pointerType,
      };
    case 'move':
      return { kind: 'move', id: slot.id, sx: slot.sx, sy: slot.sy };
    case 'up':
      return { kind: 'up', id: slot.id, sx: slot.sx, sy: slot.sy };
    case 'cancel':
      return { kind: 'cancel', id: slot.id };
    case 'wheel':
      return { kind: 'wheel', sx: slot.sx, sy: slot.sy, dz: slot.dz, pinch: slot.pinch };
    case 'key':
      return { kind: 'key', code: slot.code, down: slot.down };
    case 'tick':
      return { kind: 'tick', index: slot.index };
    default:
      return { kind: 'blur' };
  }
}

/**
 * One bucket: slots owned for ever, a count that says how many of them are live.
 *
 * `slots.length` is capacity and `count` is occupancy, and they are different numbers on
 * purpose — emptying by setting `count = 0` keeps every object for the next tick, where
 * `slots.length = 0` would hand them all to the collector sixty times a second.
 */
interface Bucket {
  readonly slots: SampleSlot[];
  count: number;
}

/**
 * The per-tick sample buffer: one open bucket taking arrivals, one closed bucket being
 * delivered.
 *
 * Fed by {@link push} at whatever rate the host produces events, drained by {@link close} once
 * per simulation tick. Nothing here reads a clock, and the only thing that decides when a
 * sample becomes visible is a call to `close`.
 */
export class SampleBuffer {
  /** Arrivals land here. Swapped with {@link drained} by {@link close}. */
  private open: Bucket = { slots: [], count: 0 };
  /** The bucket a tick is delivering. Its slots are recycled by the next {@link close}. */
  private drained: Bucket = { slots: [], count: 0 };
  private max: number;
  private readonly onOverflow: () => void;
  /** Raised once per overflow episode; re-armed by {@link close}, so a stall reports once. */
  private overflowed = false;
  /** Survivor marks for {@link collapse}, kept between calls so a stall allocates nothing. */
  private readonly keep: boolean[] = [];

  /**
   * @param maxBufferedSamples The stall ceiling. At this occupancy moves start collapsing.
   * @param onOverflow Called at most once per episode, the first time the ceiling is reached.
   *   A loop that has stopped ticking is a bug worth hearing about.
   */
  constructor(maxBufferedSamples: number, onOverflow: () => void) {
    this.max = maxBufferedSamples;
    this.onOverflow = onOverflow;
  }

  /** Samples waiting for the next tick. A number a stall diagnostic can watch. */
  get buffered(): number {
    return this.open.count;
  }

  /**
   * Move the stall ceiling, for `InputSystem.setProfile`.
   *
   * In place rather than by replacement, so the slot pool the buffer has already grown survives
   * a retune — the whole point of that pool is that a running game allocates nothing per sample,
   * and throwing it away to change one integer would hand the next few hundred moves back to the
   * allocator.
   *
   * Whatever is already waiting stays waiting. A new ceiling below the current occupancy is not
   * an error and does not drop anything: the next {@link push} finds the bucket over the line and
   * collapses it, which is exactly what it does when a real stall crosses the ceiling.
   */
  retune(maxBufferedSamples: number): void {
    this.max = maxBufferedSamples;
  }

  /**
   * Take a sample into the open bucket.
   *
   * Copies; the caller's object is never retained, so a producer may reuse one object for
   * every event it makes.
   */
  push(sample: RawSample): void {
    const bucket = this.open;
    if (bucket.count >= this.max) {
      this.collapse();
      if (!this.overflowed) {
        this.overflowed = true;
        this.onOverflow();
      }
    }
    const index = bucket.count;
    let slot = bucket.slots[index];
    if (slot === undefined) {
      slot = createSampleSlot();
      bucket.slots[index] = slot;
    }
    writeSlot(slot, sample);
    bucket.count = index + 1;
  }

  /**
   * Close the open bucket and return it for delivery.
   *
   * The returned bucket is the buffer's own storage and stays valid until the **next** call to
   * `close`, which is exactly one tick — long enough to deliver, short enough that nothing can
   * hold it across a tick boundary and read next tick's samples out of it.
   */
  close(): { readonly slots: readonly SampleSlot[]; readonly count: number } {
    const closing = this.open;
    this.drained.count = 0;
    this.open = this.drained;
    this.drained = closing;
    this.overflowed = false;
    return closing;
  }

  /**
   * Collapse consecutive `move`s for one pointer down to the newest, in place.
   *
   * Walks **backwards**, keeping the first `move` it meets for each pointer and dropping the
   * older ones behind it, and forgetting a pointer at its `down`/`up`/`cancel` so that moves
   * from two different presses can never merge into one. Everything that is not a `move`
   * survives: a stall costs precision, never an event, and a dropped `up` is a camera that
   * pans for ever.
   */
  private collapse(): void {
    const bucket = this.open;
    const { slots } = bucket;
    const keep = this.keep;
    const seen = new Set<number>();
    // Backwards, because a forward pass cannot know — at the moment it reads a move — whether
    // a newer one for that pointer is still to come. Forgetting a pointer at its down/up/
    // cancel is what stops moves from two different presses merging into one.
    for (let i = bucket.count - 1; i >= 0; i--) {
      const slot = slots[i];
      if (slot === undefined) {
        keep[i] = false;
        continue;
      }
      if (slot.kind === 'move') {
        if (seen.has(slot.id)) {
          keep[i] = false;
          continue;
        }
        seen.add(slot.id);
      } else if (slot.kind === 'down' || slot.kind === 'up' || slot.kind === 'cancel') {
        seen.delete(slot.id);
      }
      keep[i] = true;
    }
    // Forwards, so the write cursor is never ahead of the read cursor and no survivor is
    // overwritten before it has been copied.
    let write = 0;
    for (let i = 0; i < bucket.count; i++) {
      if (keep[i] !== true) continue;
      const from = slots[i];
      const to = slots[write];
      if (from === undefined || to === undefined) continue;
      if (from !== to) copySlot(from, to);
      write += 1;
    }
    bucket.count = write;
  }
}

/** Field-by-field copy. Slots are owned by the buffer, so a reference swap would alias them. */
function copySlot(from: SampleSlot, to: SampleSlot): void {
  to.kind = from.kind;
  to.id = from.id;
  to.sx = from.sx;
  to.sy = from.sy;
  to.pointerType = from.pointerType;
  to.dz = from.dz;
  to.pinch = from.pinch;
  to.code = from.code;
  to.down = from.down;
  to.index = from.index;
}
