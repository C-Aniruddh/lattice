/**
 * **`@browser-only`** — the landing page's behavior. Not part of the kit, and nothing here may
 * move into `packages/`.
 *
 * It does four things, and three of them are the kit running on its own marketing:
 *
 * 1. **The day cycle is the scroll bar.** `lerpPalette(DUSK, NIGHT, progress)` from
 *    `@lattice/draw` writes the document's `--lattice-*` custom properties, so the page darkens
 *    as you descend using the same interpolation an exhibit uses for its sky. `lerpPalette`
 *    quantizes to `PALETTE_STEPS` internally, which is why this is affordable: the page is
 *    repainted about thirty times over a full scroll, not sixty times a second.
 * 2. **The backdrop is an isometric field**, drawn with `isoTile` into a fixed canvas, repainted
 *    only when that quantized step changes.
 * 3. **The gallery is live**, and pays for it: a tile's exhibit is a real page in an iframe,
 *    created the first time it comes near the viewport and `loop.stop()`ed the moment it leaves.
 *    An off-screen exhibit costs nothing because its loop is not running, which is a claim this
 *    page can make only because `@lattice/loop` puts the frame source behind an interface.
 * 4. **It shows its own frame cost**, and the number it shows is `worstGapMs` rather than
 *    `worstFrameMs`, because a pump that is fast between long pauses is not a page that is fast.
 *    `docs/PERFORMANCE.md` has the pair that read 4.6 ms and 69.2 ms at the same instant.
 *
 * ## The two traps this file is written against
 *
 * **A frame readout of 0.0 ms means the tab is hidden.** `requestAnimationFrame` does not run in
 * a background tab, so every timing here is held and marked stale unless
 * `document.visibilityState === 'visible'`.
 *
 * **The exhibits are same-origin, deliberately.** `bootstrap` parks its `Boot` on the mount
 * element as `__latticeBoot`, so this page can reach a running exhibit's `loop` and stop it. If
 * the gallery is ever served from a different origin than the page, every pause here silently
 * becomes a no-op and eighteen worlds run at once behind the reader. {@link reachBoot} returns
 * `undefined` in that case and {@link Scene.pause} degrades to unmounting the frame, which is
 * slower but correct.
 */
import { DUSK, NIGHT, beginFrame, createCanvas2dSurface, createPalette, endFrame, isoTile, lerpPalette, mix, withAlpha } from '@lattice/draw';
import { createCamera } from '@lattice/iso';
import { browserFrames, createLoop } from '@lattice/loop';
import { clamp01, hash2 } from '@lattice/core';

/* ────────────────────────────────────────────────────────────────────────────────────────
 * What the visitor has told the browser they want.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
/** `saveData` is the only honest signal a page gets that it is on a metered or slow connection.
 *  It is absent on Safari, which is why it is read defensively rather than relied on. */
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
/** Auto-running eleven worlds is the page's whole argument, and it is still not worth doing to
 *  somebody who asked for stillness or is paying by the megabyte. Both get a button instead. */
const askFirst = reduceMotion || saveData;

/* ────────────────────────────────────────────────────────────────────────────────────────
 * 1 + 2. The day cycle, and the field it lights.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

const root = document.documentElement;
const groundCanvas = document.querySelector<HTMLCanvasElement>('#ground');

/** Repaints of the backdrop since load. Printed in the footer, because a page that claims a
 *  cheap scroll animation should say how cheap. */
let repaints = 0;
let lastKey = '';

const backdrop = groundCanvas === null ? undefined : makeBackdrop(groundCanvas);

function applyNight(progress: number): void {
  // `lerpPalette` snaps `progress` to one of PALETTE_STEPS levels before mixing, so two scroll
  // positions inside the same step produce byte-identical strings and the work below is skipped.
  // This is the same quantization `Palette.lerp` uses, and it is the reason an animated color is
  // safe here — see the ramp-cache note in docs/GALLERY.md.
  const vars = lerpPalette(DUSK, NIGHT, progress);
  const key = vars['night'] ?? '';
  if (key === lastKey) return;
  lastKey = key;
  for (const slot of Object.keys(vars)) root.style.setProperty(`--lattice-${slot}`, vars[slot] ?? '');
  backdrop?.paint(progress);
  repaints += 1;
  const readout = document.querySelector('#repaints');
  if (readout !== null) readout.textContent = String(repaints);
}

/**
 * The field behind the page: one isometric plane, drawn with the kit, repainted only when the
 * palette step moves.
 *
 * It is a `Surface` and a `Camera` and nothing else — no loop, no sorter, no light. That is the
 * point of the demonstration: the cheapest possible use of `draw` is four calls, and the page's
 * own wallpaper is made of the same function an exhibit paints its ground with.
 */
function makeBackdrop(canvas: HTMLCanvasElement): { paint(progress: number): void } {
  const surface = createCanvas2dSurface(canvas, { pixelRatio: 1 });
  const palette = createPalette(DUSK);
  // A wide, shallow camera: the field is wallpaper, so it wants to be read as texture rather
  // than as a place. Zoomed out past any exhibit's minimum on purpose.
  const camera = createCamera(Math.max(1, innerWidth), Math.max(1, innerHeight), {
    minZoom: 0.1, maxZoom: 4, zoom: 0.42,
  });
  let progress = 0;

  function fit(): void {
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    surface.resize(w, h, 1);
    camera.resize(w, h);
    camera.centerOnTile(0, 0);
  }

  function paint(next: number): void {
    progress = next;
    palette.lerp(DUSK, NIGHT, progress);
    const pen = beginFrame({ surface, camera, palette, t: 0, clear: 'night', snap: true });
    const seen = camera.visibleTileBounds({ gx0: 0, gy0: 0, gx1: 0, gy1: 0 }, 2);
    const ground = palette.get('ground');
    const night = palette.get('night');
    for (let gy = seen.gy0; gy < seen.gy1; gy++) {
      for (let gx = seen.gx0; gx < seen.gx1; gx++) {
        // Two levels of relief and nothing else. `hash2` is Tier A, so this wallpaper is the
        // same on every machine — which matters not at all here, and is free.
        const n = hash2(7, gx, gy);
        const lift = n > 0.86 ? 6 : 0;
        // The tile color is mixed toward the ground slot by a hair. A backdrop that reads as a
        // pattern rather than as content is one whose contrast against its own background is
        // under about four percent, and this is that number.
        const fill = mix(night, ground, 0.055 + (n > 0.86 ? 0.05 : 0));
        isoTile(pen, gx, gy, fill, withAlpha(ground, 0.05), 0.06, lift);
      }
    }
    endFrame(pen);
  }

  fit();
  addEventListener('resize', () => { fit(); paint(progress); }, { passive: true });
  return { paint };
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * 3. The scenes.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/** What `examples/_shared/src/bootstrap.ts` parks on its mount element. Only the two members
 *  this page touches are declared; asking for more would couple the page to the exhibit kit. */
interface ExhibitBoot {
  readonly loop: { start(): void; stop(): void; readonly running: boolean; readonly stats: { readonly frameMs: number; readonly worstGapMs: number } };
}

/** Find the running exhibit inside a frame, or `undefined` if it is not reachable — a
 *  cross-origin frame, a frame that has not finished booting, or an exhibit that failed. */
function reachBoot(frame: HTMLIFrameElement): ExhibitBoot | undefined {
  try {
    const doc = frame.contentDocument;
    if (doc === null) return undefined;
    const hosts = [doc.getElementById('app'), doc.body];
    for (const host of hosts) {
      const found = (host as (HTMLElement & { __latticeBoot?: ExhibitBoot }) | null)?.__latticeBoot;
      if (found !== undefined) return found;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * A tile's pixel ratio, and the one number on this page that is a judgement call.
 *
 * Each tile is a whole exhibit at a 1000x625 viewport, and what it costs is *mostly* not this
 * ratio. Measured on this page: taking it from 0.85 to 0.7 — a fifth of the pixels — moved the
 * cadence with Crowd and Island live from 16.8 ms to 16.6 ms, which is nothing. What two live
 * exhibits cost is their draw calls, not their fill, exactly as `docs/PERFORMANCE.md` says. So the
 * ratio is chosen for how the tile looks and the running budget below is what pays for the frame. 0.85 on a mouse is a backing store of 850x531 per tile — softer than the device would
 * give but sharp enough for a moving miniature, and a little over half what `devicePixelRatio: 2`
 * would have charged. A phone gets 0.6, because a phone is the machine `docs/GALLERY.md` warns
 * this page will be judged on and it is also the one whose screen is smallest.
 */
const TILE_DPR = coarse ? 0.6 : 0.85;

/**
 * How many exhibits may have a *running loop* at one time.
 *
 * Measured on this page: an idle page holds a 4.8 ms cadence, one live tile takes it to 6.7 ms,
 * and two take it to 10.5 ms — so a live exhibit is worth about three milliseconds of somebody
 * else's frame. Two is comfortable in a two-column layout on a laptop. One column means a phone,
 * and a phone gets one, which is the constraint that makes eighteen live scenes affordable at
 * all: they are never all live.
 */
const maxRunning = () => (innerWidth < 900 ? 1 : 2);

/** One live world on the page: the hero, or a gallery tile. */
class Scene {
  readonly host: HTMLElement;
  readonly stage: HTMLElement;
  readonly src: string;
  readonly w: number;
  readonly h: number;
  readonly scaled: boolean;
  frame: HTMLIFrameElement | undefined;
  boot: ExhibitBoot | undefined;
  /** How much of this tile is on screen, kept by the observer so both policies below — which
   *  runs, and which is evicted — have the same number to sort on. */
  ratio = 0;
  /** Set by the visitor pressing Run on a reduced-motion or data-saver page. */
  armed = false;
  /** No `__latticeBoot` after two seconds: the loop cannot be reached, so pausing means
   *  unmounting. See {@link Scene.adopt}. */
  unreachable = false;
  /**
   * What this scene has most recently been told to be.
   *
   * It exists because an exhibit calls `boot.start()` itself, at module scope, whenever it
   * finishes loading — and a reader can scroll past a tile in the second between its iframe
   * being created and its script running. Without this the sequence is: mount, scroll away,
   * `pause()` finds no handle and correctly does nothing, the exhibit boots, and a world nobody
   * is looking at runs for the rest of the session. That is exactly how the hero was found
   * running four thousand pixels above the fold.
   */
  desired: 'run' | 'stop' = 'stop';

  constructor(host: HTMLElement, opts: { readonly scaled: boolean }) {
    this.host = host;
    const stage = host.querySelector<HTMLElement>('.stage, .hero-stage');
    this.stage = stage ?? host;
    const base = host.dataset['src'] ?? '';
    const extra = host.dataset['params'] ?? '';
    this.src =
      base === '' || !opts.scaled
        ? base
        : `${base}?dpr=${String(TILE_DPR)}${extra === '' ? '' : `&${extra}`}`;
    // One logical viewport for every screen, and two things that were tried and measured and are
    // *not* here, so nobody spends the afternoon again:
    //
    // - **A smaller viewport on a phone.** 1000x625 down to 760x475 moved a 4x-throttled cadence
    //   from 29.3 ms to 28.9 ms — nothing — and it costs the exhibit a fifth of the world its
    //   author framed, which is the one thing `docs/GALLERY.md` scores an exhibit on.
    // - **A lower pixel ratio.** 0.85 down to 0.7, a fifth of the fill, moved a two-tile cadence
    //   from 16.8 ms to 16.6 ms.
    //
    // Neither is where the money is. A live exhibit costs its draw calls, and the only lever that
    // has ever moved this page's frame is `maxRunning` below: how many of them run at once.
    this.w = Number(host.dataset['w'] ?? 1000);
    this.h = Number(host.dataset['h'] ?? 625);
    this.scaled = opts.scaled;
  }

  get mounted(): boolean { return this.frame !== undefined; }

  mount(): void {
    if (this.frame !== undefined || this.src === '') return;
    const frame = document.createElement('iframe');
    frame.setAttribute('title', this.host.dataset['name'] ?? 'A Lattice exhibit');
    frame.setAttribute('loading', 'eager');
    frame.setAttribute('scrolling', 'no');
    // The hero is a game a visitor plays; a tile is a picture that moves and the page owns its
    // pointer. `tabindex="-1"` on the tile frame keeps a keyboard user out of a decorative
    // document they cannot leave with Tab.
    if (this.scaled) frame.setAttribute('tabindex', '-1');
    frame.src = this.src;
    frame.addEventListener('load', () => { this.adopt(); }, { once: true });
    this.stage.append(frame);
    this.frame = frame;
    this.fit();
    this.host.dataset['state'] = 'live';
    this.desired = 'run';
  }

  /** Take hold of the exhibit once its module has run. `load` fires after deferred module
   *  scripts, so one poll is usually enough; the retries cover a slow first compile in dev. */
  adopt(tries = 0): void {
    const frame = this.frame;
    if (frame === undefined) return;
    const boot = reachBoot(frame);
    if (boot === undefined) {
      if (tries < 40) { setTimeout(() => { this.adopt(tries + 1); }, 50); return; }
      // Two seconds and no handle. Either the exhibit failed to boot or the gallery is being
      // served cross-origin, and in both cases there is no way to stop this loop except to take
      // its document away. Say so once rather than leaving a scene nobody can pause.
      this.unreachable = true;
      console.warn(`lattice: no boot handle in ${this.src} — this scene can only be paused by unmounting it`);
      return;
    }
    this.boot = boot;
    // The exhibit started itself on the way in. Re-apply whatever was decided while it booted.
    if (this.desired === 'run') this.resume();
    else this.pause();
    onAdopted(this);
  }

  /**
   * Whether this scene is being scaled down right now.
   *
   * Always, for a tile. For the hero only on a narrow screen: Lamp Road's overlay is composed for
   * a laptop and at 390 CSS pixels its own cards overlap each other, so a phone gets the exhibit
   * at a 840-pixel viewport shrunk to fit rather than at 390 with its HUD folded over itself.
   *
   * Scaling a *playable* frame is safe only because it is an iframe. Inside it, `clientX` and
   * `getBoundingClientRect` are both in the frame's own untransformed space, so
   * `@lattice/input`'s `clientX - rect.left` — which does not divide by any scale — is still
   * right. The same transform applied to a bare canvas would offset every tap by 1/scale.
   */
  get scaledNow(): boolean {
    return this.scaled || innerWidth < 840;
  }

  /** Fit the exhibit's own viewport into whatever box the layout gave this scene. */
  fit(): void {
    const frame = this.frame;
    if (frame === undefined) return;
    if (!this.scaledNow) {
      frame.style.transform = '';
      frame.style.width = '100%';
      frame.style.height = '100%';
      return;
    }
    const scale = this.stage.clientWidth / this.w;
    frame.style.width = `${String(this.w)}px`;
    // A tile's stage has the exhibit's aspect ratio, so this is exactly `this.h`. The hero's does
    // not, and it wants the whole box filled.
    frame.style.height = `${String(this.stage.clientHeight / scale)}px`;
    frame.style.transform = `scale(${String(scale)})`;
  }

  resume(): void {
    this.desired = 'run';
    if (this.frame === undefined) { this.mount(); return; }
    const loop = this.boot?.loop;
    if (loop !== undefined && !loop.running) loop.start();
    this.host.dataset['state'] = 'live';
  }

  pause(): void {
    this.desired = 'stop';
    const loop = this.boot?.loop;
    if (loop !== undefined) { if (loop.running) loop.stop(); this.host.dataset['state'] = 'paused'; return; }
    // Mounted but not yet adopted. Doing anything here is a mount/unmount loop across a scroll:
    // the frame is told to stop before it has finished starting, is destroyed, and is created
    // again on the next entry. `adopt` calls `schedule` when the handle arrives, and this
    // decision is made properly then.
    if (this.frame !== undefined) { if (this.unreachable) this.unmount(); return; }
    this.host.dataset['state'] = askFirst ? 'ask' : 'idle';
  }

  unmount(): void {
    this.desired = 'stop';
    this.frame?.remove();
    this.frame = undefined;
    this.boot = undefined;
    this.host.dataset['state'] = askFirst ? 'ask' : 'idle';
  }
}

/** How many exhibit documents may exist at once, running or not. A paused one still holds a
 *  canvas and a module graph, and a reader who has been through the whole gallery would
 *  otherwise be holding ten. Three is a row and a half on a laptop. */
const MAX_MOUNTED = 3;
const tiles: Scene[] = [];

function onAdopted(_scene: Scene): void { schedule(); }

function countLive(): void {
  const live = tiles.filter((s) => s.boot?.loop.running === true).length +
    (hero?.boot?.loop.running === true ? 1 : 0);
  const readout = document.querySelector('#live');
  if (readout !== null) readout.textContent = String(live);
}

/**
 * Decide what runs and what exists, from one sorted list.
 *
 * Both policies are the same question asked twice — *how much of this is the reader looking
 * at* — so they read the same number and are applied in the same pass. Doing it in two
 * observers is how a tile ends up mounted by one and stopped by the other on the same scroll.
 */
function schedule(): void {
  const byVisibility = [...tiles].sort((a, b) => b.ratio - a.ratio);
  const running = maxRunning();
  let started = 0;
  let mounted = 0;
  for (const scene of byVisibility) {
    const wanted = scene.ratio > 0 && (!askFirst || scene.armed);
    if (wanted && started < running) {
      scene.resume();
      started += 1;
      mounted += 1;
    } else if (scene.ratio > 0 && mounted < MAX_MOUNTED) {
      // On screen but over the running budget: keep the document, stop the clock.
      scene.pause();
      if (scene.mounted) mounted += 1;
    } else if (scene.mounted && mounted < MAX_MOUNTED) {
      scene.pause();
      mounted += 1;
    } else {
      scene.unmount();
    }
  }
  countLive();
}

const near = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const scene = tiles.find((s) => s.host === entry.target);
    if (scene !== undefined) scene.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
  }
  schedule();
  // `threshold` is a ladder rather than one value: the observer only fires when a ratio crosses
  // a rung, so a single `0.01` would report a tile as "0.01 visible" for the whole of its trip
  // up the screen and the sort above would have nothing to order by.
}, { rootMargin: '80px 0px', threshold: [0, 0.05, 0.25, 0.5, 0.75, 1] });

for (const host of document.querySelectorAll<HTMLElement>('.tile')) {
  const scene = new Scene(host, { scaled: true });
  tiles.push(scene);
  host.dataset['state'] = askFirst ? 'ask' : 'idle';
  new ResizeObserver(() => { scene.fit(); }).observe(scene.stage);
  near.observe(host);
  host.querySelector('.tile-run')?.addEventListener('click', (event) => {
    event.preventDefault();
    scene.armed = true;
    schedule();
  });
}
addEventListener('resize', schedule, { passive: true });

/* ── the hero ──────────────────────────────────────────────────────────────────────────── */

/** Held in a module binding on purpose. An `IntersectionObserver` that nobody references is a
 *  scene nobody stops the day a browser decides to collect it. */
let heroWatch: IntersectionObserver | undefined;
const heroHost = document.querySelector<HTMLElement>('.hero');
const hero = heroHost === null ? undefined : new Scene(heroHost, { scaled: false });

if (hero !== undefined && heroHost !== null) {
  if (askFirst) heroHost.dataset['state'] = 'ask';
  else hero.mount();

  // Off-screen the hero stops outright rather than dropping to a lower cadence. A stopped loop
  // is a cancelled `requestAnimationFrame`, which is the only cadence a phone actually rewards.
  heroWatch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) { hero.pause(); continue; }
      hero.resume();
      // Reduced motion, or a metered connection. The world is still built and still painted — it
      // is a real frame of a real game rather than a picture of one — and then its loop is
      // stopped before it animates. A blank rectangle would have been the easier answer and a
      // worse one: somebody who asked for stillness asked for stillness, not for nothing.
      if (askFirst && !hero.armed) hero.pause();
    }
    countLive();
  }, { threshold: 0 });
  heroWatch.observe(heroHost);

  new ResizeObserver(() => { hero.fit(); }).observe(hero.stage);
  const play = document.querySelector<HTMLButtonElement>('#hero-play');
  play?.addEventListener('click', () => {
    const on = heroHost.dataset['play'] !== 'on';
    heroHost.dataset['play'] = on ? 'on' : 'off';
    hero.armed = on;
    if (on) hero.resume();
    else if (askFirst) hero.pause();
    if (hero.frame !== undefined) hero.frame.style.pointerEvents = on ? 'auto' : 'none';
    play.textContent = on ? 'Stop playing' : 'Tap the world to play';
  });
  // A coarse pointer has no way to pan a world and scroll a page with the same gesture, so the
  // hero does not take the touch until it is asked. On a mouse there is no conflict and the
  // world is live from the first frame, which is the whole point of the header.
  if (coarse && hero.frame !== undefined) hero.frame.style.pointerEvents = 'none';
}

/**
 * Give the wheel back to the page.
 *
 * `@lattice/input` binds `wheel` on the canvas with `{ passive: false }` and calls
 * `preventDefault`, correctly — a game that lets the page scroll under a pinch is a broken game.
 * On a landing page that is exactly wrong, so a capture-phase listener on the frame's own
 * `window` takes the event before the canvas sees it and scrolls the parent instead. Capture
 * runs from the window down, so this wins regardless of which listener was registered first.
 *
 * `ctrlKey` is left alone: that is a trackpad pinch, and pinching the header to zoom the world
 * is the discovery this page is trying to provoke.
 */
const bridged = new WeakSet<Window>();

function forwardWheel(frame: HTMLIFrameElement): void {
  const view = frame.contentWindow;
  if (view === null || bridged.has(view)) return;
  bridged.add(view);
  view.addEventListener('wheel', (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    event.preventDefault();
    const perUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    scrollBy({ top: event.deltaY * perUnit, behavior: 'auto' });
  }, { capture: true, passive: false });
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * 4. The page's own frame cost.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

const meterFrame = document.querySelector('#m-frame');
const meterWorst = document.querySelector('#m-worst');
const meterCadence = document.querySelector('#m-cadence');

/**
 * A loop that renders nothing.
 *
 * Its `frameMs` is therefore meaningless and is not shown. What it is here for is `worstGapMs`:
 * the wall time between two *painted* frames, which on a page whose main thread is shared with
 * every live exhibit is the honest measure of what the reader is experiencing. If a gallery tile
 * blows the budget, this number is where it shows up.
 */
const pageLoop = createLoop({
  clock: { now: () => performance.now() },
  frames: browserFrames(),
  windowMs: 10_000,
});

let sampledAt = 0;
pageLoop.onRender((_alpha, _t, nowMs) => {
  if (nowMs - sampledAt < 250) return;
  sampledAt = nowMs;
  // A hidden tab has no rAF, so every figure below would freeze at whatever it last was and
  // read as a very fast page. Say so instead.
  const visible = document.visibilityState === 'visible';
  const heroLoop = hero?.boot?.loop;
  if (meterFrame !== null) {
    // A stopped loop keeps its last `frameMs` forever, and printing it beside the word "hero"
    // while the hero is off screen and not running is the same lie as printing 0.0 ms in a
    // hidden tab. Say which of the three states this is.
    meterFrame.textContent = !visible ? 'hidden'
      : heroLoop === undefined ? '—'
      : !heroLoop.running ? 'paused'
      : `${heroLoop.stats.frameMs.toFixed(1)} ms`;
  }
  if (meterWorst !== null) {
    const worst = pageLoop.stats.worstGapMs;
    meterWorst.textContent = !visible ? 'hidden' : `${worst.toFixed(1)} ms`;
    // 24 ms is a frame and a half at 60 Hz — the point at which a gap is something a reader can
    // see rather than something a profiler can. Not the 8 ms frame budget: that is what a pump
    // may cost, and a gap is not a pump.
    meterWorst.classList.toggle('hot', visible && worst > 24);
  }
  if (meterCadence !== null) {
    meterCadence.textContent = !visible ? 'hidden' : `${pageLoop.stats.cadenceMs.toFixed(1)} ms`;
  }
});
pageLoop.start();

/* ────────────────────────────────────────────────────────────────────────────────────────
 * The scroll, which drives all of the above.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

let queued = false;
function onScroll(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const span = Math.max(1, document.body.scrollHeight - innerHeight);
    applyNight(clamp01(scrollY / span));
    // The hero's frame may be created long after boot — a reduced-motion visitor presses Play —
    // so the wheel bridge is offered on every scroll and `bridged` makes the repeat free. A
    // frame that is replaced gets a fresh `Window` and therefore a fresh bridge.
    const frame = hero?.frame;
    if (frame !== undefined) forwardWheel(frame);
  });
}

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });
document.addEventListener('visibilitychange', countLive);
onScroll();
applyNight(0);
