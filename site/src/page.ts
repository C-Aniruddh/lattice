/**
 * **`@browser-only`** — the landing page's behavior. Not part of the kit, and nothing here may
 * move into `packages/`.
 *
 * It does three things, and all three are the kit running on its own marketing:
 *
 * 1. **The day cycle is the scroll bar.** `lerpPalette(DUSK, NIGHT, progress)` from
 *    `@latticekit/draw` writes the document's `--lattice-*` custom properties, so the page darkens
 *    as you descend using the same interpolation an exhibit uses for its sky. `lerpPalette`
 *    quantizes to `PALETTE_STEPS` internally, which is why this is affordable: the page is
 *    repainted about thirty times over a full scroll, not sixty times a second.
 * 2. **The backdrop is an isometric field**, drawn with `isoTile` into a fixed canvas, repainted
 *    only when that quantized step changes.
 * 3. **The gallery is live**, and pays for it: a tile's exhibit is a real page in an iframe,
 *    created the first time it comes near the viewport and `loop.stop()`ed the moment it leaves.
 *    An off-screen exhibit costs nothing because its loop is not running, which is a claim this
 *    page can make only because `@latticekit/loop` puts the frame source behind an interface.
 *
 * ## What it used to do and does not any more
 *
 * **It printed its own frame cost** — `hero worst 10s`, `page period`, `page worst 10s`, `scenes
 * live`, a figure in the proof strip and one on every tile — read live off a `@latticekit/loop`
 * that rendered nothing. The argument for it was that a page confident enough to display its own
 * render cost is making one, and the argument against it is the measurement: 35 ms on one laptop,
 * 41.5 ms on another, and worse than either on a slow machine. **A number that makes the product
 * look bad on hardware the page did not choose is a liability, not evidence**, and there is no
 * wording that fixes that. Every readout, the loop that fed them and the meters bound to elements
 * are gone. `meter.ts` is still here and every {@link Scene} still holds one; none of them has an
 * element to write to, so nothing about frame cost reaches a visitor.
 *
 * ## The trap this file is still written against
 *
 * **The exhibits are same-origin, deliberately.** `bootstrap` parks its `Boot` on the mount
 * element as `__latticeBoot`, so this page can reach a running exhibit's `loop` and stop it. If
 * the gallery is ever served from a different origin than the page, every pause here silently
 * becomes a no-op and eighteen worlds run at once behind the reader. {@link reachBoot} returns
 * `undefined` in that case and {@link Scene.pause} degrades to unmounting the frame, which is
 * slower but correct.
 */
import { DUSK, NIGHT, beginFrame, createCanvas2dSurface, createPalette, endFrame, extendStops, isoTile, lerpPalette, mix, withAlpha } from '@latticekit/draw';
import { createCamera } from '@latticekit/iso';
import { clamp01, hash2 } from '@latticekit/core';
import { createMeter } from './meter.js';
import type { LoopLike, Meter } from './meter.js';

/* ────────────────────────────────────────────────────────────────────────────────────────
 * What the visitor has told the browser they want.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
/** `saveData` is the only honest signal a page gets that it is on a metered or slow connection.
 *  It is absent on Safari, which is why it is read defensively rather than relied on. */
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
/** Auto-running nineteen worlds is the page's whole argument, and it is still not worth doing to
 *  somebody who asked for stillness or is paying by the megabyte. Both get a button instead. */
const askFirst = reduceMotion || saveData;

/* ────────────────────────────────────────────────────────────────────────────────────────
 * 1 + 2. The day cycle, and the field it lights.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The two slots this page adds to the kit's day cycle, and why they are slots rather than
 * constants in the stylesheet.
 *
 * `draw`'s `night` is the color of a sky: `#141a38` at dusk and `#080b1c` at midnight, both of them
 * blue, because behind a valley that is what night looks like. Behind a *document* it made the
 * whole page navy. The ground wanted to be a warm-neutral near-black at both ends — dark enough
 * that the amber accent reads as light landing on something, warm enough that it is not the flat
 * `#000` every terminal-themed page already is.
 *
 * `extendStops` is the sanctioned way to do that: `packages/draw` documents it as "the sanctioned
 * way to add a color to the day/night lerp", and its one warning is **hoist the results**, because
 * `Palette.lerp` compares stop sets by identity and a set rebuilt per frame bumps `rev` — the key
 * every cache in the kit hangs off. These are module scope for exactly that reason. Nothing here
 * reaches into `packages/`; the page brings its own colors to the kit's interpolation.
 */
const PAGE_STOPS = { dusk: 0x181410ff, night: 0x0c0a08ff } as const;
const PANEL_STOPS = { dusk: 0x231d17ff, night: 0x15110dff } as const;
const DUSK_PAGE = extendStops(DUSK, { page: PAGE_STOPS.dusk, panel: PANEL_STOPS.dusk });
const NIGHT_PAGE = extendStops(NIGHT, { page: PAGE_STOPS.night, panel: PANEL_STOPS.night });

const root = document.documentElement;
const groundCanvas = document.querySelector<HTMLCanvasElement>('#ground');

/**
 * The day cycle is the scroll bar on the landing page, and a fixed hour on `/reference/`.
 *
 * Both documents share this file, and the second one was reviewed as *"it doesn't use the black
 * theme, so looks inconsistent"* — correctly. The cycle runs from `#181410` at the top of a page
 * to `#0c0a08` at the bottom, and the landing page's top is covered by a hero, so the only place a
 * reader ever sees the lightest end **is** the reference, which opens on it and stays there
 * because it is one screen of table before the first heading.
 *
 * So the reference asks for the midnight end and holds it: `data-ground="night"` in the markup,
 * one value, no scroll binding. That is the right answer for a technical document for a second
 * reason as well — a page whose ground moves while somebody is reading a signature is a page
 * doing something for its own benefit, and the contrast floors are measured against the darkest
 * ground rather than sampled somewhere along a ramp.
 */
const groundFixed = document.body.dataset['ground'] === 'night' ? 1 : undefined;

/** The last palette step written to the document. The whole point of quantizing: two scroll
 *  positions inside one step produce byte-identical strings, so the backdrop is repainted about
 *  thirty times over a full scroll rather than sixty times a second. The count used to be printed
 *  in the footer's colophon, which was the page narrating its own scroll animation to somebody who
 *  was doing the scrolling. */
let lastKey = '';

const backdrop = groundCanvas === null ? undefined : makeBackdrop(groundCanvas);

function applyNight(progress: number): void {
  // `lerpPalette` snaps `progress` to one of PALETTE_STEPS levels before mixing, so two scroll
  // positions inside the same step produce byte-identical strings and the work below is skipped.
  // This is the same quantization `Palette.lerp` uses, and it is the reason an animated color is
  // safe here — see the ramp-cache note in docs/GALLERY.md.
  const vars = lerpPalette(DUSK_PAGE, NIGHT_PAGE, progress);
  const key = vars['night'] ?? '';
  if (key === lastKey) return;
  lastKey = key;
  for (const slot of Object.keys(vars)) root.style.setProperty(`--lattice-${slot}`, vars[slot] ?? '');
  backdrop?.paint(progress);
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
  const palette = createPalette(DUSK_PAGE);
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
    palette.lerp(DUSK_PAGE, NIGHT_PAGE, progress);
    // `page`, not `night`: the wallpaper clears to the same warm near-black the document does, or
    // a navy field shows through the one element that is behind everything.
    const pen = beginFrame({ surface, camera, palette, t: 0, clear: 'page', snap: true });
    const seen = camera.visibleTileBounds({ gx0: 0, gy0: 0, gx1: 0, gy1: 0 }, 2);
    const ground = palette.get('ground');
    const base = palette.get('page');
    for (let gy = seen.gy0; gy < seen.gy1; gy++) {
      for (let gx = seen.gx0; gx < seen.gx1; gx++) {
        // Two levels of relief and nothing else. `hash2` is Tier A, so this wallpaper is the
        // same on every machine — which matters not at all here, and is free.
        const n = hash2(7, gx, gy);
        const lift = n > 0.86 ? 6 : 0;
        // The tile color is mixed toward the ground slot by a hair. A backdrop that reads as a
        // pattern rather than as content is one whose contrast against its own background is
        // under about four percent, and this is that number.
        const fill = mix(base, ground, 0.055 + (n > 0.86 ? 0.05 : 0));
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
  readonly loop: LoopLike & { start(): void; stop(): void };
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

/** One column of tiles, one running scene: the layout is the budget. */
const narrow = () => innerWidth < 900;

/**
 * The longest edge of a held frame, in pixels, and the quality it is stored at.
 *
 * A tile that has been evicted keeps a picture of its own last frame instead of reverting to the
 * placeholder — see {@link Scene.capture}. That picture is a string in memory for the rest of the
 * visit, so it is stored at about the size the tile is drawn at rather than at the exhibit's
 * 1000x625 backing store: 440 px of JPEG is roughly 30 kB per tile, and ten of them is a third of
 * what one screenshot of this page would have cost — which is the whole reason this page has no
 * screenshots in it.
 */
const POSTER_W = 440;
const POSTER_Q = 0.7;

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
  /**
   * Distance from the viewport in CSS pixels, `0` while any part of this scene intersects it.
   *
   * **This is the number both policies sort on now, and the reason is the bug it replaces.**
   * Sorting on `ratio` alone cannot tell an off-screen tile from an on-screen one once the
   * mounted set is full: a tile one pixel below the fold reports a ratio just over zero, ties
   * with nothing, and keeps a document that a tile eighty percent visible then cannot have.
   * Reproduced on this page before the change — two tiles at `top=-91`, fully readable, blank for
   * as long as the reader looked at them, while `Caverns` at `top=975` held the third slot.
   */
  distance = Infinity;
  /** Set by the visitor pressing Run on a reduced-motion or data-saver page, or tapping a tile's
   *  poster on a phone, where only one scene may run and the visitor chooses which. */
  armed = false;
  /** `performance.now()` when this scene's loop last started. The warm-up window is measured from
   *  here rather than from page load: a scene resumed after a scroll pays its re-entry cost
   *  again, and quoting the first frame back as its steady cost is the same lie either way. */
  startedAt: number | undefined;
  /**
   * This scene's meter, which is now bound to nothing.
   *
   * It used to write the tile's own worst gap between two painted frames into `.cost`. **No frame
   * figure is printed to a visitor any more** — see the header — and the honest way to hold that
   * line is for there to be no element for one to land in, rather than a formatting decision that
   * somebody re-opens later. `createMeter(null)` is a no-op writer with the same lifecycle, so
   * `started`/`stopped`/`update` stay where they were and the machinery is one selector away from
   * working again if this is ever wanted internally.
   */
  readonly meter: Meter;
  /** Whether a frame of this world has been kept. Once true the placeholder never returns. */
  held = false;
  /** No `__latticeBoot` after two seconds: the loop cannot be reached, so pausing means
   *  unmounting. See {@link Scene.adopt}. */
  unreachable = false;
  /**
   * Whether this scene's document is an *exhibit*, and therefore has a loop this page can reach.
   *
   * Every gallery tile is; the ten-line example in Getting started is not. It is a plain Lattice
   * program — that is the entire point of printing it — so it does not call `bootstrap` and parks
   * no `__latticeBoot`, and the only way to stop its loop is to take its document away.
   *
   * **Declared in the markup rather than discovered**, because discovering it costs two seconds of
   * polling and a console warning on every mount, and because the *policy* has to differ before
   * the discovery lands. An unreachable scene must never be preloaded: {@link Scene.hold} mounts
   * it, {@link Scene.pause} can only unmount it, and the next scheduling pass holds it again — a
   * mount/unmount loop every 220 ms for as long as the reader is one screen away from it. That is
   * exactly what this page did before the flag existed, three warnings at a time in the console.
   */
  readonly managed: boolean;
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
    const managed = host.dataset['unmanaged'] !== 'yes';
    /**
     * The query every embedded exhibit is given, and the whole page-side of the frame-cost rule.
     *
     * `cost=0` is on **every** exhibit this page mounts, hero included. An exhibit opened directly
     * still prints its worst frame — that figure is a development gate and `docs/GALLERY.md` scores
     * an exhibit on it — but a figure measured on a stranger's machine, in the kit's own voice,
     * four seconds into their first visit, is a claim about their hardware and their other thirty
     * tabs rather than about Lattice. So the *embedder* asks for it to be suppressed, per exhibit,
     * and `examples/_shared`'s `bootstrap` answers with `boot.showCost`.
     *
     * **It is a URL parameter and not a stylesheet on purpose.** The rejected version was eleven
     * CSS selectors written here, reaching into eleven HUDs that variously call the node
     * `.card.cost`, `.gauge`, `.worst` and a bare span — a list that rots the first time any one of
     * them is renamed, silently, and in the direction of printing the figure again. Nothing in
     * `site/src/page.css` may target an exhibit's cost node; this line is the mechanism.
     *
     * Only managed scenes get it. `/example/` is a plain Lattice program rather than an exhibit —
     * it never calls `bootstrap`, has no HUD and prints no figure — so the key would be a
     * parameter nothing reads.
     */
    const query = [
      ...(opts.scaled ? [`dpr=${String(TILE_DPR)}`] : []),
      ...(opts.scaled && extra !== '' ? [extra] : []),
      ...(managed ? ['cost=0'] : []),
    ];
    this.src = base === '' || query.length === 0 ? base : `${base}?${query.join('&')}`;
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
    this.managed = managed;
    this.unreachable = !this.managed;
    this.meter = createMeter(null);
  }

  get mounted(): boolean { return this.frame !== undefined; }

  /** Re-read where this scene is. One `getBoundingClientRect` per scene per scheduling pass, all
   *  of them before any write, so the pass costs one layout flush rather than ten. */
  measure(): void {
    const r = this.host.getBoundingClientRect();
    this.distance = r.bottom > 0 && r.top < innerHeight ? 0 : r.top >= innerHeight ? r.top - innerHeight : -r.bottom;
  }

  /**
   * Keep this world's last painted frame, so evicting it does not blank it.
   *
   * A tile that has been mounted once and scrolled past is a place the reader has already been,
   * and returning them to an empty box with a diamond in it reads as a page that broke rather
   * than as a page that saved them a megabyte. The frame is real — it is the exhibit's own
   * canvas, drawn by the kit, a moment ago — so holding it is not a screenshot in the sense
   * `docs/GALLERY.md` forbids: nothing here is a picture of Lattice that was not Lattice running
   * on this machine, in this session, thirty seconds ago.
   *
   * Same-origin is what makes it possible at all. The same property that lets this page reach an
   * exhibit's `loop` lets it read the exhibit's canvas; a cross-origin gallery would taint it and
   * `toDataURL` would throw, which is what the `catch` is for and why it is silent.
   */
  capture(): void {
    const doc = this.frame?.contentDocument;
    if (doc === null || doc === undefined) return;
    let best: HTMLCanvasElement | undefined;
    for (const c of doc.querySelectorAll('canvas')) {
      if (best === undefined || c.width * c.height > best.width * best.height) best = c;
    }
    if (best === undefined || best.width === 0 || best.height === 0) return;
    try {
      const w = Math.min(POSTER_W, best.width);
      const off = document.createElement('canvas');
      off.width = w;
      off.height = Math.max(1, Math.round((best.height / best.width) * w));
      const ctx = off.getContext('2d');
      if (ctx === null) return;
      ctx.drawImage(best, 0, 0, off.width, off.height);
      this.stage.style.backgroundImage = `url("${off.toDataURL('image/jpeg', POSTER_Q)}")`;
      this.held = true;
      this.host.dataset['held'] = 'yes';
    } catch {
      // A tainted canvas. The placeholder stands, which is the honest fallback rather than a
      // blank one, and `unreachable` has already warned that this gallery is not same-origin.
    }
  }

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
    // Deliberately **not** `desired = 'run'`. A frame is created for two different reasons now —
    // because this scene is the one that runs, and because it is the next one the reader will
    // reach — and a mount that assumes the first starts a loop the budget did not authorize, for
    // the one tick before `adopt` calls `schedule` again. The caller has already said which it
    // wants; mounting is not the place to guess.
    this.host.dataset['state'] = 'paused';
  }

  /** Exist, painted, with the clock stopped: the preload state, and what a tile over the running
   *  budget but on screen is in. */
  hold(): void {
    this.desired = 'stop';
    if (this.frame === undefined) { requestMount(this); return; }
    this.pause();
  }

  /** Take hold of the exhibit once its module has run. `load` fires after deferred module
   *  scripts, so one poll is usually enough; the retries cover a slow first compile in dev. */
  adopt(tries = 0): void {
    const frame = this.frame;
    if (frame === undefined) return;
    // A scene that was declared unmanaged has nothing to take hold of, and polling forty times for
    // a handle the markup already said is not there is two seconds of timers and a warning about a
    // thing that is working as intended. Re-decide the schedule and stop.
    if (!this.managed) { onAdopted(this); return; }
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
   * Always, for a tile. For the hero, **whenever the box it was given is narrower than the
   * viewport the exhibit wants** — which is now a comparison against the stage rather than against
   * `innerWidth`, and that is a real fix rather than a tidy-up. The hero used to be the full width
   * of the page, so `innerWidth` and the stage were the same number; in a split hero the stage is
   * about half of it, and a 1440-pixel laptop was handing Lamp Road a 707-pixel viewport and being
   * told it did not need scaling. Its dock and its clock cards overlapped each other in the top
   * left, which is the same failure a 390-pixel phone had and the reason this test existed at all.
   *
   * The rule is the honest version of the same intent: an exhibit is composed for a screen, so
   * give it one and scale the result into whatever column the layout has.
   *
   * Scaling a *playable* frame is safe only because it is an iframe. Inside it, `clientX` and
   * `getBoundingClientRect` are both in the frame's own untransformed space, so
   * `@latticekit/input`'s `clientX - rect.left` — which does not divide by any scale — is still
   * right. The same transform applied to a bare canvas would offset every tap by 1/scale.
   */
  get scaledNow(): boolean {
    return this.scaled || this.stage.clientWidth < this.w;
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
    if (this.frame === undefined) { requestMount(this); return; }
    const loop = this.boot?.loop;
    if (loop !== undefined) {
      if (!loop.running) loop.start();
      // An exhibit calls `start()` itself at module scope, so a scene adopted while it is already
      // running has a clock this page never started. Stamp it here either way, or the warm-up
      // window is measured from `undefined` and the first mount spike is printed as steady state.
      if (this.startedAt === undefined) {
        this.startedAt = performance.now();
        this.meter.started(this.startedAt);
      }
    }
    this.host.dataset['state'] = 'live';
  }

  pause(): void {
    this.desired = 'stop';
    const loop = this.boot?.loop;
    if (loop !== undefined) {
      if (loop.running) {
        // Take the frame *before* the clock stops, while the canvas is certainly painted and the
        // world is at its most recent state. An eviction later reuses it for free.
        this.capture();
        loop.stop();
      }
      this.startedAt = undefined;
      this.meter.stopped();
      this.host.dataset['state'] = 'paused';
      return;
    }
    // Mounted but not yet adopted. Doing anything here is a mount/unmount loop across a scroll:
    // the frame is told to stop before it has finished starting, is destroyed, and is created
    // again on the next entry. `adopt` calls `schedule` when the handle arrives, and this
    // decision is made properly then.
    if (this.frame !== undefined) { if (this.unreachable) this.unmount(); return; }
    this.host.dataset['state'] = this.idleState;
  }

  unmount(): void {
    this.desired = 'stop';
    // Last chance: a scene evicted without ever being paused (the budget moved under it) still
    // has a painted canvas for one more statement.
    if (!this.held) this.capture();
    this.frame?.remove();
    this.frame = undefined;
    this.boot = undefined;
    this.startedAt = undefined;
    this.meter.stopped();
    this.host.dataset['state'] = this.idleState;
  }

  /**
   * What this scene looks like when it is not mounted, and why there are three answers.
   *
   * `ask` is a visitor who told the browser they want stillness or are paying by the megabyte:
   * nothing runs until they press the button. `held` is a tile they have already seen, which
   * keeps its own last frame. `idle` is the placeholder, and it is now the state a tile is only
   * ever in *before* its first mount — after that there is always a world to show.
   */
  get idleState(): string {
    return askFirst && !this.armed ? 'ask' : this.held ? 'held' : 'idle';
  }
}

/**
 * How many exhibit documents may exist beyond the ones the reader can see, and the ceiling on
 * the whole mounted set.
 *
 * **The floor is not a constant any more, and that is the fix.** The old policy capped the
 * mounted set at three whatever was on screen, so a laptop showing four tiles at once starved two
 * of them permanently: the cap was reached by whichever tiles were mounted first, and an
 * off-screen one that had got in kept its slot while a tile the reader was looking at could not
 * get one. Everything intersecting the viewport is mounted now, always, and the budget is spent
 * *beyond* that on the tiles the reader is about to reach.
 *
 * The ceiling is what stops an unusual viewport — a short wide window, a zoomed-out page —
 * mounting the whole gallery. It can never cut below the on-screen set; it only caps the
 * preload.
 */
const PRELOAD = () => (narrow() ? 1 : 2);
const MOUNT_CEILING = () => (narrow() ? 3 : 6);

/**
 * The smallest gap between two iframes being created, in milliseconds.
 *
 * Three exhibits booting in the same tick is what produced the tile reading `worst frame / 10s
 * 405.5 ms` — three module graphs, three first paints and three world builds competing for one
 * main thread, charged to whichever exhibit happened to have its HUD read. Spacing them costs a
 * reader nothing (a tile they have not reached yet arrives a fifth of a second later) and it
 * takes the spike out of the number rather than out of the readout.
 */
const MOUNT_GAP_MS = 220;

const tiles: Scene[] = [];

/** The tile a visitor asked for by name, on a screen that can only run one. It outranks distance:
 *  they pressed a button, which is a stronger signal than where they happen to have scrolled. */
let pinned: Scene | undefined;

let lastMountAt = -Infinity;
let mountTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Create this scene's frame, or come back in a moment and decide again.
 *
 * Deliberately *not* a queue. A queue mounts what was wanted when it was enqueued, and by the
 * time a slot frees the reader has usually scrolled somewhere else; re-running {@link schedule}
 * mounts what is wanted now.
 */
function requestMount(scene: Scene): void {
  const now = performance.now();
  const wait = MOUNT_GAP_MS - (now - lastMountAt);
  if (wait <= 0) {
    lastMountAt = now;
    scene.mount();
    return;
  }
  if (mountTimer !== undefined) return;
  mountTimer = setTimeout(() => { mountTimer = undefined; schedule(); }, wait);
}

function onAdopted(scene: Scene): void {
  // The drag hint is an instruction about a thing that has to exist first. `adopt` is the moment
  // this page can prove the hero's loop is reachable and running, which is the earliest honest
  // point to tell somebody to drag it.
  if (scene === hero) heroIsUp();
  schedule();
}

/**
 * Decide what runs and what exists, from one list sorted by distance from the viewport.
 *
 * Both policies are the same question asked twice — *how close is this to the reader's eye* — so
 * they read the same number and are applied in the same pass. Doing it in two observers is how a
 * tile ends up mounted by one and stopped by the other on the same scroll.
 *
 * The three rules, in the order they bind:
 *
 * 1. **Nothing intersecting the viewport is ever evicted.** Not for a preload, not for a
 *    ceiling, not for a tile that got there first. A blank tile the reader is looking at is the
 *    worst thing this page can do, because the gallery *is* the argument.
 * 2. **Whatever is left over is spent one screen ahead**, nearest first, so the next row is
 *    already painted when it arrives.
 * 3. **Only the closest few run.** Running is expensive; existing is not. A mounted, stopped
 *    exhibit is a cancelled `requestAnimationFrame` and a canvas holding its last frame.
 */
function schedule(): void {
  // Every read first, then every write. Interleaving them is ten forced layouts per pass.
  for (const scene of tiles) scene.measure();

  const order = [...tiles].sort((a, b) => a.distance - b.distance || b.ratio - a.ratio);
  // A visitor who asked for stillness gets nothing they did not press for; everyone else gets
  // the whole policy.
  const candidates = order.filter((s) => !askFirst || s.armed);
  const onScreen = candidates.filter((s) => s.distance === 0).length;
  // Rule 1 is this `Math.max`: the ceiling caps the preload and can never cut into what is
  // visible.
  const mountLimit = Math.max(onScreen, Math.min(onScreen + PRELOAD(), MOUNT_CEILING()));
  const runLimit = maxRunning();

  const runnable = candidates.filter((s) => s.distance === 0);
  if (pinned !== undefined && runnable.includes(pinned)) {
    runnable.splice(runnable.indexOf(pinned), 1);
    runnable.unshift(pinned);
  }
  const run = new Set(runnable.slice(0, runLimit));

  let mounted = 0;
  for (const scene of order) {
    if (run.has(scene)) {
      scene.resume();
      mounted += 1;
    } else if (candidates.includes(scene) && mounted < mountLimit && scene.managed) {
      // Wanted, but over the running budget: hold the document and stop the clock. If it has no
      // document yet this is where the preload happens.
      //
      // **`scene.managed` is the fourth rule, and it is a bug fix.** Holding means *exist with the
      // clock stopped*, and a scene whose loop this page cannot reach has no such state — the only
      // pause available to it is an unmount. So holding one mounts it, pausing it destroys it, and
      // the next pass holds it again: a mount/unmount loop every 220 ms for the whole time the
      // reader is one screen away. An unmanaged scene is therefore binary, running or gone, and
      // gives up its preload rather than its correctness.
      scene.hold();
      mounted += 1;
    } else {
      scene.unmount();
    }
  }
}

/**
 * The observer is now a *trigger*, not the policy.
 *
 * It exists to wake {@link schedule} the instant a tile's relationship to the viewport changes,
 * and its `intersectionRatio` survives only as a tie-break between two tiles in the same row.
 * Everything that decides anything reads `Scene.distance`, which is measured against the real
 * viewport rather than against a root inflated by `rootMargin` — the old code sorted on a ratio
 * that a tile eighty pixels *below the fold* reports as greater than zero, and then treated
 * "greater than zero" as "the reader can see it".
 *
 * `threshold` is a ladder rather than one value: the observer only fires when a ratio crosses a
 * rung, so a single `0.01` would report a tile as "0.01 visible" for the whole of its trip up the
 * screen and nothing would ever fire again.
 */
const near = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const scene = tiles.find((s) => s.host === entry.target);
    if (scene !== undefined) scene.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
  }
  schedule();
}, { rootMargin: '80px 0px', threshold: [0, 0.05, 0.25, 0.5, 0.75, 1] });

/**
 * Every scaled world on the page: the eighteen gallery tiles, the three games in `/one-sentence`,
 * and the ten-line example running beside its own listing in Getting started.
 *
 * The `.demo` and the `.game`s are in this list rather than beside it deliberately. Each is the
 * same thing a tile is — a real page in an iframe whose loop this page starts and stops — so they
 * belong to the same budget, sorted by the same distance from the reader's eye. Handing any of
 * them a loop of its own would be a scene no policy could evict, on the page whose argument is
 * that it never runs more than two at once.
 *
 * The three games are `data-unmanaged`: they were built by agents that had never seen this
 * repository, so they call nothing of `examples/_shared` and park no `__latticeBoot`. That does
 * not exempt them from the budget — it only means their pause is an unmount and their poster is
 * the frame they last painted. See {@link Scene.managed}.
 */
for (const host of document.querySelectorAll<HTMLElement>('.tile, .demo, .game')) {
  const scene = new Scene(host, { scaled: true });
  tiles.push(scene);
  host.dataset['state'] = scene.idleState;
  new ResizeObserver(() => { scene.fit(); }).observe(scene.stage);
  near.observe(host);
  host.querySelector('.tile-run')?.addEventListener('click', (event) => {
    event.preventDefault();
    scene.armed = true;
    // On a phone the running budget is genuinely one, so the poster is a control rather than a
    // decoration: pressing it is the visitor choosing which of ten worlds gets the frame. Without
    // the pin, distance decides and the tile they pressed loses to the one above it.
    pinned = scene;
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
  else hero.resume();

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

/* ────────────────────────────────────────────────────────────────────────────────────────
 * The drag hint, which deletes itself.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A hint with three states and an end, rather than a label with one.
 *
 * `DRAG IT` set in the corner of the header was signage: it named a gesture, demonstrated nothing,
 * appeared before there was anything to drag, and was still sitting there twenty seconds after the
 * reader had dragged. Three separate faults, and the fix for each is a moment in this file:
 *
 * | fault | when it is fixed |
 * |---|---|
 * | it was there before the world was | {@link heroIsUp} — the frame has booted and its loop is reachable |
 * | it described the gesture instead of miming it | CSS, a ±11 px slide on a two-second loop |
 * | it outlived its own instruction | {@link retireHint} — the first `pointerdown`, and it never comes back |
 *
 * **Permanently** is the word that matters in the third row. Not hidden, not faded, `remove()` —
 * a reader who has dragged the world has learned the thing the header exists to teach, and an
 * instruction they have already followed is furniture over a live scene.
 *
 * The slide is `prefers-reduced-motion`-gated in the stylesheet rather than here, because a reader
 * who asked for stillness still has to be told the header is a game: they keep the pill and lose
 * the motion.
 */
const hintEl = document.querySelector<HTMLElement>('[data-hint]');
let hintRetired = false;

function heroIsUp(): void {
  // Both bridges, at the first moment the frame's `Window` exists. `onScroll` offers them again
  // on every scroll and both are idempotent, but a reader who never scrolls still gets a hint
  // that retires itself and a wheel that scrolls the page.
  const frame = hero?.frame;
  if (frame !== undefined) { forwardWheel(frame); watchDrag(frame); }
  if (hintRetired || hintEl === null) return;
  hintEl.dataset['hint'] = 'on';
}

function retireHint(): void {
  hintRetired = true;
  hintEl?.remove();
}

/**
 * Notice the first drag, from inside the frame.
 *
 * Events in an iframe do not bubble into the parent, so a listener on `.hero` never fires — the
 * exhibit's canvas has the pointer. Same-origin is what makes this possible at all, exactly as it
 * is for {@link forwardWheel} and {@link Scene.capture}, and a cross-origin gallery degrades to a
 * hint that stays until the visitor scrolls the header off screen. `pointerdown` rather than a
 * real drag threshold: a press on a world is already the discovery, and waiting for movement
 * leaves the pill sitting under the reader's own finger.
 */
const dragWatched = new WeakSet<Window>();

function watchDrag(frame: HTMLIFrameElement): void {
  const view = frame.contentWindow;
  if (view === null || dragWatched.has(view)) return;
  dragWatched.add(view);
  view.addEventListener('pointerdown', retireHint, { capture: true, passive: true, once: true });
}

/**
 * Give the wheel back to the page.
 *
 * `@latticekit/input` binds `wheel` on the canvas with `{ passive: false }` and calls
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
 * The page's own frame cost, which is no longer measured or shown.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * **There was a fourth thing here and it is gone on purpose.**
 *
 * A `@latticekit/loop` that rendered nothing ran for the life of the page so that `worstGapMs` —
 * the wall time between two painted frames, with every live exhibit on the same main thread —
 * could be printed in four places: the meter bay under /why, the sixth cell of the proof strip,
 * and a figure on the hero and on every tile.
 *
 * The argument for it was good and the measurement killed it. It read 35 ms on one laptop and
 * 41.5 ms on another, and a slow machine reads worse than either — so the page's own instrument
 * was, on most hardware, an argument against the page. **A metric that makes the product look bad
 * on the reader's own machine is a liability rather than evidence**, and there is no way to word
 * around a number the reader can see. So the readouts, the loop that fed them and the warm-up
 * bookkeeping are all deleted rather than hidden: a hidden meter is a meter somebody re-enables.
 *
 * What survives is the *policy* the meter was watching, which never depended on printing anything
 * — {@link schedule}'s running budget, the eviction order, and the same-origin `loop.stop()` that
 * makes an off-screen exhibit free. `meter.ts` is still here and every {@link Scene} still holds a
 * meter; none of them is bound to an element.
 */

// A tab that comes back has been away for an unknown length of time. Nothing is printed from a
// scene's clock any more, but `Scene.startedAt` is still what a resumed loop is timed from, and a
// stamp from before the tab was hidden would make the next resume look instantaneous.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = performance.now();
  for (const scene of tiles) if (scene.startedAt !== undefined) scene.startedAt = now;
  if (hero !== undefined && hero.startedAt !== undefined) hero.startedAt = now;
});

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
    applyNight(groundFixed ?? clamp01(scrollY / span));
    // The hero's frame may be created long after boot — a reduced-motion visitor presses Play —
    // so the wheel bridge is offered on every scroll and `bridged` makes the repeat free. A
    // frame that is replaced gets a fresh `Window` and therefore a fresh bridge.
    const frame = hero?.frame;
    if (frame !== undefined) { forwardWheel(frame); watchDrag(frame); }
    // Distance is a scroll position, so the gallery's policy is re-decided on the same rAF that
    // repaints the sky. The observer alone is not enough: it fires when a *threshold* is crossed,
    // and two tiles in the same row cross none of them while the row slides up the screen.
    spy();
    schedule();
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * The rail, the hash, and the one state that has to be true at the same time.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Keep the active nav item and the URL in the address bar agreeing with each other.
 *
 * A reviewer found the rail claiming `GALLERY` while the address bar said `#reference` and the
 * page was at the top. The page had **no scroll spy at all** — what looked like an active item
 * was the `:hover` and focus color left on the last link that was clicked, which is a state with
 * no expiry and no relationship to where the reader is.
 *
 * So the section is derived from the scroll position, once, and drives both: the `aria-current`
 * on the rail *and* `history.replaceState`. They cannot disagree because they are the same
 * assignment. `replaceState` rather than `pushState` — the hash follows the reader so the URL
 * stays copyable at any point, and the Back button keeps meaning "the section I clicked to",
 * which is what an anchor already pushed.
 */
const navLinks = new Map<string, HTMLAnchorElement>();
for (const a of document.querySelectorAll<HTMLAnchorElement>('.topnav a')) {
  const href = a.getAttribute('href') ?? '';
  if (href.startsWith('#')) navLinks.set(href.slice(1), a);
}
const spied = [...document.querySelectorAll<HTMLElement>('main .section[id]')];
let spiedId = '\u0000';

function spy(): void {
  // **A document with no spied sections is not a document with none active.** `/reference/` has no
  // `.section[id]` at all, so `current` is always `''` here, and the `replaceState` below would
  // strip the fragment off `/reference/iso/#createCamera` the first time the reader scrolled — a
  // deep link that erases itself under the person who followed it.
  if (spied.length === 0) return;
  // A third of the way down is where a reader is actually reading, not the top edge: a section
  // whose first pixel has appeared is not the section anybody is in.
  const line = innerHeight * 0.34;
  let current = '';
  for (const section of spied) {
    const r = section.getBoundingClientRect();
    if (r.top <= line && r.bottom > line) current = section.id;
  }
  if (current === spiedId) return;
  spiedId = current;
  for (const [id, a] of navLinks) {
    if (id === current) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
  const url = current === '' ? `${location.pathname}${location.search}` : `#${current}`;
  history.replaceState(null, '', url);
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * The two controls on the example, and why a code block on a phone needs them.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * 822 pixels of program in a 343-pixel box.
 *
 * The block scrolls correctly inside its own container, which is the part that is easy, and every
 * line that says anything truncates mid-expression, which is the part that matters. A reader on a
 * phone is not going to drag sideways through forty-eight lines. **Wrap** turns the block into
 * something readable at the cost of the column alignment, and **Copy** is the honest admission
 * that the real answer on a phone is to read it somewhere else.
 *
 * Both are `js-only` in the markup: with script off there is nothing here that could work, and
 * `docs/GALLERY.md` asks this page to be honest rather than graceful about that.
 */
for (const box of document.querySelectorAll<HTMLElement>('.codebox')) {
  const pre = box.querySelector('pre');
  const wrap = box.querySelector<HTMLButtonElement>('[data-code-wrap]');
  const copy = box.querySelector<HTMLButtonElement>('[data-code-copy]');
  // A phone is where the truncation is, so a phone is where it starts wrapped. A laptop shows the
  // program as its author aligned it.
  if (innerWidth < 640) box.dataset['wrap'] = 'on';
  wrap?.addEventListener('click', () => {
    const on = box.dataset['wrap'] !== 'on';
    box.dataset['wrap'] = on ? 'on' : 'off';
    wrap.setAttribute('aria-pressed', String(on));
  });
  wrap?.setAttribute('aria-pressed', String(box.dataset['wrap'] === 'on'));
  copy?.addEventListener('click', () => {
    const text = pre?.textContent ?? '';
    void navigator.clipboard.writeText(text).then(
      () => { say(copy, 'Copied'); },
      // `writeText` rejects without a secure context or a user-activation the browser believed
      // in. Saying so beats a button that silently does nothing.
      () => { say(copy, 'Press ⌘C'); },
    );
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * The install, as a terminal with tabs.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * One visible command, the variants behind tabs, and a copy that yields a clean line.
 *
 * The line this replaces named five packages, ran to 89 characters, and wrapped to three — the
 * longest install command in a comparison of twenty-five developer pages, printed on the page
 * whose whole thesis is *small*.
 *
 * Three details are the whole widget:
 *
 * 1. **`[data-cmd]` is what Copy reads**, not the `<pre>`. The `$` is a picture of a shell and is
 *    `user-select: none` besides, so neither a drag-select nor this button can put it on somebody's
 *    clipboard in front of the command they are about to run.
 * 2. **The typewriter restarts on every tab change.** Swapping a finished string in would make the
 *    tabs feel like a table of contents; re-typing makes them feel like the same terminal being
 *    used again. `data-type` is removed, the layout is read once to flush the animation, and it is
 *    set again — the one deliberate forced reflow on this page, on a click, costing nothing.
 * 3. **The tablist is a real tablist.** `role`, `aria-selected` and roving `tabindex` are in the
 *    markup; the arrow keys are here. A tab strip a keyboard cannot cross is a tab strip that hides
 *    four of its five commands from anybody not using a mouse.
 */
for (const term of document.querySelectorAll<HTMLElement>('[data-term]')) {
  const tabs = [...term.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  // `.term-panel`, not `.term-cmd`. A panel is a sequence now — two of the three installs are two
  // commands followed by a sentence about what happens next — so the unit that is shown and hidden
  // is the panel, and the typewriter is driven from it rather than from each line.
  const panels = [...term.querySelectorAll<HTMLElement>('.term-panel')];
  const copy = term.querySelector<HTMLButtonElement>('[data-term-copy]');
  let shown = 0;

  function show(next: number, focus: boolean): void {
    shown = (next + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      const on = i === shown;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = panels[i];
      if (panel === undefined) return;
      panel.dataset['on'] = on ? 'yes' : 'no';
      panel.removeAttribute('data-type');
      if (on) {
        // Read a layout property to flush the removal, or the browser coalesces both writes and
        // the animation never restarts. `offsetWidth` is the cheapest such read.
        void panel.offsetWidth;
        panel.dataset['type'] = 'run';
      }
    });
    if (focus) tabs[shown]?.focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => { show(i, false); });
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); show(shown + 1, true); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); show(shown - 1, true); }
      else if (event.key === 'Home') { event.preventDefault(); show(0, true); }
      else if (event.key === 'End') { event.preventDefault(); show(tabs.length - 1, true); }
    });
  });

  copy?.addEventListener('click', () => {
    // Every command in the shown panel, newline-joined, and nothing else. `[data-cmd]` rather than
    // the `<pre>` is what keeps the `$` and the `>` off somebody's clipboard — and a two-step
    // install that copied only its first step would be worse than one that copied nothing, because
    // it looks like it worked.
    const text = [...(panels[shown]?.querySelectorAll('[data-cmd]') ?? [])]
      .map((n) => n.textContent ?? '')
      .join('\n');
    void navigator.clipboard.writeText(text).then(
      () => { say(copy, 'Copied'); },
      () => { say(copy, 'Press ⌘C'); },
    );
  });

  show(0, false);
}

/** Flash a word on a button and put its own label back. */
function say(button: HTMLButtonElement, word: string): void {
  const was = button.dataset['label'] ?? button.textContent ?? '';
  button.dataset['label'] = was;
  button.textContent = word;
  setTimeout(() => { button.textContent = was; }, 1600);
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Provenance, for the reader rather than for the agent.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every headline figure on this page already carried the command that produced it — in
 * `/api.json`, where only an agent would ever look. The strip reveals it on hover, which is free,
 * and on tap, which is not: a touch device has no hover, so the same disclosure needs a control.
 *
 * The control is the figure itself. It is a `<button>` in the markup with `aria-expanded`, so a
 * screen reader is told there is something behind it and a keyboard reaches it with Tab, and the
 * hover path is pure CSS so it works before this file has run.
 */
for (const fig of document.querySelectorAll<HTMLButtonElement>('.fig')) {
  fig.addEventListener('click', () => {
    const open = fig.getAttribute('aria-expanded') !== 'true';
    // One at a time. Two provenance notes open at once on a six-column strip overlap each other.
    for (const other of document.querySelectorAll('.fig')) other.setAttribute('aria-expanded', 'false');
    fig.setAttribute('aria-expanded', String(open));
  });
}
document.addEventListener('click', (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest('.fig') !== null) return;
  for (const fig of document.querySelectorAll('.fig')) fig.setAttribute('aria-expanded', 'false');
});

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });
onScroll();
applyNight(groundFixed ?? 0);
