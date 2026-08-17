/**
 * **`@browser-only`** — the thirty lines of boot that would otherwise sit at the top of every
 * exhibit, written once.
 *
 * ```ts
 * const boot = bootstrap({ actions: { touch: ['tap'] }, bounds: worldRect });
 * boot.onUpdate((dt) => { world.step(dt); });
 * boot.onRender((pen) => {
 *   boot.light.begin(pen, night, 'night');
 *   fill(boot.order);
 *   renderFrame(pen, passes, boot.order);
 * });
 * boot.start();
 * ```
 *
 * ## Why this is a function and not a paragraph of documentation
 *
 * The first exhibit wrote that boot by hand and reported that **two of its steps are silent
 * when they are wrong** — they throw nothing, log nothing, and produce a picture that looks
 * plausible. Documentation does not help with those; the only fix is to remove the place the
 * mistake can be made. Both are gone from this surface rather than described in it.
 *
 * **1. `stepMs`.** `createInput` counts every gesture duration in ticks and multiplies by the
 * `stepMs` it was handed; it never reads a clock. It rejects zero and `NaN` and accepts every
 * other number, so `stepMs: 16` against a loop running at 16.667 is a long press that fires at
 * 432 ms, a fling velocity 4% low, and a recorded input log that a replay will refuse months
 * later with a message about a mismatch nobody can explain. **There is no `stepMs` in
 * {@link BootOptions}.** This module builds the loop and the input, in that order, and passes
 * `loop.stepMs` across — including on every rebuild {@link Boot.setProfile} performs, which is
 * the second place the same literal used to get typed.
 *
 * **2. The light field and the pen.** `LightField` is attached to a frame through one optional
 * field of `beginFrame`'s options object. Omit it and `pen.light` is `undefined`; then
 * `renderFrame`'s `pen.light?.composite()` does nothing, `drawSprite` skips every sprite's
 * `emit` hook, and every `light.add()` you make accumulates into a buffer nobody ever reads.
 * No error, no warning, no night — a fully lit world and a light field that reports `active`
 * and `count` exactly as if it were working. **The exhibit never calls `beginFrame`.**
 * {@link Boot.onRender} hands over a pen this module built, with this module's own field
 * already on it, and there is no option anywhere here that detaches them. A field is created
 * unconditionally for the same reason: `LightField` allocates nothing and costs nothing while
 * `darkness` is 0, so "an exhibit with no night" and "an exhibit that forgot to wire its night"
 * do not need to be different code paths.
 *
 * A third was silent and is closed for free: `surface.resize(w, h, ratio)` takes the ratio as a
 * parameter, and passing `devicePixelRatio` there — the obvious thing to write — walks straight
 * past the `maxPixelRatio` clamp `createCanvas2dSurface` applied, so a 3× phone quietly renders
 * 2.25× the pixels it budgeted for. {@link fit} reads `surface.pixelRatio` back off the surface.
 *
 * ## What it deliberately does not do
 *
 * **It does not frame the world.** Choosing the zoom and center that make the first frame the
 * pitch is the most exhibit-specific decision there is, and `iso` is growing `camera.fitBounds`
 * for it. Pass `bounds` and call `boot.camera` yourself.
 *
 * **It does not hold a drawable list.** Which object owns the parallel array beside
 * `DepthSorter` is an open question with an RFC of its own, and guessing at it here would put
 * fourteen exhibits on the wrong side of the answer.
 *
 * **It does not draw a HUD, own a palette schedule, or make any sound.** Those are the exhibit.
 */

import { createRng, createScope, type Rng, type Scope, type Disposer } from '@lattice/core';
import { DepthSorter, createCamera, rectCenterX, rectCenterY, type Camera, type Rect } from '@lattice/iso';
import {
  BASE_SLOTS,
  beginFrame,
  createCanvas2dSurface,
  createLightField,
  createPalette,
  endFrame,
  type Ink,
  type LightField,
  type LightFieldOpts,
  type Palette,
  type Pen,
  type Stops,
  type Surface,
} from '@lattice/draw';
import { createInput, type ActionEvent, type ActionMap, type DomInputSystem, type GestureMap, type ProfileOverrides } from '@lattice/input';
import { browserFrames, createLoop, createTweens, type Loop, type Tweens } from '@lattice/loop';
import { PANEL_CLASS } from './panel.js';
import { readParams, type Params } from './params.js';

/**
 * The camera policy, as the panel needs to see it.
 *
 * `CameraOptions` is applied at construction and `Camera` exposes no reader for any of it — no
 * `minZoom`, no `keepVisible` — so a control panel that wants to *show* the clamp it is about
 * to move has nowhere to read it from. This mirror is the gallery's answer, and the fact that
 * it has to exist is filed as a kit finding.
 */
export interface CameraPolicy {
  /** How far out the player may pull. See `CameraOptions.minZoom`. */
  readonly minZoom: number;
  /** How far in. See `CameraOptions.maxZoom`. */
  readonly maxZoom: number;
  /** Where it starts. Clamped into the pair above by `iso`. */
  readonly zoom: number;
  /** Fraction of the viewport that must still show `bounds` after any gesture. */
  readonly keepVisible: number;
}

/** Everything an exhibit may choose. The defaults are a scene that renders. */
export interface BootOptions<A extends string> {
  /** Where the canvas goes. A selector, an element, or nothing — `#app` then `<body>`. */
  readonly mount?: string | HTMLElement;
  /** The default seed when the URL names none. Every exhibit is `?seed=`-addressable. */
  readonly seed?: string;
  /** The world rectangle the camera may look at. Usually `tileBounds(0, 0, w, h, maxHeightPx)`. */
  readonly bounds?: Readonly<Rect>;
  /** Camera policy. Each field is overridable from the URL; see {@link Boot.camera}. */
  readonly camera?: Partial<CameraPolicy>;
  /** The palette's opening stop set. Defaults to `BASE_SLOTS`, which renders. */
  readonly palette?: Stops;
  /** Painted under everything, every frame. A slot name, so it recolors with the palette. */
  readonly clear?: Ink;
  /** Light field tuning. `scale` and `bloom` are read from the URL; see the panel's knobs. */
  readonly light?: LightFieldOpts;
  /** Depth sorter capacity. It grows by doubling, so this is a warm-up hint and not a limit. */
  readonly depth?: number;
  /** The action map. Its keys become the names `boot.onAction` accepts. */
  readonly actions?: ActionMap<A>;
  /** Gesture threshold overrides. The URL may override these again. */
  readonly profile?: ProfileOverrides;
  /** `false` for a fixed camera. Gestures still arrive; nothing drives the camera. */
  readonly control?: boolean;
  /** CSS color painted on the host element, behind the canvas. Only ever seen for one frame. */
  readonly background?: string;
}

/** What an exhibit is handed. Read `camera`, `light` and `input` **through this object** — the
 *  panel replaces all three when a construction-time knob moves, and a cached reference to any
 *  of them survives the swap as a live object nothing is driving any more. */
export interface Boot<A extends string> {
  /** The element `input` is bound to and `surface` draws into. */
  readonly canvas: HTMLCanvasElement;
  /** The draw target. Sized in CSS pixels; the device ratio is its own business. */
  readonly surface: Surface;
  /** The transform. Replaced by {@link Boot.setCamera}. */
  readonly camera: Camera;
  /** Slot colors. Never replaced — a palette is mutable and rebuilding it would drop the
   *  exhibit's own slots. */
  readonly palette: Palette;
  /** The night. Always present, always attached to the pen. Replaced by {@link Boot.setLight}. */
  readonly light: LightField;
  /** The frame's order. Cleared by the exhibit, not here: what goes in it is the exhibit. */
  readonly order: DepthSorter;
  /** Stepped on `update`, so a tween does not freeze in a background tab. */
  readonly tweens: Tweens;
  /** The clock. Started by {@link Boot.start}. */
  readonly loop: Loop;
  /** Bound to the canvas at `loop.stepMs`. Replaced by {@link Boot.setProfile}. */
  readonly input: DomInputSystem<A>;
  /** Teardown for anything the exhibit owns. Disposed with the boot. */
  readonly scope: Scope;
  /** The seed in force, from `?seed=` or the default. */
  readonly seed: string;
  /** Seeded from {@link Boot.seed}. The exhibit's world generator. */
  readonly rng: Rng;
  /** The URL, read and written. A panel control's storage. */
  readonly params: Params;
  /** The camera policy currently in force — what `iso` will not tell you. */
  readonly cameraPolicy: Readonly<CameraPolicy>;
  /** The light options currently in force — what `draw` will not tell you. */
  readonly lightOpts: Readonly<Required<LightFieldOpts>>;

  /**
   * **The number `docs/GALLERY.md` § Scale's cost row gates this exhibit on**: the worst gap
   * between two painted frames in the last ten seconds, in milliseconds.
   *
   * Read this rather than `loop.stats.worstFrameMs`, and rather than writing the meter again.
   * Four exhibits hand-rolled a worst-frame readout before `loop` grew one and **produced three
   * different wrong answers between them** — two reading `0.0 ms` on scenes with a measured
   * 9.2 ms gap, one reading its own warm-up spike for the whole session. The reasons were all
   * the same reason: `worstFrameMs` is the *pump's own work*, so a collection or a style
   * recalculation landing between two pumps is not in it, and it never decays, so rolling it
   * needs a `resetStats()` on a timer that zeroes `fps` for every other reader of the same
   * object. This field is `loop.stats.worstGapMs`, which has neither problem.
   *
   * `0` until the first gap is measured, and the opening `loop.warmupFrames` are excluded — the
   * page's load is not the scene's steady cost. See `@lattice/loop`'s `FrameStats`.
   */
  readonly worstMs: number;

  /**
   * The display's period as the loop actually observed it — the *shortest* gap in the same
   * window.
   *
   * {@link Boot.worstMs} is meaningless without it: a frame gap contains a whole display period,
   * so 8.4 ms is a perfect frame on the 120 Hz laptop this gallery is built on and 16.8 ms is a
   * perfect one on a 60 Hz panel. **The verdict is the ratio, not the number** — a worst gap
   * under about one and a half cadences dropped no frames — and a HUD that shows the pair lets a
   * visitor check the arithmetic on their own machine instead of trusting a threshold that was
   * calibrated on somebody else's.
   */
  readonly cadenceMs: number;

  /** Fixed-step. `input.tick` has already run; `tweens` step after you. */
  onUpdate(fn: (dt: number, tick: number) => void): Disposer;
  /**
   * Draw. The pen is open, cleared, and carries {@link Boot.light}; it closes after you return.
   *
   * `input.frame(nowMs)` has already run, so the camera's glide is where the player put it.
   */
  onRender(fn: (pen: Pen, alpha: number, nowMs: number) => void): Disposer;
  /** The viewport changed. Surface, camera and light field are already resized. */
  onResize(fn: (width: number, height: number) => void): Disposer;

  /** Subscribe to a declared action. Survives an input rebuild; `input.onAction` does not. */
  onAction(action: A, handler: (event: ActionEvent<A>) => void): Disposer;
  /** Subscribe to a raw gesture. Survives an input rebuild; `input.on` does not. */
  on<K extends keyof GestureMap>(type: K, handler: (gesture: GestureMap[K]) => void): Disposer;

  /** Begin. Nothing runs before this — no rAF, no timer, no listener that mutates anything. */
  start(): void;
  /** Stop, unbind everything, and release both light buffers. Wired to HMR already. */
  dispose(): void;

  /**
   * Retune the gestures. **Rebuilds the input system**, because `GestureProfile` is resolved at
   * construction and `input.profile` is frozen.
   *
   * Every subscription made through {@link Boot.onAction} and {@link Boot.on} is re-registered
   * onto the new system, in the order it was made. One made through `boot.input` directly is
   * not, and is the reason those two exist.
   */
  setProfile(overrides: ProfileOverrides): void;
  /**
   * Move the camera clamps. **Rebuilds the camera and the input**, because `CameraOptions` is
   * construction-time and `input` holds the camera it was built with. Position and zoom carry
   * across.
   */
  setCamera(policy: Partial<CameraPolicy>): void;
  /** Retune the night. **Rebuilds the field's two buffers**, because `scale` and `bloom` are
   *  construction-time. `falloff` is only the default for `add`, which takes it per call. */
  setLight(opts: LightFieldOpts): void;
  /** Resample. Clamped to `[0.25, 4]`; the surface is resized in place. */
  setPixelRatio(ratio: number): void;
  /** Whole-device-pixel snapping, `FrameOpts.snap`. Off is a shimmer you can see on a pan. */
  setSnap(on: boolean): void;
}

/** Resolve the mount point without making an exhibit write the same three-way fallback. */
function resolveMount(mount: string | HTMLElement | undefined): HTMLElement {
  if (mount instanceof HTMLElement) return mount;
  if (typeof mount === 'string') {
    const found = document.querySelector(mount);
    if (found instanceof HTMLElement) return found;
    throw new Error(`bootstrap.mount: no element matches ${mount}`);
  }
  const app = document.getElementById('app');
  return app ?? document.body;
}

/**
 * Where a live boot parks its own teardown, on its mount element.
 *
 * A property on the DOM rather than a module-level `WeakMap`: a hot reload replaces the module
 * and every variable in it, and the whole point of this handle is to survive exactly that.
 */
const PREVIOUS_BOOT = '__latticeExhibitBoot';

/**
 * Where the live boot parks itself so an exhibit can be **measured without being edited**.
 *
 * The cost row makes the worst frame a gate, and checking a gate means reading a number off an
 * exhibit somebody else owns and is mid-flight on. Every alternative is worse: adding a readout
 * to the exhibit changes the thing being measured and puts a reviewer's diff in an author's file,
 * and re-measuring with a `requestAnimationFrame` loop in the console measures the console's rAF
 * rather than the exhibit's loop, which is how you end up comparing two instruments and learning
 * nothing about either.
 *
 * `document.getElementById('app').__latticeBoot.loop.stats` in a devtools console, and that is
 * the whole feature. It is a *read* handle by convention only — nothing here can stop somebody
 * driving an exhibit through it, and nothing here should: this is the gallery's own debug surface
 * and it ships to a page whose entire purpose is being looked at.
 */
const LIVE_BOOT = '__latticeBoot';

/** The gallery's pixel-ratio band. Below 0.25 nothing is legible; above 4 a phone drops frames
 *  for a difference no display can show. The panel's `dpr` knob lives inside it. */
const MIN_RATIO = 0.25;
const MAX_RATIO = 4;

/**
 * Build a scene.
 *
 * Reads `?seed=` and every construction-time panel key from the URL *before* it builds
 * anything, so a shared link produces its configuration on the first frame rather than
 * rebuilding into it on the second.
 */
export function bootstrap<A extends string = never>(options: BootOptions<A> = {}): Boot<A> {
  const params = readParams();
  const seed = params.str('seed', options.seed ?? 'lattice');
  const rng = createRng(seed);
  const scope = createScope();

  // ── the screen ─────────────────────────────────────────────────────────────────────────
  const host = resolveMount(options.mount);
  // Whatever was booted onto this element before, tear it down first. `createInput` throws on a
  // second binding to one canvas — correctly — and the symptom is a game that has stopped
  // responding to its own source while the *first* instance keeps rendering. The handle lives on
  // the DOM node rather than in a module variable because a module variable is exactly what a
  // hot reload throws away, and it covers a stray second `bootstrap()` call for free.
  const hosted = host as HTMLElement & { [PREVIOUS_BOOT]?: () => void; [LIVE_BOOT]?: Boot<A> };
  hosted[PREVIOUS_BOOT]?.();
  host.style.cssText = `position:fixed;inset:0;margin:0;overflow:hidden;background:${options.background ?? '#0a0d18'}`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  host.append(canvas);

  // 0 means "the URL said nothing", which is not the same as a ratio of 0 — so the option is
  // omitted entirely rather than passed, and `createCanvas2dSurface` applies its own clamp
  // against the device. Read it back off the surface afterwards; never off `devicePixelRatio`.
  const wantRatio = params.num('dpr', 0);
  const surface = createCanvas2dSurface(
    canvas,
    wantRatio > 0 ? { pixelRatio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, wantRatio)) } : undefined,
  );

  const palette = createPalette(options.palette ?? BASE_SLOTS);
  const clear: Ink = options.clear ?? 'sky';
  let snap = params.bool('snap', true);

  // ── the night ──────────────────────────────────────────────────────────────────────────
  // Built unconditionally. It allocates nothing until a frame asks for darkness, so there is
  // no such thing here as an exhibit that "does not have one" — only one that never uses it.
  let lightOpts: Required<LightFieldOpts> = {
    scale: params.num('lightScale', options.light?.scale ?? 0.5),
    falloff: params.num('lightFalloff', options.light?.falloff ?? 2),
    bloom: params.num('lightBloom', options.light?.bloom ?? 0.35),
  };
  let light = createLightField(surface, lightOpts);

  // ── the camera ─────────────────────────────────────────────────────────────────────────
  let policy: CameraPolicy = {
    minZoom: params.num('minZoom', options.camera?.minZoom ?? 0.5),
    maxZoom: params.num('maxZoom', options.camera?.maxZoom ?? 4),
    zoom: params.num('zoom', options.camera?.zoom ?? 1),
    keepVisible: params.num('keepVisible', options.camera?.keepVisible ?? 0.35),
  };
  const bounds = options.bounds;
  let camera = makeCamera(policy);

  function makeCamera(next: CameraPolicy): Camera {
    const made = createCamera(Math.max(1, innerWidth), Math.max(1, innerHeight), {
      minZoom: next.minZoom,
      maxZoom: next.maxZoom,
      zoom: next.zoom,
      keepVisible: next.keepVisible,
      ...(bounds === undefined ? {} : { bounds }),
    });
    // A fresh camera looks at world (0, 0), which in a 2:1 projection is the *top corner* of the
    // map — so an exhibit that passes bounds and forgets to frame opens on empty space beside
    // its own world and reads as a broken first frame. Centering costs one call and is only ever
    // a starting point: choosing the zoom and center that make the opening frame the pitch is
    // still the exhibit's, and `iso` is growing `camera.fitBounds` for it.
    if (bounds !== undefined) made.centerOn(rectCenterX(bounds), rectCenterY(bounds));
    return made;
  }

  // ── the rest of the frame ──────────────────────────────────────────────────────────────
  const order = new DepthSorter(options.depth ?? 512);
  const tweens = createTweens();
  const loop = createLoop({ clock: { now: () => performance.now() }, frames: browserFrames() });

  // ── input, and the number that is never typed twice ────────────────────────────────────
  //
  // `loop` is built above this line for one reason: so `stepMs` is read off it here rather than
  // written as a literal. It is read again, from the same place, in every rebuild below.
  let profileOverrides: ProfileOverrides = withUrlProfile(params, options.profile);
  let input = makeInput();

  /** Handlers made through the boot, replayed onto every input system that replaces this one. */
  type Binding =
    | { readonly kind: 'action'; readonly name: A; readonly fn: (event: ActionEvent<A>) => void }
    | { readonly kind: 'gesture'; readonly name: keyof GestureMap; readonly fn: (gesture: never) => void };
  /** The one cast in this file. `Binding` erases the link between a gesture's name and its event
   *  type — a discriminated union of six pairs would restore it and buy nothing, since the pair
   *  was checked at the `on` call that created the entry. */
  type AnyGestureHandler = (gesture: GestureMap[keyof GestureMap]) => void;
  const bindings: Binding[] = [];

  function makeInput(): DomInputSystem<A> {
    return createInput<A>({
      element: canvas,
      camera,
      // `step: loop`, not `stepMs: loop.stepMs`: `input` now takes a `FixedStep` structurally,
      // so the bare number this file existed to stop anyone typing no longer compiles at all.
      step: loop,
      ...(options.actions === undefined ? {} : { actions: options.actions }),
      profile: profileOverrides,
      ...(options.control === undefined ? {} : { control: options.control }),
      onDiagnostic: (d) => {
        // The control panel is a legitimate cover over part of the world, and `input` has no way
        // to be told so — it reports the first tap on the panel as a press the game never got.
        // Filtered here rather than left to shout once per exhibit; the gap is a kit finding.
        // `element` is optional, so the guard is explicit: swallowing a covered-world report that
        // named no element would hide the case this diagnostic actually exists for.
        const from = d.element;
        if (d.code === 'covered-by-overlay' && from !== undefined && from.closest(`.${PANEL_CLASS}`) !== null) {
          return;
        }
        console.warn(d.message);
      },
    });
  }

  function rebindAll(): void {
    for (const b of bindings) {
      if (b.kind === 'action') input.onAction(b.name, b.fn);
      else (input.on as (type: keyof GestureMap, fn: AnyGestureHandler) => void)(b.name, b.fn as AnyGestureHandler);
    }
  }

  function rebuildInput(): void {
    input.dispose();
    input = makeInput();
    rebindAll();
  }

  // ── one resize handler, so there cannot be two that disagree ───────────────────────────
  const resizeHandlers: ((w: number, h: number) => void)[] = [];

  function fit(): void {
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    // `surface.pixelRatio`, never `devicePixelRatio`: the surface already clamped the device's
    // ratio against `maxPixelRatio`, and re-reading the raw one here silently undoes that.
    surface.resize(w, h, surface.pixelRatio);
    camera.resize(w, h);
    // Redundant today — `LightField.begin` re-sizes its buffers from the pen's surface on every
    // active frame, so a field is already self-healing. Kept because it is one call, it is what
    // the interface asks for, and the alternative is fourteen exhibits relying on an
    // implementation detail of `draw` that nothing in its contract promises.
    light.resize(w, h);
    for (const fn of resizeHandlers) fn(w, h);
  }

  const onWindowResize = (): void => fit();
  addEventListener('resize', onWindowResize);
  // A phone's URL bar collapsing fires `visualViewport.resize` and *not* `window.resize` on
  // iOS, which leaves the canvas one bar-height too tall for the rest of the session.
  visualViewport?.addEventListener('resize', onWindowResize);
  scope.add(() => {
    removeEventListener('resize', onWindowResize);
    visualViewport?.removeEventListener('resize', onWindowResize);
  });
  fit();

  // ── the two wirings that must not be crossed ───────────────────────────────────────────
  const updateHandlers: ((dt: number, tick: number) => void)[] = [];
  const renderHandlers: ((pen: Pen, alpha: number, nowMs: number) => void)[] = [];

  loop.onUpdate((dt, tick) => {
    // Before the exhibit's own update: a handler must see the world as the player left it, not
    // one step behind it.
    input.tick(tick);
    for (const fn of updateHandlers) fn(dt, tick);
    // After: a tween started by a handler this step should not also advance during it.
    tweens.step(dt);
  });

  loop.onRender((alpha, time, nowMs) => {
    input.frame(nowMs);
    const pen = beginFrame({ surface, camera, palette, t: time, clear, light, snap });
    for (const fn of renderHandlers) fn(pen, alpha, nowMs);
    endFrame(pen);
  });

  let disposed = false;

  const boot: Boot<A> = {
    canvas,
    surface,
    get camera() {
      return camera;
    },
    palette,
    get light() {
      return light;
    },
    order,
    tweens,
    loop,
    get input() {
      return input;
    },
    scope,
    seed,
    rng,
    params,
    get cameraPolicy() {
      return policy;
    },
    get lightOpts() {
      return lightOpts;
    },
    get worstMs() {
      return loop.stats.worstGapMs;
    },
    get cadenceMs() {
      return loop.stats.cadenceMs;
    },

    onUpdate(fn) {
      updateHandlers.push(fn);
      return scope.add(() => {
        const at = updateHandlers.indexOf(fn);
        if (at >= 0) updateHandlers.splice(at, 1);
      });
    },
    onRender(fn) {
      renderHandlers.push(fn);
      return scope.add(() => {
        const at = renderHandlers.indexOf(fn);
        if (at >= 0) renderHandlers.splice(at, 1);
      });
    },
    onResize(fn) {
      resizeHandlers.push(fn);
      return scope.add(() => {
        const at = resizeHandlers.indexOf(fn);
        if (at >= 0) resizeHandlers.splice(at, 1);
      });
    },

    onAction(name, fn) {
      bindings.push({ kind: 'action', name, fn });
      const off = input.onAction(name, fn);
      return scope.add(() => {
        off();
        const at = bindings.findIndex((b) => b.kind === 'action' && b.fn === fn);
        if (at >= 0) bindings.splice(at, 1);
      });
    },
    on(name, fn) {
      bindings.push({ kind: 'gesture', name, fn: fn as (gesture: never) => void });
      const off = input.on(name, fn);
      return scope.add(() => {
        off();
        const at = bindings.findIndex((b) => b.kind === 'gesture' && b.fn === (fn as unknown));
        if (at >= 0) bindings.splice(at, 1);
      });
    },

    start() {
      loop.start();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.stop();
      input.dispose();
      light.dispose();
      scope.dispose();
      params.flush();
      canvas.remove();
    },

    setProfile(overrides) {
      profileOverrides = { ...profileOverrides, ...overrides };
      rebuildInput();
    },
    setCamera(next) {
      const wx = camera.x;
      const wy = camera.y;
      const previousZoom = camera.zoom;
      policy = { ...policy, ...next };
      camera = makeCamera({ ...policy, zoom: previousZoom });
      camera.resize(Math.max(1, innerWidth), Math.max(1, innerHeight));
      camera.centerOn(wx, wy);
      // `input` captured the old camera at construction, and the controller drives whatever it
      // captured. Rebuilding it is not optional politeness.
      rebuildInput();
    },
    setLight(next) {
      lightOpts = { ...lightOpts, ...next };
      light.dispose();
      light = createLightField(surface, lightOpts);
      light.resize(surface.width, surface.height);
    },
    setPixelRatio(ratio) {
      surface.resize(surface.width, surface.height, Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)));
      // `fit` re-reads `surface.pixelRatio`, so the new one is what the next resize carries.
      fit();
    },
    setSnap(on) {
      snap = on;
    },
  };

  hosted[PREVIOUS_BOOT] = boot.dispose;
  hosted[LIVE_BOOT] = boot;
  // Belt to the braces above: when Vite invalidates *this* module and nothing re-boots, the
  // hook is what releases the loop, the listeners and the light buffers promptly rather than at
  // the next boot that may never come.
  hotOf(import.meta)?.dispose(() => {
    boot.dispose();
  });

  return boot;
}

/**
 * Fold the URL's gesture keys into the exhibit's own overrides.
 *
 * Only the two the panel ships a knob for, because a profile is part of a replay's identity:
 * every key here changes the fingerprint `persist` compares, so this list is a promise about
 * which links can be replayed against each other and wants to stay short.
 */
function withUrlProfile(params: Params, base: ProfileOverrides | undefined): ProfileOverrides {
  const slop = params.num('tapSlop', 0);
  const longPress = params.num('longPress', 0);
  const out: ProfileOverrides = { ...base };
  return {
    ...out,
    ...(slop > 0 ? { tapSlopPx: { ...out.tapSlopPx, touch: slop, mouse: slop, pen: slop } } : {}),
    ...(longPress > 0 ? { longPressMs: longPress } : {}),
  };
}


/**
 * Vite's hot-reload handle, typed here rather than imported.
 *
 * `vite/client` would pull an ambient `.d.ts` into every project that compiles this folder, and
 * the exhibits are `tsc --build` projects with an explicit `types` list. Three lines of local
 * structure is cheaper than a global type dependency, and `undefined` in a production build is
 * the whole of the contract that matters.
 */
interface HotHandle {
  dispose(fn: () => void): void;
}

function hotOf(meta: ImportMeta): HotHandle | undefined {
  const hot: unknown = (meta as { hot?: unknown }).hot;
  return typeof hot === 'object' && hot !== null && 'dispose' in hot ? (hot as HotHandle) : undefined;
}
