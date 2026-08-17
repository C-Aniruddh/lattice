# examples/resonance

> **RESONANCE** — a dark cavern where every locked gate hums a chord and you answer it on six
> tuned strings. The gallery's one exhibit where **sound is the mechanic**, not the decoration.

```bash
npm run build                 # @latticekit/* resolves to each package's dist, not to source
npx vite examples/resonance   # http://localhost:5191
```

Tap anywhere to wake the cave, then **1–6** or the six pads at the bottom of the screen. `?seed=`
chooses the cavern and, with it, every chord in it: the same link is the same cave, the same
gates and the same answers on every machine.

---

## The one idea

`Instrument` shows the synthesis. This one puts sound on the critical path: **you cannot see the
answer anywhere.** The ring above a gate tells you *how many* notes it wants and *when each one
lands*; which notes they are exists only in the air. That is the whole reason this exhibit is a
better test of `@latticekit/audio` than a sound board — a board can be admired with the volume off.

Four things a board never has to get right, and what each cost:

| | how it is done here |
|---|---|
| **the intervals must be exact** | `SEMITONE` walked by repeated `*` — Tier A, never `pow`. Verified off the live `AudioContext` at 329.63 and 440.00 Hz, matching equal temperament to the last printed digit |
| **the attack must feel like an instrument** | the package's own `ATTACK_SEC` (6 ms) for a struck string; 70 ms for a gate's answering tone. One field is the whole difference |
| **voices must stack under a mash** | six strings in one millisecond = twelve voices, none dropped, true peak 0.25 with zero clipped samples |
| **the bed must duck and come back** | the bed is on `music`, the puzzle on `sfx`, and one gain move separates them. Measured 0.62 → 0.18 → 0.62 |

---

## The runnable example

This is `src/sound.ts`'s pitch table and `src/main.ts`'s arpeggio, in Node, with no
`AudioContext` anywhere. It has been run and this is its output.

```ts
import { createAudio, SEMITONE, validateSounds } from '@latticekit/audio';

// The exhibit's scale, as `src/sound.ts` builds it: repeated multiplication, never `pow`.
const ROOT_HZ = 220;
const STEPS = [0, 3, 5, 7, 10, 12];
const hzOf = (step: number): number => {
  let hz = ROOT_HZ;
  for (let i = 0; i < step; i += 1) hz *= SEMITONE;
  return hz;
};
const HZ = STEPS.map(hzOf);

const tone = (i: number) => ({ bus: 'sfx', minGapMs: 40, spatial: true, layers: [
  { wave: 'sine', hz: HZ[i], gain: 0.125, hold: 1.4, attack: 0.07, cutoff: 1500 },
  { wave: 'sine', hz: HZ[i] * 2, gain: 0.05, hold: 0.95, attack: 0.12, cutoff: 2600 },
] });
const SOUNDS = { g0: tone(0), g1: tone(1), g2: tone(2), g3: tone(3), g4: tone(4), g5: tone(5) };
const IDS = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'] as const;

console.log(`problems: ${validateSounds(SOUNDS).length}`);
console.log(`strings:  ${HZ.map((h) => h.toFixed(2)).join('  ')}`);

let seconds = 0;
const audio = createAudio({ sounds: SOUNDS, context: () => null, now: () => seconds });
console.log(`available: ${audio.available}`);
audio.onScheduled((plan) => {
  if (plan.layer === 0) console.log(`  ${plan.source} at ${plan.hz.toFixed(2)} Hz, starting ${plan.start.toFixed(2)}s`);
});

// A gate asking for strings 4 and 6 — chord 0b101000 — arpeggiated 0.24 s apart.
const chord = 0b101000;
for (let i = 0, n = 0; i < 6; i += 1) {
  if (((chord >> i) & 1) === 1) audio.play(IDS[i], { at: seconds + n++ * 0.24, pan: -0.3 });
}
audio.dispose();
```

```
problems: 0
strings:  220.00  261.63  293.66  329.63  392.00  440.00
available: false
  g3 at 329.63 Hz, starting 0.00s
  g5 at 440.00 Hz, starting 0.24s
```

Those two lines are the exhibit. `available: false` and a correct plan anyway is the package's
central claim — **`play()` returns accepted, not audible** — and it is why this puzzle could be
written and asserted before a speaker was ever involved.

---

## The chord scheme, and how the intervals stay exact

Six strings, tuned to the **A minor pentatonic and its octave**: 0, 3, 5, 7, 10, 12 semitones
above A3.

| string | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| note | A3 | C4 | D4 | E4 | G4 | A4 |
| Hz | 220.00 | 261.63 | 293.66 | 329.63 | 392.00 | 440.00 |

**Pentatonic on purpose.** All twenty three-string chords over it are consonant, so a wrong
answer never *sounds* wrong — it simply is not the one the gate asked for. A scale with a tritone
in it would let a player rule combinations out by taste rather than by ear, which is an easier
game and a different one.

**How the intervals are kept exact.** `@latticekit/audio` exports `SEMITONE` — the twelfth root of
two written out as a literal — precisely so a game need not call `pow`, which ECMA-262 does not
require to be correctly rounded. `hzOf` walks the interval one multiply at a time, which is Tier A
and bit-identical on every engine, and the partials are exact small-integer ratios (`f * 2`), so
there is no floating-point drift anywhere between the gate's pitch and the string's. Measured off
the live context: the gate hummed 329.63 / 659.26 and 440.00 / 880.00, which is E4 and A4 with
their exact octaves.

That is not pedantry here. **A gate that hums a minor third and opens for something merely near it
is the exhibit failing silently**, and the failure is invisible from inside: a player hears two
pitches that are close, cannot say why one is wrong, and blames their ear.

**A chord is a six-bit mask** over the strings. What the gate asks and what you just played are
the same kind of value, and the comparison is `===` — no set, no sort, no tolerance, nowhere for a
near miss to be accepted. The last two or three strings struck are the answer you gave, so
striking three together and striking them one at a time are the same answer, which they have to be
because on a phone it is one finger.

---

## The attack, and what it felt like at other values

The strings use the package's default `ATTACK_SEC` — **6 ms** — and nothing else. The gate's
answering tone overrides it to **70 ms**.

That one field is the whole difference between the two halves of the exhibit. At 6 ms a string is
*struck*: the sound is already at full level before you have finished thinking about the tap, and
the ear attributes it to your finger. Raising the strings to 30 ms — still fast by the standards of
a UI blip — moves the onset past the point where it reads as caused by the press; it becomes a
notification *about* the press, and the instrument stops being an instrument. Raising them to the
gate's 70 ms is unusable: with six of them you cannot tell a chord from an arpeggio.

Going the other way is not available and should not be: `ATTACK_SEC`'s own doc explains that below
about 6 ms the leading-edge click comes back, and a gain stepping from 0 to 0.3 in one sample is a
click regardless of what recipe asked for it.

The gate's 70 ms is doing the opposite job. A gate that *struck* its notes would be a second
instrument competing with yours; swelling makes it a **place** making a sound, and that is what
lets both sound at once without confusion. The notes are arpeggiated 240 ms apart rather than
played as a block — three pitches at once is a chord to admire, three in a row is a chord you can
write down.

---

## What mashing every string at once actually sounded like

The first thing anybody does, so it was tested on purpose and instrumented rather than guessed at:
the page's `AudioContext` was tapped with a `ScriptProcessorNode` peak meter on the audio thread
(an `AnalyserNode` read from `requestAnimationFrame` misses every transient), and every
oscillator, buffer source and `AudioParam` write was counted.

**What it sounds like: one full, slightly gong-like chord, not six blips.** Six pitches from one
pentatonic scale struck inside a millisecond fuse into a single sustained event with a bright
attack and a long, slightly beating tail — the octave partials decay in about 0.3 s and leave the
triangle fundamentals ringing for a second. It is pleasant, which is the point of the scale
choice; it also carries no information, which is the point of the puzzle. And underneath it the
bed audibly drops away and comes back, which is the moment the duck is most obviously working.

The numbers behind that, from one mash on top of a gate hum:

| | |
|---|---|
| oscillators + buffer sources scheduled in one instant | **14–17** (6 strings × 2 layers, plus whichever of `refuse` / `open` the answer earned) |
| dropped by `MAX_VOICES` | **none** — all six fundamentals appeared: 220, 261.63, 293.66, 329.63, 392, 440, each with its exact octave |
| true peak, gate hum + full mash + bed | **0.253** |
| samples at or above full scale | **0** over 173 audio blocks |

**Why it does not clip, and why the master gain is 0.62.** The arithmetic that matters is
`effectiveGain`: six strings peak at 0.9 before the bus, three gate tones add 0.525, and the bed
adds about 0.03 once it has ducked — 1.455 in the worst case, so the master has to sit at or below
0.65 for the sum to stay under `validateSounds`'s 0.95 ceiling. The *measured* peak is 0.25 rather
than 0.90 because six unrelated frequencies never align, but WebAudio hard-clips instantaneously
and the whole point of this package is a ceiling that is **provable** rather than probable, so the
mix is set by the arithmetic and not by the meter. The consequence is an exhibit that is quieter
than it could be; that is the honest trade and it is stated here rather than fixed by hoping.

Turning the panel's **voice ceiling** down to 2 and mashing is the audible wrong end: the burst
comes back with holes in it, and which holes changes with the order the strings were struck.

---

## The bed, the duck, and whether the mixer made it easy

The bed is four continuous layers — two sines a third of a hertz apart so they beat, noise banded
low for moving air, a triangle banded high that only arrives as the cave opens — driven by
`bed.set(level, tone)` off one number, the fraction of gates opened. The same number lerps the
palette, so the cave cannot look warm and sound cold.

**The duck is wired on the mixer, not on the bed.** `duck` is set to 1 by *any* scheduled voice,
read off `Audio.onScheduled` rather than off the call sites, so there is exactly one place it can
be forgotten; it falls back over about 1.1 s and drives `mixer.setGain('music', …)`. Measured on
the live context, the `music` bus moves 0.62 → 0.18 the instant a string is struck and climbs back
in one-hundredth steps.

**Did the mixer make it easy?** Half.

- **What it got right:** gain and mute really are two values, `setGain` really is ramped rather
  than assigned, and the fact that a bus level survives `unlock()` meant the duck could be written
  before there was a device to hear it. None of that needed a workaround.
- **What it did not:** `Mixer.setGain` takes no ramp length. It always approaches over
  `RAMP_SEC` (15 ms), which is exactly right for the duck *down* and far too fast for the recovery,
  so the return has to be driven frame by frame from the exhibit's own envelope — and because an
  approach re-anchored sixty times a second never arrives, the write has to be quantized to a
  hundredth so it only fires when the number actually moves. That is about four lines that a
  `setGain(bus, value, rampSec)` would delete. **Ducking is listed in the package README as "the
  nearest miss… first thing for v2"; this is the demo it asked for, and the finding is that the
  policy is easy and the ramp is not.**
- **And one shape thing:** `createBed` defaults to the `sfx` bus, correctly, because a player
  muting *music* should not silence the world. But a bed that has to duck must be on a bus the
  ducking thing is not, so this exhibit puts it on `music` and thereby ties the cave's ambience to
  the switch a player uses to turn music off. Both defaults are right on their own and they
  conflict; a `duck` policy inside the package would not have to choose.

---

## The logic / art split

`npm run gallery -- resonance`:

| | module | lines |
|---|---|---|
| logic | `main.ts` | 81 |
| logic | `cavern.ts` | 53 |
| logic | `hud.ts` | 46 |
| logic | `puzzle.ts` | 19 |
| **logic total** | | **199** / 200 |
| art | `props.ts` | 138 |
| art | `rock.ts` | 93 |
| art | `view.ts` | 84 |
| art | `sound.ts` | 81 |
| art | `palette.ts` | 22 |
| art | `index.html` `<style>` | 79 |
| **art total** | | **497** (71%) |

The split was planned before anything was written, and two of its boundaries are worth stating
because they are the ones that could have gone either way:

- **`sound.ts` is art, including the pitch table.** `docs/GALLERY.md` settles the recipes; the
  pitch table follows for a reason specific to this exhibit — **there is not a frequency anywhere
  in `puzzle.ts`.** A chord there is a set of string *indices*, and which hertz index 3 stands for
  is a voicing. That is a genuinely clean line rather than a convenient one: delete `sound.ts` and
  the puzzle still knows which chord opens which gate and whether you answered it, and has no
  voice to say it with.
- **`view.ts` is art**, and it is the module that made the cap reachable. The pass table, the depth
  bucket, the light pools and the per-frame `Look` are eighty lines of drawing plumbing; in
  `main.ts` they would be eighty lines the next reader walks past to find the puzzle.
- **The HUD's structure is markup in `index.html` and only its wiring is TypeScript.** A fixed row
  of six string pads with fixed labels is appearance; the code that reads game state and writes it
  into that tree is `hud.ts` and is logic. *(This is also a hole in the measuring tool — see the
  findings below.)*

---

## Where the kit fought back

Ranked by how much each cost, and every one of them is about `@latticekit/audio` or about drawing
sound.

### 1. A chord cannot be one sound. `minGapMs` is keyed on the id, and a chord is *n* plays of one timbre in one millisecond

This is the finding that shaped the exhibit's whole table. `PlayOptions.detune` gives six pitches
from one recipe — and the throttle then throws five of them away, because it is keyed on the sound
**id** and six strings sharing an id are six plays of the same sound in the same instant. That is
exactly right for a COLLECT ALL button and exactly wrong for a chord, and the package has no way
to tell them apart.

So a chord has to be spelled as *n* different sound ids: twelve rows where two would do. It is
survivable — the table reads fine, and one could argue the explicitness is a feature — but the
author of the *next* audio game will rediscover it, and the fix is small. Either a per-play
`ignoreGap` in `PlayOptions`, or the throttle keyed on `(id, detune)` rather than on `id`, would
let one recipe be a chord. **The second is probably right**, because the reason the throttle exists
is that twenty *identical* voices stack into a click, and twenty voices at twenty different pitches
do not.

### 2. `AudioParam` aside — the recommended "plays every sound it declares" test does not work here

`packages/audio/README.md` ends with a test every game built on this package is told it needs:
grep the source for `play('<id>')` for every key of the table. Run it against this exhibit and
**twelve of fifteen sounds report as unplayed**, because the strings and the gate tones are played
through `STRING_IDS[i]` and `TONE_IDS[i]` — which is the only way to play a table indexed by an
integer while keeping `play`'s argument typed.

The defect the test exists to catch is real and this exhibit would like to be protected from it.
Suggested fix in the package: `Audio.played` — a `ReadonlySet<Ids>` of ids that have been accepted
at least once — so the test becomes a runtime assertion after a scripted play-through instead of a
grep over source. It costs one `Set.add` on the accepted path.

### 3. `Mixer.setGain` has no ramp length, so a duck's recovery is a per-frame loop

Covered above. `setGain(bus, value, rampSec)` would delete four lines here and the quantization
that goes with them.

### 4. `LightField.add` and `glowDot` end in `softEllipse`, whose ramp cache is un-quantized and evicts wholesale

Reported independently by `crowd` and `caverns` while this exhibit was being built, and it lands
hardest here: **this is the only exhibit whose glow is driven by `Audio.onScheduled`**, so its
colors move on every voice and hardest during a mash. Measured before the fix and after:

| | softEllipse blits / frame | gradient allocations / frame |
|---|---|---|
| after snapping every glow to six levels | **~612** | **~0.33** (0.05% miss rate) |

The workaround lives in `props.ts` as `snapGlow`, and the shape of it is worth keeping even after
`draw` is fixed: **the timing is the mechanic and stays exact; only the brightness is snapped.**
Six levels rather than sixteen is a *budget* — the cache holds 96 pairs across the whole page, and
three light inks × six levels × two pools already spends 36 of them.

### 5. `bootstrap` exposes no clock, and `@latticekit/ui`'s `createOverlay` wants one

`createOverlay({ now })` takes milliseconds, `performance.now()` is banned in exhibit source, and
`Boot` publishes no clock. This exhibit does what `caverns` did: `() => boot.loop.realTime * 1000`.
Two exhibits inventing the same expression is a `Boot.nowMs` waiting to happen.

### 6. `loop.stats.worstFrameMs` measures the pump and not the gap between pictures

§ Scale asks every HUD to carry its own worst frame, and `worstFrameMs` is the obvious field to
put there — but it times the pump's own body, so a garbage-collector pause between pumps is
invisible to it (`terraces` measured a HUD reading 0.0 ms against a real worst gap of 9.2 ms).
This exhibit measures the interval between two `onRender` calls off the `nowMs` the loop already
hands over, which is both honest and free. Want `FrameStats.worstGapMs` beside it.

### 7. `TileGrid.forEach` and `Bucket.each` take a visitor and pass no context

Already filed by `examples/_shared` as "the one wart"; this exhibit hit it twice, in `rock.ts` and
in `view.ts`, and paid the same price both times — a module-level slot holding the pen, with a
comment explaining why it is not a closure. A context-carrying overload removes it everywhere.

### 8. `examples/_shared/src/knobs.ts` documents a setter that now exists

`knobs.voiceCeiling`'s doc says *"`maxVoices` is read once by `createAudio` and there is no setter,
so the exhibit must supply a `Knob` whose `apply` disposes the engine and builds a new one"*, and
warns about the six-context cap. `Audio.setMaxVoices` exists and is live. This exhibit passes
`apply: (v) => audio.setMaxVoices(v)` and the knob works perfectly; the doc should be corrected
before an exhibit follows it and ships a slider that disposes an `AudioContext` per drag. Not this
task's file.

### 9. The measuring tool counts a `<style>` block as art and markup as nothing at all

`tools/gallery.mjs` charges CSS to the art column and HTML structure to neither column. That is
now the settled rule for *fixed* structure, and this exhibit follows it — but it is worth writing
down that the tool cannot tell fixed markup from generated markup, so the rule is enforced by
authors rather than by the command. A strip of gate indicators built one-per-gate would be logic
and would look identical to the tool.

### 10. Small ones

- **`SoundDef.spatial` defaults to `bus === 'sfx'`**, which is a good default, and the pan then has
  to be computed by the game from `camera.normalizedX` — correctly, since `audio` is layer 1. Four
  lines, exactly as the README promises. No complaint; noted because it is the one cross-layer seam
  in the package and it is pleasant.
- **A suspended context freezes `Audio.now()`, and the throttle then refuses everything.** In a
  browser tab that has never had a real user gesture, `available` reports `true` (a context object
  exists) while `currentTime` stays at 0, so the second play of any id is refused for ever. It is
  correct behaviour from three correct decisions, and it is worth a sentence in the docs because
  the symptom — "the first sound works and nothing after it does" — points nowhere near the cause.
- **`createBed`'s `sagTo` of 0.55 is too deep for a bed pitched this low.** At 41.2 Hz it sags to
  22.7 Hz, under the `MIN_TONE_HZ` the validator enforces for one-shots but does not check for bed
  layers. This exhibit uses 0.8. A `validateBed` would have caught it.

---

## Scale, judged honestly

On a 1440×900 viewport at the opening zoom of 0.95:

| row | verdict |
|---|---|
| **extent** | the map is 108×108 tiles — 6912×3456 world px, about **4.6× the viewport** on its long axis. Passes comfortably |
| **fill** | **zero background.** The generator makes the field solid and hollows it out, so every pixel is floor, wall face or the mass overhead. There is no sky slot in the palette and nothing ever draws one. `drawVoid` exists for the outermost frame of the diamond at full zoom-out and is otherwise invisible |
| **edges** | the rim is a subtraction rather than a branch, so the rock thickens toward the map's boundary instead of ending at it. There is no corner to find |
| **density** | **101 gates** across the map on the shipping seed, 94–116 across the seeds tried, and formations minted per frame from a hash — about 120 within lamp reach at any moment out of roughly 1,500 across the map. Gates in three figures, formations in four |
| **depth** | three bands, and they are structural rather than a fog: the lit pocket under the lamp; the mid band of arches and formations with their own cold pools; and the far band, where the lichen's alpha falls off with distance from the lamp so a seam forty tiles out recedes instead of glowing exactly as hard as the ground you are standing on |
| **cost** | worst inter-frame gap **0.3–7.4 ms** in a foreground tab across the whole session, including mashes. The HUD carries the number and it is the real gap, not the pump time |

**The fill row is the one I want to be honest about**, because it is the row this exhibit could
most easily have claimed and failed. "No background" is not the same as "not empty": the first
build was *technically* full of rock and read as a scatter of bright plates floating in a void,
because the rock mass was near-black and the floor pockets were pale. Three measured changes fixed
it — the tunnel threshold moved from 0.15 to 0.07 (45% floor down to 29%, measured over five seeds
rather than eyeballed), the roof came down from 20 height units to 13 so a hollow reads as a
corridor rather than a shaft, and **the floor was made darker than the rock**, which is the
opposite of every other exhibit in the gallery and is the single change that made the frame read.
A pocket of floor is dark because it is a pocket, and it is bright only where a lamp is standing
in it.

---

## What I did not do

- **No `@latticekit/persist`.** The mixer's `snapshot()` is exactly the device-scoped preference the
  package documents, and saving it is the right thing for a game — but `docs/GALLERY.md` forbids a
  row any state that outlives the tab, so it is left out on purpose.
- **No `createDeck`.** A sequencer under a puzzle you are listening to would be an argument with
  the mechanic. The bed is the whole of the continuous half.
- **No `@latticekit/sim`.** There is no economy.
- **No visual fallback for a browser that refuses a context.** The HUD says `NO AUDIO DEVICE`
  plainly, and that is where it stops: the exhibit is unplayable without sound and pretending
  otherwise would be a worse lie than the notice. The alternative — showing the chord on the ring —
  would make it a memory game with a soundtrack, which is the exhibit `Instrument` already covers.
- **No ending, no progression, no settings screen.** 101 gates is a place to be in, not a list to
  finish.

## What I would build next

**A `duck` policy inside `@latticekit/audio`** — which buses duck, how far, and over how long, as
three numbers on `AudioOptions`. This exhibit is the demo the package README asked for before
guessing, and the answer it produces is small: an envelope set by any accepted play, a depth, and
a recovery time. The only thing the package needs that it does not have is the recovery *ramp*,
which is finding 3.

And after that, **`play` returning the plan** rather than a boolean. Half of this exhibit's wiring
exists to correlate `onScheduled` back to the call that caused it, by reading the source id's
characters; a returned `Readonly<VoicePlan> | null` would make the visual half of a strike a local
variable instead of a listener.
