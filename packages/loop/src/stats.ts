/**
 * The frame budget, measured — with **two instruments, because one of them is blind.**
 *
 * This module is one interface and no code, which is the point: the numbers are produced by
 * the loop, in place, into a single object that never changes identity. A `FrameStats` that
 * were built per frame would be an allocation on the one path where allocations are counted.
 *
 * The measurement itself uses the injected clock, so a coarse clock gives coarse stats. That
 * is a property of your clock, not a bug in this — and it is why a manual-clock test can
 * assert an exact millisecond count instead of a tolerance.
 *
 * ## The two instruments, and why neither one is enough
 *
 * | | measures | sees a GC pause between pumps? | includes the display's cadence? |
 * |---|---|---|---|
 * | **pump work** — `frameMs`, `worstFrameMs`, `overBudget` | the wall time from the top of a pump to the bottom of it | **no** | no |
 * | **the gap** — `worstGapMs`, `cadenceMs` | the wall time from one *painted* frame to the next | **yes** — it is the gap, so everything in the gap is in it | **yes** |
 *
 * A pump reads the clock once on the way in and once on the way out, so a garbage collection,
 * a style recalculation or a compositor stall that lands *between* two pumps is not inside
 * either reading and never appears in the pump figures. That is not hypothetical: the `crowd`
 * exhibit measured **23.1 ms worst on one machine and 13.1 ms on the other for the same build**,
 * because whether the pause lands inside a pump is machine-dependent and the pump figure is not.
 * The `terraces` exhibit shipped a HUD reading **0.0 ms** against a real worst gap of 9.2 ms.
 * **A measurement that always reports the reassuring answer is worse than no measurement**,
 * because it is trusted.
 *
 * The gap catches all of it, and pays for that by measuring something the exhibit does not
 * control. **A frame gap is bounded below by the display**: a scene pinned to cadence reads
 * 16.7 ms on a 60 Hz panel and 8.3 ms on a 120 Hz one, and the first looks twice as bad while
 * being exactly as healthy. So neither instrument dominates, and shipping one of them alone is
 * shipping an incomplete picture by construction — which is why both are here and why the pump
 * pair was not redefined out from under the HUDs already reading it.
 *
 * **This is why {@link FrameStats.cadenceMs} exists.** A gap is only legible next to the period
 * the display was actually running at, and the loop already knows it: the *shortest* gap in the
 * window is the panel's period, because nothing can paint faster than the panel refreshes. Read
 * the pair — `21.4 ms against a cadence of 16.7` is a dropped frame on a 60 Hz screen; `8.4
 * against 8.3` is a perfect one on a 120 Hz screen; and the same rule reads correctly on both.
 *
 * ## What a HUD should show
 *
 * `worstGapMs` and `cadenceMs`, and — if there is room — `frameMs` beside them so a reader can
 * tell a slow *scene* from a slow *machine*. Do not compare `worstGapMs` against `budgetMs`: the
 * budget is a **work** budget and a gap contains a whole display period that is not work.
 * `overBudget` is the field that belongs to `budgetMs`, and it counts pumps.
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
   * Worst `frameMs` sample since the last `resetStats()` — the pump's own work, high-water.
   *
   * Averages hide exactly the frame a player feels. A game at a smooth 60 with one 90 ms hitch
   * when the map loads has a perfect `frameMs` and a `worstFrameMs` that names the bug.
   *
   * **Two things it is not, both of which have already misled somebody.** It is *pump work*, so
   * a pause between two pumps is invisible to it — see this module's header, and read
   * {@link FrameStats.worstGapMs} for the figure that catches one. And it **never decays**, so
   * over a session it converges on the worst frame the page ever had, which is usually the one
   * it loaded on; a HUD that wants "the worst frame lately" wants `worstGapMs`, which rolls a
   * window of its own and needs no `resetStats()` on a timer to stay honest.
   */
  readonly worstFrameMs: number;

  /**
   * **The honest cost figure: the worst gap between two painted frames in the rolling window.**
   *
   * This is what a player feels — the interval between two *pictures*, which contains the pump,
   * the browser's compositing, the garbage collector, and every other thing the machine chose to
   * do in between. It is measured from the loop's own single clock reading at the top of each
   * `'paint'` pump, so it needs no `performance.now()` anywhere and a manual-clock test can
   * assert it exactly. Four exhibits built this by hand before it existed here, and the fourth
   * asked for it under this name.
   *
   * The window is `windowMs`, resolved into ten buckets, so this is the worst gap of the last 0.9
   * to 1.0 of it — never longer, occasionally a tenth shorter, and never a stale number from four
   * minutes ago the way a high-water mark is.
   *
   * Three things a reader has to know before quoting it:
   *
   * - **It contains a display period.** Compare it to {@link FrameStats.cadenceMs}, never to
   *   `budgetMs`. Sixty hertz pinned to cadence is 16.7 ms and is a pass.
   * - **It only counts `'paint'` pumps.** A hidden tab paints nothing, so the gap across a tab
   *   switch is an *absence*, not a frame: gaps of `absenceMs` or more are excluded and counted
   *   in {@link FrameStats.absences} instead. Without that rule the first thing this readout does
   *   is report a 96-second worst frame, which is exactly what the exhibit that hand-rolled it
   *   first saw. The excluded gap re-bases the next one, so the reading recovers on the following
   *   paint rather than sitting at `0.0` until the window turns over.
   * - **The first `warmupFrames` gaps are excluded**, and {@link FrameStats.warmingUp} says while
   *   it is happening. See that field for why it is a choice and not a cover-up.
   *
   * `0` until the first gap is measured — truthful rather than flattering, and the same promise
   * `fps` makes.
   */
  readonly worstGapMs: number;

  /**
   * The display's period, as this loop actually observed it: the **shortest** paint-to-paint gap
   * in the same window.
   *
   * Nothing can paint faster than the panel refreshes, so the fastest frame in ten seconds is the
   * panel. It exists because {@link FrameStats.worstGapMs} is otherwise unreadable across
   * machines — 8.4 ms is healthy on the 120 Hz laptop it was measured on and would be a mystery
   * on a 60 Hz one — and because "60 fps on a mid laptop" is a threshold that has to mean the
   * same thing on both. The verdict a HUD wants is the *ratio*: a worst gap under about one and
   * a half cadences dropped no frames.
   *
   * `0` until the first gap is measured.
   */
  readonly cadenceMs: number;

  /**
   * Gaps between paints of `absenceMs` or more, since the last `resetStats()`.
   *
   * The tab was hidden, the window was dragged between monitors, the machine slept. These are
   * excluded from {@link FrameStats.worstGapMs} because counting one turns the gate into a
   * report of how long the visitor spent in another tab — and they are *counted here* rather
   * than silently dropped, because a discard nobody can see is how a measurement starts lying.
   * A suspiciously calm window with a non-zero `absences` is a window with a hole in it.
   */
  readonly absences: number;

  /**
   * `true` while the opening `warmupFrames` gaps are still being discarded.
   *
   * **The choice this field exists to keep visible.** The first painted frames of a page include
   * its load: `crowd` reported ~16.3 ms on arrival and ~12.0 ms from the second window on, which
   * was truthful and meant every exhibit in the gallery displayed its worst number at the exact
   * moment a visitor was deciding what they thought of it. Three answers were available —
   * discard N frames, start the window at the first steady frame, or label it — and this package
   * takes the first *and* the third: the prefix is discarded, `warmupFrames` is readable off the
   * loop so the size of the discard is never a secret, and this flag lets a HUD show `—` rather
   * than a confident `0.0 ms` while it is in force.
   *
   * Set `warmupFrames: 0` for the unfiltered figure, which is what a benchmark of page load
   * wants and what a scene's steady cost does not.
   */
  readonly warmingUp: boolean;

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
