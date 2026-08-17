/**
 * **`@browser-only`** — the one place a live frame figure becomes text on this page.
 *
 * The page argues, in a paragraph beside its own readout, that `0.0 ms` means
 * `requestAnimationFrame` stopped rather than that anything got quicker. That argument was true
 * and was applied in exactly one widget, so the page went on to print a bare `0.4 ms` next to the
 * word "hero" and a bare `405.5 ms` under a tile that had been alive for two seconds. Both are
 * the same failure the paragraph describes: **a number is only a measurement once you can say
 * what was running while it was taken.** This module is that check, written once and used by
 * every figure the page prints.
 *
 * ## The four ways a frame figure lies, and the guard for each
 *
 * | the lie | what it looks like | the guard here |
 * |---|---|---|
 * | the tab is backgrounded | `0.0 ms` — very fast! | {@link Verdict} `backgrounded`; an em dash is printed |
 * | the loop is stopped | last frame's figure, for ever | `paused`; the figure is stale and says so |
 * | the loop just started | a mount spike, quoted as steady state | `warming`, then `mounting` |
 * | nothing has painted yet | a sub-millisecond worst *gap* | `unmeasured` — below {@link FLOOR_MS} |
 *
 * ## Why `mounting` is a state and not a suppression
 *
 * `worstGapMs` rolls a window — {@link LoopLike.windowMs}, ten seconds by default — so the
 * *whole* cost of booting an exhibit sits in the readout for ten seconds after it boots, not for
 * the two seconds a naive warm-up would drop. Measured on this page: `island` reads 58.4 ms one
 * second after mount, 58.4 ms at four seconds, and 22.6 ms at twelve. Hiding the first two
 * seconds and then printing 58.4 as if it were the scene's cost would be a smaller version of
 * the same lie.
 *
 * So the window is *qualified* rather than hidden: until it has rolled clear of the mount, the
 * figure is printed with what it still contains. A page that shows its own render cost is making
 * an argument, and an argument that quietly drops its worst evidence is not one.
 *
 * ## The verdict is a ratio, not a threshold
 *
 * `docs/PERFORMANCE.md` is explicit that `worstGapMs` contains a whole display period, so it may
 * not be compared to the frame budget: 8.4 ms is a perfect frame on a 120 Hz panel and 16.8 ms is
 * a perfect one on 60 Hz. {@link format} therefore turns a figure red against the *cadence the
 * loop actually observed*, and only falls back to a fixed number when there is no cadence to
 * compare against.
 */

/**
 * Samples taken this soon after a loop starts are the page's load rather than the scene's cost,
 * and no figure is printed from them at all.
 *
 * Two seconds was the brief; three is what the measurement asked for. An exhibit's first paint
 * lands 300-900 ms after its iframe is created on this machine, and a two-second window closes
 * while the first real frames are still arriving.
 */
export const WARMUP_MS = 3000;

/**
 * The smallest worst-*gap* that can be a real measurement, in milliseconds.
 *
 * A gap is the wall time between two painted frames, so it contains a whole display period and
 * cannot be under about 8 ms on any panel a visitor owns. Anything below one millisecond is not
 * a fast page: it is a loop that has painted once, or not at all. This is the exact figure the
 * page's own paragraph is about, and it is a constant rather than a comment so that every readout
 * on the page is held to it.
 *
 * **It fires on a real source, not a hypothetical one.** The hero exhibit rolls its own ten-second
 * window by calling `loop.resetStats()` on a five-second timer, and `packages/loop`'s own
 * documentation says what that costs: a reset "zeroes `fps` for every other reader of the same
 * object". Probed here, the hero's `worstGapMs` reads `0.00` with `cadenceMs` at `0.00` for a
 * fraction of a second every five seconds, between `17.8` and `17.6`. That is the whole mechanism
 * behind the `0.1 ms` and `0.4 ms` a reviewer caught this page printing: it was not a background tab,
 * it was sampling a window somebody else had just emptied. This floor prints `measuring` there.
 */
export const FLOOR_MS = 1;

/** Past this multiple of the observed display period, a gap dropped a frame a reader can see. */
const HOT_RATIO = 1.5;

/** Used when a source has no cadence to compare against. A frame and a half at 60 Hz. */
const HOT_FALLBACK_MS = 24;

/** The part of `@latticekit/loop`'s `Loop` a meter reads. Declared structurally so the page can
 *  point a meter at its own loop and at an exhibit's without the two sharing a type. */
export interface LoopLike {
  readonly running: boolean;
  readonly windowMs: number;
  readonly stats: {
    readonly worstGapMs: number;
    readonly cadenceMs: number;
  };
}

/**
 * What the meter concluded, before anything about how it is worded.
 *
 * It is a discriminated union rather than a string because the tile chip, the statement panel and
 * the hero overlay word the same conclusion three different ways, and a page that decides "is
 * this real" three times decides it differently three times. That is how the page ended up
 * arguing with itself in the first place.
 */
export type Verdict =
  /** No `requestAnimationFrame` at all. Every figure below is frozen at whatever it last was. */
  | { readonly kind: 'backgrounded' }
  /** Nothing to read: no loop, or a loop this page could not reach inside a cross-origin frame. */
  | { readonly kind: 'absent' }
  /** The loop is stopped. Its last figure survives in the object and means nothing now. */
  | { readonly kind: 'paused' }
  /** Inside {@link WARMUP_MS} of the loop starting. */
  | { readonly kind: 'warming' }
  /** Below {@link FLOOR_MS}: the loop has not painted twice yet. */
  | { readonly kind: 'unmeasured' }
  /** Real, but the rolling window still contains the mount. `sinceMs` is how long it has run. */
  | { readonly kind: 'mounting'; readonly ms: number; readonly cadenceMs: number }
  /** Real, and the window has rolled clear of the mount. */
  | { readonly kind: 'measured'; readonly ms: number; readonly cadenceMs: number };

/** How a verdict is printed: the text, the long form for a `title`, and whether it is bad news. */
export interface Printed {
  readonly text: string;
  readonly title: string;
  readonly hot: boolean;
}

/**
 * Read a loop and decide what may honestly be said about it.
 *
 * `startedAt` is when *this* run of the loop began — not when the page loaded and not when the
 * scene was constructed. A scene that is paused and resumed has warmed up again, because its
 * first frame back is a re-entry cost exactly like its first frame ever.
 */
export function judge(
  loop: LoopLike | undefined,
  startedAt: number | undefined,
  nowMs: number,
): Verdict {
  if (document.visibilityState !== 'visible') return { kind: 'backgrounded' };
  if (loop === undefined || startedAt === undefined) return { kind: 'absent' };
  if (!loop.running) return { kind: 'paused' };
  const ranMs = nowMs - startedAt;
  if (ranMs < WARMUP_MS) return { kind: 'warming' };
  const ms = loop.stats.worstGapMs;
  const cadenceMs = loop.stats.cadenceMs;
  if (!(ms >= FLOOR_MS)) return { kind: 'unmeasured' };
  // The window is `windowMs` long and it started rolling when the loop did, so until that much
  // wall time has passed the mount is still inside the figure being read.
  return ranMs < loop.windowMs
    ? { kind: 'mounting', ms, cadenceMs }
    : { kind: 'measured', ms, cadenceMs };
}

/** Is this gap worse than the display period allows? See {@link HOT_RATIO}. */
function isHot(ms: number, cadenceMs: number): boolean {
  return cadenceMs >= FLOOR_MS ? ms > cadenceMs * HOT_RATIO : ms > HOT_FALLBACK_MS;
}

const ms1 = (n: number) => `${n.toFixed(1)} ms`;

/** How a readout is worded. */
export interface FormatOpts {
  /** A chip on a tile, where "warming up" does not fit and the reader is looking at the world
   *  rather than at the number. */
  readonly short?: boolean;
  /**
   * This readout is the display *period* — the shortest gap — rather than the worst one.
   *
   * It gets the same four guards and a different sentence: a period is never "hot", and it is
   * the denominator every other figure on the page is judged against rather than a cost.
   */
  readonly period?: boolean;
}

/**
 * Word a verdict for a readout that has room for a few characters and a `title`.
 */
export function format(v: Verdict, opts: FormatOpts = {}): Printed {
  const short = opts.short === true;
  const period = opts.period === true;
  switch (v.kind) {
    /**
     * An em dash, and **never the word**.
     *
     * The guard is right and the wording was not. `hidden` is a state name — it is what the code
     * calls this branch — and printing a state name in a figure's slot is how a page reads as a
     * template somebody forgot to fill in. It appeared fourteen times at once, because every
     * meter on the page reaches this branch in the same instant the tab loses focus, and a
     * gallery captioned `LIVE hidden` ten times over is the one thing here that looked amateur.
     *
     * The em dash is this page's existing vocabulary for "no figure" — it is what `.fig .v.live`
     * already draws for an empty cell and what the reference tables print for a missing size —
     * so a backgrounded tab now degrades to the same mark as every other absent number, and the
     * `title` still says exactly what happened for anyone who asks.
     */
    case 'backgrounded':
      return {
        // `short` is a tile chip and the strip's live cell. A tile already reads `LIVE` or
        // `PAUSED` beside this, so an em dash there is a second way of saying nothing — the same
        // reasoning `absent` uses one case down. The strip has no such label, and `.fig .v.live`
        // draws the em dash for an empty cell itself, so both get the mark and neither gets the
        // word.
        text: short ? '' : '—',
        title:
          'This tab is in the background, so requestAnimationFrame is not running and there is nothing to measure. A frame figure here would read 0.0 ms and mean the opposite of fast.',
        hot: false,
      };
    case 'absent':
      // A tile already says "idle" or "frame held" beside this, so an em dash next to it is a
      // second way of saying nothing. The panel at the top has no such label and needs one.
      return { text: short ? '' : '—', title: 'Nothing running to measure.', hot: false };
    case 'paused':
      return {
        text: short ? '' : 'paused',
        title:
          'This loop is stopped, so its last frame figure would sit here unchanged for the rest of the visit. Not shown for that reason.',
        hot: false,
      };
    case 'warming':
      return {
        text: short ? 'warming' : 'warming up',
        title: `The first ${String(WARMUP_MS / 1000)} seconds after a loop starts are its mount, not its cost. Nothing is printed from them.`,
        hot: false,
      };
    case 'unmeasured':
      return {
        text: 'measuring',
        title: `A worst gap under ${String(FLOOR_MS)} ms means the loop has not painted twice yet — a gap contains a whole display period and cannot honestly be smaller. Held rather than printed.`,
        hot: false,
      };
    case 'mounting':
      return {
        text: short || period ? ms1(v.ms) : `${ms1(v.ms)} · incl. mount`,
        title: period
          ? `${ms1(v.ms)} between the two closest painted frames so far. Still settling: this loop has been running for less than the window it rolls.`
          : `${ms1(v.ms)} worst gap in the last ten seconds, against a ${ms1(v.cadenceMs)} display period — but this scene has been running for less than that window, so the figure still contains the cost of starting it. It settles downward.`,
        hot: false,
      };
    case 'measured':
      return {
        text: ms1(v.ms),
        title: period
          ? `${ms1(v.ms)} is the display period this loop actually observed — the shortest gap between two painted frames in the last ten seconds. Every worst-case figure on this page is only legible next to it: 8.3 ms is a perfect frame on a 120 Hz panel and 16.7 ms is a perfect one on 60 Hz.`
          : `${ms1(v.ms)} worst gap between two painted frames in the last ten seconds, against a ${ms1(v.cadenceMs)} display period. The verdict is the ratio: a gap contains a whole period, so it is never compared to the frame budget.`,
        hot: !period && isHot(v.ms, v.cadenceMs),
      };
  }
}

/**
 * A readout bound to one element.
 *
 * The element keeps its `title` and its `hot` class in step with its text, so a reader who
 * mistrusts a number can hover it and be told what was running while it was taken — which is the
 * same move the rest of this page makes with `data-source` on its headline figures.
 */
export interface Meter {
  /** The loop began, or began again. Restarts the warm-up window. */
  started(nowMs: number): void;
  /** The loop stopped, or was taken away. */
  stopped(): void;
  /** Read the source and write the element. Cheap enough to call on a 250 ms tick. */
  update(loop: LoopLike | undefined, nowMs: number): void;
}

export function createMeter(node: Element | null, opts: FormatOpts = {}): Meter {
  let startedAt: number | undefined;
  let last = '';
  return {
    started(nowMs) {
      startedAt = nowMs;
    },
    stopped() {
      startedAt = undefined;
    },
    update(loop, nowMs) {
      const printed = format(judge(loop, startedAt, nowMs), opts);
      if (node === null) return;
      if (printed.text !== last) {
        last = printed.text;
        node.textContent = printed.text;
      }
      if (node.getAttribute('title') !== printed.title) node.setAttribute('title', printed.title);
      node.classList.toggle('hot', printed.hot);
    },
  };
}

/**
 * A backgrounded tab has no rAF, so every window a meter is rolling stops rolling with it and the
 * figures on the other side are a mixture of two visits. Callers hand this to every meter's
 * {@link Meter.started} when the page comes back.
 */
export function onReturn(fn: () => void): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fn();
  });
}
