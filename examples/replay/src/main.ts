/**
 * REPLAY — record, scrub, and prove it.
 *
 * The exhibit has two states and the whole idea is the gap between them. While it is
 * **recording**, the loop drives the marsh and `input` puts every sample on a tape, bucketed by
 * tick index. While it is **proving**, nothing in this file steps anything: the marsh on screen
 * is one `@latticekit/loop`'s driver rebuilt from the seed and the log a moment ago, and the bar
 * under the visitor's finger re-runs it from tick 0 on every pointer move.
 *
 * That is the only honest way to build a scrub bar in this gallery. `docs/GALLERY.md` says so in
 * the Canyon row — *"the scrub bar is a re-run, not a lookup, and that is the demonstration. A
 * scrub bar that is secretly a cache of screenshots proves nothing"* — and the way to be sure it
 * is not a cache is that it costs something, in milliseconds, printed, and that it can fail.
 *
 * The HUD lives here rather than in a module of its own, and that is the line rule showing
 * through the design: this exhibit is three packages meeting at a tick index, and a fourth file
 * of overlay wiring did not fit under 200 logic lines beside them.
 */

import { hashString } from '@latticekit/core';
import { paletteVars } from '@latticekit/draw';
import { applyPalette, createOverlay, drive, interactive, setText } from '@latticekit/ui';
import { bootstrap, costNode } from '../../_shared/src/index.js';
import { EVENING, LATE, hour, render, type Stage } from './look.js';
import { MAX_HEIGHT_PX, createMarsh, digest, plant, setDrift, step, viewAt } from './marsh.js';
import { ACTIONS, rerun, startRecording, type Run, type Tape } from './tape.js';

/** Eighteen seconds at 60 Hz: long enough for the bloom to take a shape worth recognising. */
const TAKE = 1080, at = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

const boot = bootstrap({
  seed: '20250818', background: '#070a14', palette: EVENING, clear: 'sky',
  // 1.15 opens with the marsh 2.9× the viewport on its long axis, running off all four edges.
  // No `bounds`: `marsh.viewAt` is the only thing that ever moves this camera, and it is a
  // function of the tick, so there is nothing for a fence to catch.
  camera: { zoom: 1.15, minZoom: 1.15, maxZoom: 1.15 },
  light: { scale: 0.55, falloff: 1, bloom: 0.32 },
  actions: ACTIONS,
  // `control: false` is half of the camera decision above, and the other half is `viewAt`: a
  // camera the player can move is an input nobody is recording. See `marsh.viewAt`.
  control: false,
  depth: 4096,
});
const SEED = hashString(boot.seed) | 0;
const marsh = createMarsh(SEED);
// The seam `docs/SEAMS.md` names: `input` holds the declaration, `iso` marches the field. Without
// it every tap resolves on the plane z = 0, several tiles up the slope from the finger that asked
// for it, and nothing anywhere says so. Made through the boot rather than the input system so it
// survives the rebuild any panel knob would perform.
boot.setTerrain({ field: marsh.field, maxHeightPx: MAX_HEIGHT_PX });

/** Read `camera` and `light` back through the boot on every frame: the panel replaces both when a
 *  construction-time knob moves, and a captured reference survives the swap as a live object
 *  nothing is driving any more. */
const stage: Stage = {
  get camera() { return boot.camera; },
  get light() { return boot.light; },
  order: boot.order,
  seed: SEED,
};

let shown = marsh, tape: Tape | null = null, run: Run | null = null, head = 0;
boot.onAction('seed', (e) => { if (tape === null) plant(marsh, e.gx, e.gy, e.tick); });
const recording = startRecording(boot.input, SEED, boot.params.num('cp', 60));

/** Re-run the tape from tick 0 to `tick` and show what came back. */
function scrub(tick: number): void {
  if (tape === null) return;
  run = rerun(tape, boot.camera, SEED, (head = tick), build.value);
  // A refusal replayed nothing, so it must not blank the marsh: leaving the previous re-run on
  // screen is what makes "a refusal is never a pass" legible rather than merely written down.
  if (run.verdict.refused === null) shown = run.marsh;
}
/** Seal the tape, put it through the store, read it back, and verify the bytes end to end. */
function seal(): void { if (tape === null) { tape = recording.seal(marsh.tick, marsh); scrub(tape.log.endTick); } }

// ── the overlay ───────────────────────────────────────────────────────────────────────────
const ui = createOverlay({ now: () => boot.loop.realTime * 1000 });
ui.mount(at('hud'));
// Interactivity is granted to nodes, never by selector: everything not named here stays
// `pointer-events: none`, so a tap that is not on a control reaches the marsh.
for (const node of at('hud').querySelectorAll<HTMLElement>('.plate')) interactive(node);
// The embedder's flag, applied through the marker `examples/_shared` publishes rather than through
// a class this exhibit invented. Three nodes carry the figure — a rule, its term and its value —
// and hiding the value alone leaves `WORST FRAME` in the corner with nothing after it.
for (const node of at('hud').querySelectorAll<HTMLElement>('.cost-row')) costNode(node);
setText(at('seed'), boot.seed);
// One button, two jobs: it proves the tape it has, and once there is a verdict it starts again.
at('seal').addEventListener('click', () => (tape === null ? seal() : location.reload()));
// The bar is a native range: `ui` ships no slider on purpose — "write a plain element, call
// interactive() on it, style it in your sheet. That is the intended path, not a workaround" —
// and a range puts the whole of that styling in the half of the exhibit nobody counts, while
// arrow keys scrub it for free.
const track = at('track') as HTMLInputElement;
track.addEventListener('input', () => scrub(Number(track.value)));
// The panel, and the URL: the value is in the query string, so a visitor can share the setting
// that made it fail and a bug report can be a link. Three of its four positions are a kit
// parameter moved off the value the tape was recorded under; two of those are refused by name.
const build = at('k-build') as HTMLSelectElement;
build.value = boot.params.str('build', '');
build.addEventListener('input', () => {
  boot.params.put('build', build.value, '');
  setDrift(build.value === 'drift');
  scrub(head);
});

let pushed = -1;
ui.every(() => {
  const span = tape?.log.endTick ?? TAKE, marks = tape?.log.checkpoints.length ?? 0;
  const v = run?.verdict, d = v?.divergence ?? null, no = v?.refused ?? null;
  setText(at('r-tick'), `${shown.tick} / ${span}`);
  setText(at('r-lit'), String(shown.lit));
  setText(at('r-seeds'), String(shown.seeds.length));
  setText(at('r-digest'), `0x${digest(shown).toString(16).padStart(8, '0')}`);
  setText(at('r-bytes'), tape === null ? '—' : `${(tape.bytes / 1024).toFixed(1)} kB`);
  setText(at('r-cost'), run === null ? 'live' : `${run.ticks} in ${run.ms.toFixed(2)} ms`);
  setText(at('r-worst'), `${boot.worstMs.toFixed(1)} / ${boot.cadenceMs.toFixed(1)} ms`);
  setText(at('v-detail'),
    no !== null && no.kind === 'mismatch' ? `${no.field}: recorded ${String(no.recorded)}, this build ${String(no.current)}`
    : d !== null ? `at tick ${d.tick}, agreed through ${d.lastAgreedTick}`
    : tape === null ? `${TAKE - shown.tick} ticks left on the tape`
    : `${v?.checkpointsChecked ?? 0} of ${marks} checkpoints agreed`);
  // One attribute, on the overlay root: which word, which sentence and which button label are
  // showing is a CSS consequence of it, and none of that prose ever carries a number.
  at('hud').dataset['state'] = tape === null ? 'live' : no !== null ? 'deny' : d !== null ? 'fail' : v?.matched === true ? 'match' : 'part';
  track.max = String(span);
  track.value = String(shown.tick);
  track.disabled = tape === null;
  at('checked').style.width = `${((v?.checkpointsChecked ?? 0) * 100) / (marks || 1)}%`;
  at('broken').style.width = `${d === null ? 0 : 100 - (d.tick / span) * 100}%`;
  // `draw`'s palette reaching the DOM as CSS custom properties, so the overlay darkens with the
  // marsh instead of glowing in dusk colours over a night scene. Guarded on `rev`, because
  // `lerp` quantises and most updates move nothing.
  if (boot.palette.rev !== pushed) { pushed = boot.palette.rev; applyPalette(ui, paletteVars(boot.palette)); }
});
setDrift(build.value === 'drift');
boot.scope.add(drive(ui, boot));
boot.scope.add(() => { ui.destroy(); });

// ── the frame ─────────────────────────────────────────────────────────────────────────────
//
// **The camera is put where tick `n + 1` needs it at the end of tick `n`, and that is not a
// stylistic choice.** `bootstrap` runs `input.tick(tick)` before every exhibit handler — which is
// right for a world, because a handler must not see the player one step behind — and a recorded
// sample carries *screen* coordinates that `TickFrame.capture` resolves through the camera at the
// moment the tick closes. So a camera moved *after* `input.tick` resolves this tick's taps against
// last tick's view, while `rerun` sets `viewAt(camera, tick)` before `applyAt` and resolves them
// against this one. The two disagree by a quarter of a pixel, which is a divergence about one tap
// in two hundred and fifty and no divergence at all the rest of the time — the coin flip this
// exhibit exists to not be. Setting it one tick early makes both sides read the same view.
viewAt(boot.camera, 0);
boot.onUpdate((_dt, tick) => {
  if (tape === null) { step(marsh, tick); recording.mark(tick, marsh); if (tick >= TAKE) seal(); }
  if (tape === null) viewAt(boot.camera, tick + 1);
  boot.palette.lerp(LATE, EVENING, 1 - hour(shown.tick));
});
boot.onRender((pen) => { render(pen, stage, shown); });

boot.start();
