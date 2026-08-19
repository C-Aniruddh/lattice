/**
 * MIGRATION — a Lattice exhibit. The wiring, the frame, and the three knobs that break it.
 *
 * A yard of five terraces, one per build of the same game, and an archive of v1 save files being
 * carried up them. **The chain is the version**, so the chain is the landform: one rung per
 * migration, and a save climbs it in front of you rather than being reported as having climbed it.
 *
 * ## What is actually happening, as opposed to what it looks like
 *
 * Every crate holds envelope bytes and nothing else. When it steps onto terrace *k* it is handed
 * to `BUILDS[k].decode` — a real `@latticekit/persist` store, real checksum, real chain, a real
 * recognizer at every version on the way — and what comes back is what it carries from then on.
 * Nothing is precomputed, nothing is replayed, and there is no path in this exhibit that can draw
 * a field a build has not produced. `chain.ts` is where all five of those builds are sealed.
 *
 * Roughly twenty saves a second cross a rung. It does not appear in the frame cost, which is the
 * quiet argument underneath the loud one.
 *
 * ## There is no boot in this file, and no frame meter either
 *
 * Canvas, surface, camera, palette, light field, depth sorter, tweens, loop and input are
 * `bootstrap()` from `_shared`, which exists because the thirty lines it replaces contain two
 * mistakes that are *silent* when you make them — a `stepMs` literal beside a loop running at
 * 16.667, and a light field never attached to the pen.
 *
 * The worst frame is `boot.worstMs`, which is `loop.stats.worstGapMs`, and it is read rather than
 * measured here on `bootstrap`'s own instruction: four exhibits hand-rolled that meter before
 * `loop` grew one and produced three different wrong answers between them — two reading `0.0 ms`
 * on scenes with a measured 9.2 ms gap, because `worstFrameMs` is the pump's own work and a
 * collection landing *between* two pumps is not in it.
 *
 * ## What is logic and what is not
 *
 * This file, `chain.ts`, `ladder.ts` and `hud.ts` are the exhibit's logic and the only four
 * modules the line rule counts. `palette.ts`, `place.ts`, `yard.ts`, `crates.ts` and `legend.ts`
 * each carry `@art` in their header: delete any one and the archive still opens, the chain still
 * steps, every refusal still happens at the same rung for the same reason, and every counter
 * still reads what it read.
 */
import { hashString } from '@latticekit/core';
import { renderFrame, type Passes } from '@latticekit/draw';
import { boxSilhouette, pointInPolygon } from '@latticekit/iso';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, createBucket, knobs, type RangeControl } from '../../_shared/src/index.js';
import { HEAD } from './chain.js';
import { DEPTH, GROUND, MAX_HEIGHT_PX, SPAN, gxOf, gyOf, liftAt, openYard, stepYard } from './ladder.js';
import { fillCrates, markFocus, paintCrates, type Standing } from './crates.js';
import { YARD } from './palette.js';
import { createHud } from './hud.js';
import { drawAir, paintGround } from './yard.js';

// The bounds are the archive off the left of the ladder, the vault off the right, and a hundred
// and sixty tiles of lanes running off the top and the bottom — about 5,000 world pixels on the
// long axis against a 1440 px viewport, which is § Scale's extent row with room to spare. Most of
// this yard is off-screen at every zoom, which is what makes the first gesture a drag.
const boot = bootstrap<'follow'>({
  seed: 'archive', palette: YARD, clear: 'sky', background: '#aec4cf', depth: 2048, actions: { follow: ['tap'] },
  bounds: { minX: -20 * 32, minY: -(((HEAD - 1) * SPAN + 40) * 16 + MAX_HEIGHT_PX), maxX: (DEPTH + 20) * 32, maxY: 46 * 16 },
  camera: { zoom: 0.6, minZoom: 0.35, maxZoom: 3.4, keepVisible: 0.2 },
});

// The declaration `SEAMS.md` gives this seam. `input` inverts the projection on the plane `z = 0`
// and on no other, so on a staircase 352 px tall an omission puts every `gx`/`gy` several terraces
// from the finger — a real tile, beside the right one, moving smoothly with the pointer. This
// exhibit reads `event.sx`/`event.sy` and picks through the sorter, so declaring it changes
// nothing this file does; it is here because *saying nothing* is the thing that is wrong.
boot.setTerrain({ field: GROUND, maxHeightPx: MAX_HEIGHT_PX });
// The opening frame holds the whole chain at once — the archive floor and its line of
// refusals along the bottom edge, five decks, four labelled rungs, the vault running off the top.
boot.camera.centerOn(DEPTH * 0.5 * 32, -((HEAD - 1) * SPAN * 0.5 * 16 + MAX_HEIGHT_PX * 0.46));

// ── the archive, and the yard it feeds ───────────────────────────────────────────────────────

// `hashString` and not a hand-rolled fold: it walks UTF-16 code units, and `persist`'s one trap is
// that a key derived from something a *human typed* must be `normalize('NFC')`ed first or the same
// visible name produces two worlds. A `?seed=` from a URL is not that — it is bytes somebody
// pasted, and the subject is the bytes.
let build = Math.round(boot.params.num('build', HEAD)), brandSat = boot.params.num('sat', 0.62);
const yard = openYard(hashString(boot.seed), boot.params.num('damage', 0.09), build);

boot.onUpdate((dt) => { yard.top = build; stepYard(yard, dt); });

// ── the frame ────────────────────────────────────────────────────────────────────────────────

const bucket = createBucket<Standing>(boot.order);
const passes: Passes = { maxHeightPx: MAX_HEIGHT_PX, terrain: (pen, visible) => paintGround(pen, visible, build), solids: (pen) => paintCrates(pen, bucket, brandSat), placement: (pen) => markFocus(pen, yard.focus), overlay: (pen) => drawAir(pen) };
boot.onRender((pen) => { bucket.clear(); fillCrates(bucket, yard.lanes, boot.camera, build); renderFrame(pen, passes, boot.order); });

// ── the tap ──────────────────────────────────────────────────────────────────────────────────

const sil = new Float64Array(12); let px = 0, py = 0;

/** Is the tap inside this crate's own silhouette? Shelved stock is never a target — an archive
 *  crate that swallowed a tap aimed at the save climbing past it would be the worst kind of bug,
 *  the kind where nothing happens. `boxSilhouette` writes the six points in `iso`'s order, which
 *  is the order `draw` strokes them in; that agreement is a contract in `SEAMS.md`, and it is why
 *  the pick and the picture cannot drift apart. */
const hits = (item: Standing): boolean => {
  if (!('filed' in item)) return false;
  boxSilhouette(boot.camera, gxOf(item.d, item.s), gyOf(item.d, item.s), { ox: 0.11, oy: 0.11, w: 0.78, d: 0.78, zPx: liftAt(item.d, item.s), hPx: 17 }, sil);
  return pointInPolygon(px, py, sil, 6);
};
// `order.sorted` is false until the first frame has painted and again for the instant between
// a `clear()` and the `sort()` inside `renderFrame`. A tap in that window would make `pickSorted`
// throw rather than answer, by design — it will not name a permutation it did not paint.
boot.onAction('follow', (e) => { px = e.sx; py = e.sy; const hit = boot.order.sorted ? bucket.pick(hits) : undefined; if (hit !== undefined && 'filed' in hit) yard.focus = hit; });

// ── the panel, and the three controls that are this exhibit's own ────────────────────────────

const buildKnob: RangeControl = {
  kind: 'range', key: 'build', label: 'the build opening the archive', value: build, apply: (v) => { build = Math.round(v); },
  param: '@latticekit/persist MigrationChain.head', min: 1, max: HEAD, step: 1, format: (v) => `v${v.toFixed(0)}`,
  note: 'The chain is the version, so this is which of five sealed chains a save is handed to — not a number beside them.',
  wrong: { below: 1, says: 'Nothing migrates. Every save is already at this build’s head, the four rungs above it are not in this build at all, and the only refusals left are the ones that never got onto the ladder.' },
};
const damageKnob: RangeControl = {
  kind: 'range', key: 'damage', label: 'damaged bytes on the shelf', value: yard.damage, apply: (v) => { yard.damage = v; },
  param: '@latticekit/persist Envelope.c', min: 0, max: 0.5, step: 0.01, format: (v) => `${(v * 100).toFixed(0)}%`,
  note: 'The share of the archive with one character flipped in the payload and the checksum left alone — which is what a truncated write looks like.',
  wrong: { above: 0.35, says: 'A third of the archive never gets onto the ladder. Every one of them is refused at the gate with `corrupt`, which is the store working exactly as designed and the player losing everything anyway.' },
};
const satKnob: RangeControl = {
  kind: 'range', key: 'sat', label: 'brand saturation', value: brandSat, apply: (v) => { brandSat = v; },
  param: '@latticekit/draw hsl(h, s, l)', min: 0, max: 1, step: 0.02, format: (v) => v.toFixed(2),
  note: 'The derivation a stored hue goes through. Crates from v3 up are painted from `hue` and move with this; v1 and v2 crates are painted from a `#rrggbb` an old build wrote down, and cannot.',
  wrong: { below: 0.12, says: 'Every save from v3 up has gone grey and every save below it has not — because those ones are carrying a colour token instead of the number it came from, and a retune can never reach them. That is the whole of *persist the input, never the derived value*.' },
};

controlPanel([{ kind: 'group', label: 'the one idea' }, buildKnob, damageKnob, satKnob,
  { kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot), { kind: 'group', label: 'input' }, knobs.tapSlop(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot)],
  { params: boot.params, title: 'Migration', subtitle: 'A v1 save opened by a v5 build, one rung at a time.', stats: knobs.frameTime(boot) });

// ── the overlay, which is DOM ────────────────────────────────────────────────────────────────

const hud = createHud(boot.palette, () => ({ yard, worstMs: boot.worstMs }), () => boot.loop.realTime * 1000);
boot.scope.add(drive(hud.ui, boot)); boot.scope.add(hud.destroy);
boot.start();
