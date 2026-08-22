# @latticekit/audio

> Sound without assets: WebAudio synthesis from a declarative table, with voice limiting, buses, a continuous bed and an opt-in sequencer.

Part of **[Lattice](https://github.com/plausibleventures/lattice)** — the grid underneath.

```bash
npm i @latticekit/audio
```

A table of oscillator recipes becomes the sound of a game: no files, no `AudioContext` until
the player touches something, a hard ceiling on how loud a burst can get, and one continuous
bed that follows a number the game already has.

If a game author has to know what a `BiquadFilterNode` is to make a button click, this package
failed. If they have to reach past it to a raw `AudioContext` to get a kick drum, it also
failed.

---

## The example, and what it prints

This runs in Node with no `AudioContext` anywhere. It is
`packages/audio/test/readme.test.ts`, so if these numbers ever stop being the numbers the
package produces, the suite fails.

```ts
import { createAudio, createBed, validateSounds, type SoundDef } from '@latticekit/audio';

const SOUNDS = {
  tap:     { bus: 'ui',  minGapMs: 40, layers: [{ wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03, cutoff: 2400 }] },
  collect: { bus: 'sfx', minGapMs: 45, ladder: { steps: 5, windowMs: 900 },
             layers: [{ wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 }] },
} satisfies Record<string, SoundDef>;

console.log(`problems: ${validateSounds(SOUNDS).length}`);

let seconds = 0;                       // a game omits `now` and gets the device's own clock
const audio = createAudio({ sounds: SOUNDS, now: () => seconds });
audio.onScheduled((plan) => {
  console.log(`  ${plan.source} on ${plan.bus} at ${plan.hz.toFixed(2)} Hz, gain ${plan.gain.toFixed(3)}`);
});

// In a browser, from your own handler — this package never installs a listener:
//   addEventListener('pointerdown', () => audio.unlock());
console.log(`available: ${audio.available}`);

console.log(`play: ${audio.play('collect')}`);   // accepted
console.log(`play: ${audio.play('collect')}`);   // inside the 45 ms gap
seconds += 0.1;
console.log(`play: ${audio.play('collect')}`);   // accepted, and one semitone up the ladder

const bed = createBed(audio, [
  { wave: 'sine',  hz: 50, gain: 0.16, cutoff: 220, cutoffAtFull: 1.2 },
  { wave: 'noise', hz: 0,  gain: 0.10, cutoff: 320, cutoffAtFull: 4.2 },
]);
bed.set(0.5, 1);                       // every frame, with numbers the game already has

audio.dispose();
```

```
problems: 0
available: false
  collect on sfx at 660.00 Hz, gain 0.160
play: true
play: false
  collect on sfx at 699.25 Hz, gain 0.160
play: true
  bed on sfx at 50.00 Hz, gain 0.080
  bed on sfx at 0.00 Hz, gain 0.050
```

Four things in that output are the whole design:

| the output says | because |
|---|---|
| `available: false` | nothing has been constructed. `createAudio` reaches for no context, and neither does `play`, `mixer.setGain` or `createBed` |
| `play: true` with no device | `play` returns **accepted**, not "a speaker moved". The throttle, the ladder and the ceiling all ran; only the rendering did not |
| the second `play` emits nothing | the 45 ms gap. Twenty `collect` calls in one tap is one chord, never twenty blips |
| `699.25` on the third | the ladder. Four taps in a run climb the scale rather than repeating, and reset when the player stops |

The argument type of `play` is `'tap' | 'collect'`, inferred from the table's keys. There is no
`SoundId` type to maintain and `play('colect')` does not compile.

---

## A sound is ten numbers, not a node graph

A layer is one **fixed** signal chain:

```
source → [highpass] → [lowpass] → gain envelope → [pan] → bus
```

What an author may vary: which of five sources (`sine`, `triangle`, `square`, `sawtooth`,
`noise`), one starting pitch, one exponential sweep target, one peak gain, one decay length,
one start delay, one attack override, one low-pass corner, one high-pass corner, one pan.
What an author may **not** vary: the order of the chain, the envelope's shape, the number of
filters, whether anything modulates anything else.

That is enough for a pitch-swept sine that is a kick drum, two detuned saws that beat against
each other, and noise through a high-pass that is a hi-hat. It is not enough for an FM bell,
and that is the trade: an FM bell is one more sound, and a modulation matrix is a permanent tax
on every reader of these types.

**The refusal that matters most is routing.** The moment routing is author-defined, the
clipping ceiling can no longer be validated statically — a feedback delay at 0.9 turns a 0.16
chord into a runaway and no static check can see it. Fixed chain, provable ceiling:

```ts
validateSounds({
  chord: { minGapMs: 100, layers: [
    { wave: 'sine', hz: 440, gain: 0.60, hold: 0.4 },
    { wave: 'sine', hz: 550, gain: 0.64, hold: 0.4 },
  ] },
});
// [{ sound: 'chord', code: 'clips',
//    message: 'chord peaks at 1.24, ceiling is 0.95 — WebAudio sums and hard-clips above 1.0, …' }]
```

It sums only the layers that are alive at the same instant, so an arpeggio of three 0.5 layers
90 ms apart is not reported as a 1.5 chord. The other codes it returns: `no-layers`,
`no-throttle`, `ladder-shorter-than-gap`, `ladder-too-short`, `inaudible`,
`sub-audio-frequency`, `zero-hold`.

It returns problems rather than throwing, because a shipped game must not refuse to start
because a sound is 0.03 too loud. Assert the array is empty in your own test instead.

---

## Bursts must not stack

Two independent defences, because they fail differently:

- **`minGapMs`** handles the repeat of *one* sound. It is required, not optional, because the
  author who most needs it is exactly the author who would omit it.
- **`MAX_VOICES`** (24) handles twenty *different* sounds in the same millisecond, which no
  per-sound gap can see. Past the ceiling, `play` **drops** rather than queues: a queued burst
  arrives after the moment that caused it and reads as lag.

Voices are counted by **scheduled end time**, never by an `onended` callback. A counter driven
by `onended` leaks — the bed's oscillators never end, so their callback never fires, and a game
that runs for an hour ends up permanently at the ceiling and goes silent.

### The ceiling moves, and so does the pan limit

```ts
let t = 0;
const audio = createAudio({ sounds: SOUNDS, maxVoices: 1, now: () => t });

audio.play('collect');                                  // accepted — and that is the ceiling full
console.log(`ceiling ${audio.maxVoices}, tap: ${audio.play('tap')}`);

audio.setMaxVoices(4);                                  // a setter, not a rebuild
console.log(`ceiling ${audio.maxVoices}, tap: ${audio.play('tap')}`);

audio.setMaxPan(0);                                     // a mono switch, for a settings screen
console.log(`maxPan ${audio.maxPan}, context ${audio.context}`);
```

```
ceiling 1, tap: false
ceiling 4, tap: true
maxPan 0, context null
```

**Why these are setters and not a rebuild.** `dispose()` closes the `AudioContext` and a
document gets about six of them, ever. A voice-ceiling slider that rebuilt the engine on every
drag — which is the only thing a construction-time ceiling allows — permanently silences the
page in about a second. The ceiling is one integer in one comparison: nothing is allocated from
it, no handle is derived from it, and no save or log records it, so there is nothing downstream
with a correctness claim that it did not change. That is the test in `docs/rfc/live-options.md`,
and it is the only admissible reason to refuse a setter.

Two consequences worth knowing before you drag one:

- **Lowering the ceiling refuses new plays; it does not cut live voices short.** `audio.voices`
  may read above `audio.maxVoices` until the release tails pass. What is sounding is not what is
  allowed.
- **`setMaxVoices` throws on a non-integer or anything below 1, in the same words `createAudio`
  uses.** It is author-facing at both entrances. `setMaxPan` clamps instead, because that one
  can reach a player's slider and a slider must not be able to throw.

### Everything you configured reads back

No field of an options bag in this package is write-only, so nothing that drives the engine has
to keep a second copy of a number it already handed over — two copies drift, with no error the
day they do.

| you passed | read it back | move it |
|---|---|---|
| `AudioOptions.sounds` | `audio.sounds` (frozen) | the table's keys *are* the id union |
| `AudioOptions.context` | `audio.context` — the device it produced, or `null` | `unlock()` builds it once |
| `AudioOptions.now` | `audio.now()` — audio-clock seconds, the base `PlayOptions.at` is in | — |
| `AudioOptions.maxVoices` | `audio.maxVoices` | `audio.setMaxVoices(n)` |
| `AudioOptions.maxPan` | `audio.maxPan` | `audio.setMaxPan(n)` |
| `BedOptions.bus` / `sagTo` / `glideSec` | `bed.bus`, `bed.sagTo`, `bed.glideSec` | — |
| `createDeck`'s `autoPump` | `deck.autoPump` | — |
| `deck.play(song)`, `setTrackMuted` | `deck.song`, `deck.trackMuted(id)` | `play`, `setTrackMuted` |

---

## Buses, and what you persist

Three buses — `music`, `sfx`, `ui` — plus `master`. Fixed and closed, because the reason buses
exist is a player who wants the music off and the alerts on, and that player needs the *same
three switches* in every Lattice game.

```ts
audio.mixer.setGain('music', 0.4);
audio.mixer.setMuted('music', true);
audio.mixer.setMuted('music', false);
audio.mixer.gain('music');            // 0.4 — mute never overwrote the level
```

**This package stores nothing.** `snapshot()` returns a small versioned value and `restore()`
takes one back; hand it to `@latticekit/persist` as a *device-scoped* preference, not as save
state — a player who hits START OVER must not get their sound turned back on.

```ts
const saved = audio.mixer.snapshot();  // { version: 1, gain: {…}, muted: {…} }
audio.mixer.restore(saved);            // out-of-range or truncated values are clamped, never thrown
```

---

## The bed — the half that survives twenty minutes

A loop is annoying at twenty minutes because it is the same twenty minutes regardless of what
the player did. What wears out is *melody*; texture does not. Nobody has ever been annoyed by
rain.

```ts
const bed = createBed(audio, VALLEY_LAYERS);
bed.set(activity, daylight);   // every frame; the same 0–1 the palette lerps on
```

- `level` scales gain and opens the filters — an empty world is **silent**, not quiet.
- `tone` sags the pitch, closes the top end, and crossfades `band` layers. Plant losing power
  winds *down*: a drop in level alone reads as a mixing change, a drop in pitch reads as
  machinery stopping.
- `band: [0, 0.5]` on crickets and `band: [0.4, 1]` on coil whine gives a day↔night crossfade
  as two layers trading places. One filter sweep sounds like a filter sweep; two layers trading
  places sounds like evening. **Overlap the bands**, or keep one unbanded layer — a bed that is
  silent at some middle value of `tone` is a hole the player walks into.

`set` is safe to call every frame: it ramps toward the figures, allocates nothing, creates no
nodes after the first, and **does not re-issue an unchanged target** — an approach re-anchored
sixty times a second never actually arrives.

A bed built before `unlock()` stands its nodes up on the first unlock, at whatever level it has
been driven to in the meantime.

---

## The deck — opt-in

```ts
import { createDeck, validateSong } from '@latticekit/audio';

const deck = createDeck(audio);     // a game that never imports this does not ship it
deck.play(THEME);
deck.setIntensity(0.8);             // gates tracks by minIntensity; never changes tempo
```

Five properties make a loop survive an hour behind a spreadsheet, and `validateSong` enforces
the ones a machine can see:

1. **It rests.** A melodic track speaking on more than three quarters of the steps is a drill.
   Percussion is exempt — a steady hat is the thing a listener stops hearing and starts moving
   to — which is what `melodic` is for.
2. **It is mixed under the information.** Every note is quieter than the quietest sound that
   means something; a theme that buries the alarm gets the whole game muted.
3. **The harmony is one loop, rotated.** `C-G-Am-F` is `Am-F-C-G` started elsewhere.
4. **Nothing is bright.** Give every track a `cutoff`.
5. **Bars are not identical.** A per-track `bars` mask and a seeded per-note `drop`, rolled from
   `hash3(seed, bar, step, track)` — stateless, so muting one track cannot shift what any other
   track plays, and the same seed is the same twenty minutes on every machine.

The deck runs its own 200 ms timer and schedules 1.5 s ahead. That horizon is about background
tabs: `setInterval` is throttled to a second or more when a tab is hidden. **Never drive
`pump()` from `requestAnimationFrame` alone** — rAF is 0 Hz in a hidden tab.

---

## Testing without an `AudioContext`

Policy above, rendering below. The throttle, the ladder, the ceiling, bus resolution, sequencer
step times and bed targets are all pure and clock-injected, and every one of them emits a
`VoicePlan` through `onScheduled`:

```ts
let now = 0;
const audio = createAudio({ sounds: SOUNDS, context: () => null, now: () => now });
const plans: VoicePlan[] = [];
audio.onScheduled((plan) => plans.push({ ...plan }));   // copy: the object is reused

audio.play('collect');
audio.play('collect');
expect(plans).toHaveLength(1);   // the gap, asserted with no mock at all
```

`context: () => null` is a headless run. A spy factory proves nothing is constructed before the
first gesture. **The plan object is reused between calls** — one emission per layer per play,
which the sequencer alone does eight times a second — so copy what you keep.

`onScheduled` is not a test hook: a HUD can flash a meter on the beat from it, with no
`AnalyserNode` and no real context.

### The test every game built on this needs

`validateSounds` cannot see a sound that is declared and never played. That defect is silent,
and it is a game that is simply quiet at the one moment it should not be:

```ts
it('plays every sound it declares', () => {
  const code = sourceFiles('src').map((f) => readFileSync(f, 'utf8')).join('\n');
  const unplayed = Object.keys(SOUNDS).filter((id) => !code.includes(`play('${id}')`));
  expect(unplayed).toEqual([]);
});
```

---

## What is deliberately absent

Each of these was considered and refused; adding one back needs an argument that beats the one
written beside it in `docs/rfc/audio.md` §4.

| absent | because |
|---|---|
| audio files, `decodeAudioData`, `AudioWorklet` | zero assets. A worklet is a separate file, which is an asset by another name |
| user-defined node graphs, LFOs, reverb, delay, compression | the clipping ceiling stops being provable. `ConvolverNode` also needs an impulse response, which is an asset |
| `PannerNode`, HRTF, distance models | 3D machinery for a 2D game, priced per voice. Stereo pan on *transients* only, capped at ±0.6 — hard pan is fatiguing on headphones |
| `AnalyserNode`, FFT | needs a real device, so anything built on it is invisible to tests. `onScheduled` gives a HUD the beat instead |
| a module-level singleton | two games on one page becomes impossible, and test order starts to matter |
| `localStorage` | `snapshot`/`restore` return a value; `@latticekit/persist` owns storage |
| its own `pointerdown` listener | `@latticekit/input` owns the DOM event surface, and a listener installed at import time is exactly the boot-time side effect rule 1 exists to prevent |
| ducking (music dipping under an alert) | the nearest miss. It needs a policy — which sounds duck, how far, how long — and the demo should tell us rather than a guess. First thing for v2 |

**Screen-x → pan is not computed here.** That mapping needs a camera, and this package is layer
1 and does not know `iso` exists. Four lines in the game; `PlayOptions.pan` takes the result.

---

## Determinism, and the one adapter

No `Math.random`, no `Date.now`, no `performance.now`. Time arrives as audio-clock seconds from
the device or from `AudioOptions.now`; the sequencer's variation comes from `hash3` in
`@latticekit/core`, which is stateless, so a track muted at load cannot shift what every other
track plays.

Exactly **one** module reads a host global — `src/host.ts`, marked `@browser-only`, holding the
`AudioContext ?? webkitAudioContext` lookup and the deck's timer. Everything else imports
cleanly into Node.

## Performance

Measured with no device, which is the honest measurement of the policy layer (`npm run bench`,
Node 20, Apple silicon):

| path | ops/sec | per call |
|---|---|---|
| `bed.set` with new figures | 8.6 M | ~117 ns |
| `bed.set` with unchanged figures | 13.2 M | ~76 ns |
| `play`, accepted (2 layers) | 7.1 M | ~141 ns |
| `play`, dropped by the throttle | 39.1 M | ~26 ns |
| `deck.pump` across one step | 10.0 M | ~100 ns |
