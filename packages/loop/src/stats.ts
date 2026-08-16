/**
 * The frame budget, measured.
 *
 * This module is one interface and no code, which is the point: the numbers are produced by
 * the loop, in place, into a single object that never changes identity. A `FrameStats` that
 * were built per frame would be an allocation on the one path where allocations are counted.
 *
 * The measurement itself uses the injected clock, so a coarse clock gives coarse stats. That
 * is a property of your clock, not a bug in this — and it is why a manual-clock test can
 * assert an exact millisecond count instead of a tolerance.
 */

/**
 * Live frame figures.
 *
 * `loop.stats` returns the **same object on every read**; the loop mutates it in place. That
 * is what keeps reading it every frame free. If you need to keep a reading — for a graph, for
 * a report — copy the fields you want.
 *
 * The trap, and it is worth one more sentence because it costs an afternoon every time:
 * `const before = loop.stats;` then comparing `before.frameMs` to `loop.stats.frameMs` later
 * compares an object with itself and finds no difference, ever. Storing this object stores a
 * live view that changes under you. Copy the number, not the object.
 */
export interface FrameStats {
  /**
   * Paints per second, counted over the last completed second of real time.
   *
   * A count over a window rather than a smoothed reciprocal of a frame interval, so the number
   * is an integer a human can check against a devtools reading. It is `0` until the first full
   * second has elapsed — truthful rather than flattering, and a test can rely on it.
   */
  readonly fps: number;

  /**
   * Smoothed cost of a whole pump: jobs, update, render and the loop's own bookkeeping.
   *
   * Smoothing is a one-eighth exponential moving average — a negative power of two, so the
   * arithmetic is exact in binary and a test can assert an equality rather than a tolerance.
   * The first sample after a `resetStats()` is taken whole, so the reading is never dragged
   * up out of zero for the first dozen frames.
   */
  readonly frameMs: number;

  /** Smoothed cost of all `update` subscribers in a pump — the number that grows with entity count. */
  readonly updateMs: number;

  /** Smoothed cost of all `render` subscribers. Zero on a pump that did not paint. */
  readonly renderMs: number;

  /**
   * Worst `frameMs` sample since the last `resetStats()`.
   *
   * Averages hide exactly the frame a player feels. A game at a smooth 60 with one 90 ms hitch
   * when the map loads has a perfect `frameMs` and a `worstFrameMs` that names the bug.
   */
  readonly worstFrameMs: number;

  /** Pumps that cost more than `budgetMs`. The number a benchmark should assert on. */
  readonly overBudget: number;

  /**
   * Fixed steps run in the most recent pump.
   *
   * Sustained above 1 means the game cannot keep up: the clamp turns that into a game running
   * in slow motion rather than a locked tab, so this figure and a growing `realTime - time`
   * are the only tells that the degradation is happening at all.
   */
  readonly stepsLastPump: number;

  /** Fixed steps run since the last `resetStats()`. */
  readonly ticks: number;

  /** Paint pumps that ran the render subscribers since the last `resetStats()`. */
  readonly renders: number;

  /** Pumps of either kind since the last `resetStats()`. */
  readonly pumps: number;

  /**
   * Total sim seconds discarded by the catch-up clamp.
   *
   * **Diagnostics only.** This is monotonic-clock time, which may not include the machine's
   * sleep, and crediting it would double-count against `@lattice/sim`, which has already
   * integrated the same interval from its own stored epoch timestamp. The loop advances
   * callbacks; `sim` advances value. Legitimate uses: a perf warning, a "welcome back" panel
   * that says nothing about numbers, deciding to skip an expensive re-layout.
   */
  readonly droppedSeconds: number;
}
