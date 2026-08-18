/**
 * RESONANCE — a Lattice exhibit. The wiring, the mixer, and the strike.
 *
 * You carry a lamp through a cave that is mostly rock. Every locked gate hums a chord out of the
 * six strings you carry; strike the combination that answers it and the gate opens and stays lit.
 * `?seed=` chooses the cave and with it every chord in it, so the same link is the same cavern,
 * the same gates and the same answers on every machine.
 *
 * **There is no boot in this file** — canvas, surface, camera, palette, light field, depth sorter,
 * loop and input are `bootstrap()` from `examples/_shared`. **There is no drawing in it either**;
 * that is `view.ts`, `rock.ts` and `props.ts`. **And there is not a frequency in it**: the pitch
 * table is `sound.ts`, because a string's hertz is its voicing and `docs/GALLERY.md` calls a table
 * of voicings art. What is left is the four things that are genuinely this exhibit — the engine,
 * the duck, the strike, and one state update a frame.
 *
 * ## Rule one: no `AudioContext` until a gesture
 *
 * `@latticekit/audio` installs no listener of its own, on purpose — `@latticekit/input` owns the DOM
 * event surface. So every entry point calls `unlock()` first, every time: it is idempotent, and it
 * also *resumes* a context a background tab suspended, which is the failure where sound works for
 * one session and then silently stops. The opening frame is therefore silent by design, and the
 * HUD says so in one pulsing line until the first tap rather than leaving it to be discovered.
 *
 * **`play()` returns accepted, not audible.** The mechanic never confuses the two. `audio.available`
 * is read separately and shown in the HUD, and a strike the throttle refused is not recorded as an
 * answer — a string that did not sound is not one you played.
 *
 * ## The duck, which is the thing a sound board never asks of a mixer
 *
 * The bed is on `music` and everything the puzzle travels through is on `sfx`, so one gain move
 * separates them. {@link duck} is set by **any** scheduled voice — struck or hummed, read off
 * `onScheduled` rather than off the call sites, so there is exactly one place it can be forgotten —
 * and it falls back over about a second. The write is quantized to a hundredth because
 * `Mixer.setGain` ramps over `RAMP_SEC` and takes no ramp length, so a recovery has to be driven
 * frame by frame, and an unquantized drive would re-anchor the same approach sixty times a second.
 *
 * ## The plan object is reused
 *
 * `onScheduled` hands out one object refilled per layer per play. Everything kept out of it below
 * is copied into a number on the line it is read. A bug there does not look like a bug — it looks
 * like every note having the properties of the most recent one.
 */
import { gridToWorldX, tileBounds, worldToGridX, worldToGridY, type Rect } from '@latticekit/iso';
import { drive } from '@latticekit/ui';
import { createAudio, createBed, validateSounds } from '@latticekit/audio';
import { bootstrap, controlPanel, knobs } from '../../_shared/src/index.js';
import { ASLEEP } from './palette.js';
import { CX, CY, H, W, createCavern, nearestLocked, type Gate } from './cavern.js';
import { CHORD_MAX, STRINGS, forget, played } from './puzzle.js';
import { BED, SOUNDS, STRING_IDS, TONE_IDS } from './sound.js';
import { createHud } from './hud.js';
import { drawCavern } from './view.js';

/** Tiles the lamp reaches to claim a gate — wider than the lit pool, so a gate answers just before
 *  you can see it, which is what makes the last few steps toward one a thing done by ear. Then the
 *  seconds between the notes of a hum: an arpeggio, because three pitches at once is a chord to
 *  admire and three pitches in a row is a chord you can write down. */
const REACH = 8, ARPEGGIO = 0.24;
/** The bed's level on the music bus, and how far under the puzzle one voice pushes it. */
const BED_GAIN = 0.62, DUCK_DEPTH = 0.72;

const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const boot = bootstrap({
  seed: 'hollow', bounds: worldRect, background: '#04050b', palette: ASLEEP, clear: 'night', depth: 1024,
  camera: { zoom: 0.95, minZoom: 0.5, maxZoom: 2.4, keepVisible: 0.5 }, light: { scale: 0.5, falloff: 1, bloom: 0.3 },
  actions: { s0: ['key:Digit1'], s1: ['key:Digit2'], s2: ['key:Digit3'], s3: ['key:Digit4'], s4: ['key:Digit5'], s5: ['key:Digit6'], hum: ['tap', 'key:Space'] },
});
// The floor of a hollow rolls and its roof comes down to meet it, so the tile under a pixel is the
// marched one. `hum` is bound to `tap` and does not read a coordinate today; the declaration is
// about the ground, and it is what keeps the console clean when it one day does.
const cave = createCavern(boot.seed); boot.setTerrain({ field: cave.field, maxHeightPx: cave.maxHeightPx });
tileBounds(0, 0, W, H, cave.maxHeightPx, worldRect); boot.camera.setBounds(worldRect);
// Opening on a gate rather than on the map's middle: the first thing in frame has to be the thing
// the exhibit is about, and `gates` is sorted so that this is one lookup and no second notion of
// where the middle is.
boot.camera.centerOnTile((cave.gates[0]?.gx ?? CX) + 1, (cave.gates[0]?.gy ?? CY) + 1);

const audio = createAudio({ sounds: SOUNDS });
for (const problem of validateSounds(SOUNDS)) console.warn(problem.message);
const bed = createBed(audio, BED, { bus: 'music', sagTo: 0.8 });
// Six strings, three gate tones and a bed sum past full scale on the one frame a player mashes
// everything into a hum. Master carries the headroom, so no single recipe has to be quiet enough
// for the worst case and each of them is right on its own.
audio.mixer.setGain('master', 0.62); audio.mixer.setGain('music', BED_GAIN);
boot.scope.add(() => { audio.dispose(); });

let active: Gate | undefined, opened = 0, duck = 0, bedGain = BED_GAIN, woke = false, worstMs = 0, worstAge = 0, notes = 0, lastMs = 0;
/** Audio-clock seconds each note of the current hum is scheduled for. */
const noteAt = new Float64Array(CHORD_MAX);
/** Everything the picture is allowed to know, written in place so the frame allocates nothing. */
const look = { gate: undefined as Gate | undefined, now: 0, voiceAt: -9, refusedAt: -9, notes: noteAt, noteCount: 0, lampGx: CX, lampGy: CY, progress: 0 };

const hud = createHud({
  palette: boot.palette, total: cave.gates.length, now: () => boot.loop.realTime * 1000,
  onString: (index) => { strike(index); }, onHum: () => { wake(); hum(); },
  read: () => ({ woke, hearing: audio.available, size: active?.size ?? 0, opened, worstMs }) });
boot.scope.add(drive(hud.ui, boot)); boot.scope.add(hud.destroy);

boot.scope.add(audio.onScheduled((plan) => {
  duck = 1; look.voiceAt = plan.start;
  // One emission per layer; the ring counts *notes*, so only the fundamental is heard from. 115
  // is 's' and 103 is 'g' — the string ids and the gate-tone ids, whose second character is the
  // string index. Both are read into numbers here, on the line, because the plan is reused.
  if (plan.layer !== 0) return;
  if (plan.source.charCodeAt(0) === 115) hud.flash(plan.source.charCodeAt(1) - 48);
  else if (plan.source.charCodeAt(0) === 103 && notes < CHORD_MAX) { noteAt[notes] = plan.start; look.noteCount = notes += 1; }
}));

/** Create or resume the context, and make the first one of those audible. */
function wake(): void { audio.unlock(); if (!woke) { woke = true; audio.play('wake'); } }

/**
 * The gate in reach hums its chord, a note at a time, panned to where it is on screen.
 *
 * **It deliberately does not `wake()`.** This is called from the frame the lamp reaches a new
 * gate, which is not a gesture — an `unlock()` there would fail harmlessly but would also flip
 * `woke`, and the pulsing line telling a visitor that one tap starts the sound would vanish
 * before they had made one. The two callers that *are* gestures wake first.
 */
function hum(): void {
  const gate = active;
  if (gate === undefined) return;
  look.noteCount = notes = 0;
  // Screen-x → pan is four lines in the game on purpose: `audio` is layer 1 and does not know
  // `iso` exists, and `camera.normalizedX` is documented as this exact caller's arithmetic.
  const pan = boot.camera.normalizedX(gridToWorldX(gate.gx, gate.gy)), from = audio.now();
  for (let i = 0, n = 0; i < STRINGS; i += 1) if (((gate.chord >> i) & 1) === 1) audio.play(TONE_IDS[i] ?? 'g0', { at: from + n++ * ARPEGGIO, pan });
}

/** Strike one string, and see whether the last few make the chord the gate asked for. */
function strike(index: number): void {
  wake();
  const gate = active;
  // A string the throttle refused is not one you played, so it is not recorded as an answer.
  if (!audio.play(STRING_IDS[index] ?? 's0') || gate === undefined) return;
  const answer = played(index, gate.size);
  if (answer === 0) return;
  if (answer !== gate.chord) { look.refusedAt = audio.now(); audio.play('refuse'); return; }
  gate.open = true; opened += 1; forget(); audio.play('open');
}

STRING_IDS.forEach((id, index) => boot.onAction(id, () => { strike(index); }));
boot.onAction('hum', () => { wake(); hum(); });

boot.onUpdate((dt) => {
  look.lampGx = worldToGridX(boot.camera.x, boot.camera.y); look.lampGy = worldToGridY(boot.camera.x, boot.camera.y);
  look.now = audio.now(); look.progress = opened / Math.max(1, cave.gates.length);
  const next = nearestLocked(cave, look.lampGx, look.lampGy, REACH);
  // A gate the lamp has just reached introduces itself, and the run you were part-way through
  // against the last one is forgotten — otherwise two strings meant for a gate behind you become
  // the first two thirds of an answer to this one.
  if (next !== active) { active = next; look.gate = next; forget(); hum(); }

  duck = Math.max(0, duck - dt / 1.1);
  const want = Math.round(BED_GAIN * (1 - DUCK_DEPTH * duck) * 100) / 100;
  if (want !== bedGain) { bedGain = want; audio.mixer.setGain('music', want); }
  bed.set(0.3 + look.progress * 0.7, look.progress);

  if ((worstAge += dt) >= 10) { worstAge = 0; worstMs = 0; }   // a fresh ten-second window
});

/**
 * The frame, and the readout § Scale's cost row actually asks for.
 *
 * **Not `loop.stats.worstFrameMs`.** That measures the pump's own wall time and nothing between
 * pumps, so a garbage-collector pause — the exact failure the quantization in `props.ts` exists to
 * prevent — is invisible to it; `examples/terraces` measured a HUD reading 0.0 ms against a real
 * worst gap of 9.2 ms. What a player feels is the interval between two *pictures*, so that is what
 * is measured: `nowMs` is the loop's own clock, handed over here, which is also why this exhibit
 * needs no clock of its own and calls no banned `performance.now`.
 *
 * It binds twice over here. A stalled frame in this exhibit desynchronises the ring from the note
 * it is answering, and a player reads that as the puzzle being wrong rather than the renderer
 * being late.
 */
boot.onRender((pen, _alpha, nowMs) => {
  if (lastMs > 0 && nowMs - lastMs > worstMs) worstMs = nowMs - lastMs;
  lastMs = nowMs;
  drawCavern(pen, boot.order, cave, look);
});

controlPanel([
  { kind: 'group', label: 'the mixer' }, knobs.voiceCeiling({ value: audio.maxVoices, apply: (v) => { audio.setMaxVoices(v); } }),
  { kind: 'group', label: 'the dark' }, knobs.lightBloom(boot), knobs.lightScale(boot), knobs.lightFalloff(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot),
], { params: boot.params, title: 'Resonance', subtitle: 'Answer the chord.', stats: knobs.frameTime(boot) });

boot.start();
