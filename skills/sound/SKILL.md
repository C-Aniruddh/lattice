---
name: sound
description: Sound and music with no audio files — synthesized clicks, chimes, thumps, ambience and a soundtrack. Use when adding sound effects, audio feedback, music, ambience or a soundscape to a game, when sound should react to what is happening, when audio is silent or only plays once, or when a burst of sounds clips into a click.
---

# Sound

No files. A table of ten-number recipes becomes the whole sound of a game, and there is no
`AudioContext` until the player touches something.

Two rules before anything else:

- **No sound comes out until a user gesture unlocks the audio.** Browsers refuse otherwise. This
  package installs no listener of its own — you call `unlock()` from your own handler.
- **`play()` returns *accepted*, not *audible*.** The throttle, the ladder and the voice ceiling
  all run with no device present; only the rendering does not. That is what makes the policy
  layer testable in Node.

---

## A game's whole sound

```ts
import { createAudio, createBed, validateSounds } from '@latticekit/audio';
import type { SoundDef } from '@latticekit/audio';

const SOUNDS = {
  tap:     { bus: 'ui',  minGapMs: 40,
             layers: [{ wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03, cutoff: 2400 }] },
  place:   { bus: 'sfx', minGapMs: 60,
             layers: [{ wave: 'triangle', hz: 180, toHz: 90, gain: 0.22, hold: 0.14, cutoff: 1200 },
                      { wave: 'noise', hz: 0, gain: 0.10, hold: 0.05, cutoff: 3000 }] },
  collect: { bus: 'sfx', minGapMs: 45, ladder: { steps: 5, windowMs: 900 },
             layers: [{ wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 }] },
  deny:    { bus: 'ui',  minGapMs: 120,
             layers: [{ wave: 'square', hz: 140, gain: 0.08, hold: 0.09, cutoff: 900 }] },
} satisfies Record<string, SoundDef>;

export const audio = createAudio({ sounds: SOUNDS });

/** Assert this is empty in your own test. `validateSounds` returns problems rather than
 *  throwing, because a shipped game must not refuse to start because a sound is 0.03 too loud. */
export const problems = validateSounds(SOUNDS);

/** From YOUR handler. This package installs no listener — a listener at import time is exactly
 *  the boot-time side effect the determinism rule exists to prevent. */
export function onFirstTouch(): void {
  audio.unlock();
}

/** The ambience. One continuous bed, driven by numbers the game already has. */
export const bed = createBed(audio, [
  { wave: 'sine',  hz: 50, gain: 0.16, cutoff: 220, cutoffAtFull: 1.2 },
  { wave: 'noise', hz: 0,  gain: 0.10, cutoff: 320, cutoffAtFull: 4.2, band: [0, 0.55] },
  { wave: 'sine',  hz: 88, gain: 0.07, cutoff: 400, cutoffAtFull: 2.0, band: [0.45, 1] },
]);

/** Every frame, with the SAME number that lerps the palette — so the world cannot look warm
 *  and sound cold, and a mismatch cannot get reported as a lighting bug. */
export function everyFrame(activity: number, daylight: number): void {
  bed.set(activity, daylight);
}

export function collect(): void {
  audio.play('collect');    // twenty of these in one tap is one chord, never twenty blips
}
```

`audio.play('colect')` does not compile — the argument type is inferred from the table's keys.
There is no `SoundId` type to maintain.

---

## A sound is ten numbers, not a node graph

One **fixed** signal chain per layer:

```
source → [highpass] → [lowpass] → gain envelope → [pan] → bus
```

What you may vary: which of five sources (`sine`, `triangle`, `square`, `sawtooth`, `noise`), one
starting pitch, one exponential sweep target, one peak gain, one decay length, one start delay,
one attack override, one low-pass corner, one high-pass corner, one pan. What you may **not**
vary: the order of the chain, the envelope's shape, the number of filters, whether anything
modulates anything else.

That is enough for a pitch-swept sine that is a kick drum, two detuned saws that beat against
each other, and noise through a high-pass that is a hi-hat. It is not enough for an FM bell, and
that is the trade.

**The refusal that matters most is routing.** The moment routing is author-defined the clipping
ceiling can no longer be validated statically — a feedback delay at 0.9 turns a 0.16 chord into a
runaway and no static check can see it.

```ts
import { validateSounds } from '@latticekit/audio';

export const clipping = validateSounds({
  chord: { minGapMs: 100, layers: [
    { wave: 'sine', hz: 440, gain: 0.60, hold: 0.4 },
    { wave: 'sine', hz: 550, gain: 0.64, hold: 0.4 },
  ] },
});
// [{ sound: 'chord', code: 'clips',
//    message: 'chord peaks at 1.24, ceiling is 0.95 — WebAudio sums and hard-clips above 1.0…' }]
```

It sums only the layers alive at the same instant, so an arpeggio of three 0.5 layers 90 ms apart
is not reported as a 1.5 chord. The other codes: `no-layers`, `no-throttle`,
`ladder-shorter-than-gap`, `ladder-too-short`, `inaudible`, `sub-audio-frequency`, `zero-hold`.

**Set the master by arithmetic, not by the meter.** One exhibit's worst case summed to 1.455
across strings, gate tones and bed, so its master had to sit at or below 0.65 for the total to
stay under the 0.95 ceiling; the *measured* peak was 0.253 because unrelated frequencies never
align. WebAudio hard-clips instantaneously, and the point of this package is a ceiling that is
**provable** rather than probable.

---

## Bursts must not stack — two defences, because they fail differently

**`minGapMs`** handles the repeat of *one* sound. It is required, not optional, because the
author who most needs it is exactly the author who would omit it.

**`MAX_VOICES`** (24) handles twenty *different* sounds in the same millisecond, which no
per-sound gap can see. Past the ceiling, `play` **drops** rather than queues: a queued burst
arrives after the moment that caused it and reads as lag.

Voices are counted by **scheduled end time**, never by an `onended` callback. A counter driven by
`onended` leaks — the bed's oscillators never end, so their callback never fires, and a game that
runs for an hour ends up permanently at the ceiling and goes silent.

```ts
import type { Audio } from '@latticekit/audio';

export function settings(audio: Audio<'tap'>): void {
  audio.setMaxVoices(12);     // a SETTER. Never rebuild the engine for this
  audio.setMaxPan(0);         // a mono switch, for an accessibility setting
}
```

**Why those are setters and not a rebuild.** `dispose()` closes the `AudioContext` and a document
gets about **six of them, ever**. A voice-ceiling slider that rebuilt the engine on every drag —
which is the only thing a construction-time ceiling allows — **permanently silences the page in
about a second.** The ceiling is one integer in one comparison: nothing is allocated from it, no
handle derives from it, and no save or log records it.

Two consequences before you drag one: lowering the ceiling refuses new plays and does **not** cut
live voices short, so `audio.voices` may read above `audio.maxVoices` until the release tails
pass. And at a ceiling of 2, mashing gives a burst with holes in it — and *which* holes changes
with the order things were struck.

---

## The traps that cost real sessions

**A chord cannot be one sound.** `minGapMs` is keyed on the sound **id**, so six strings sharing
an id are six plays of the same sound in the same instant and five of them are thrown away. That
is exactly right for a "collect all" button and exactly wrong for a chord, and the package has no
way to tell them apart. Spell a chord as *n* different ids — twelve rows where two would do — or
arpeggiate with per-layer `delay`.

**A suspended context freezes the clock, and then the throttle refuses everything for ever.** In
a tab that has never had a real user gesture, `available` reports `true` (a context object
exists) while `currentTime` stays at 0 — so the second play of any id is refused permanently. The
symptom is "**the first sound works and nothing after it does**", and it points nowhere near the
cause. Call `unlock()` from a real gesture handler and check that `audio.now()` advances.

**Never use `Math.pow` for intervals.** `SEMITONE` is exported for exactly this — the twelfth root
of two, written out — because `pow` is not required by the language spec to be correctly rounded.
Walk the interval one multiply at a time and use exact small-integer ratios for partials. A gate
that hums a minor third and opens for something merely *near* it is a game failing silently: a
player hears two pitches that are close, cannot say why one is wrong, and blames their ear.

**`attack` is the whole difference between an instrument and a notification.** The default is
about 6 ms and at 6 ms a note is *struck*. Raise it to 30 ms — still fast by UI standards — and
the onset moves past the point where it reads as caused by the press; it becomes a notification
*about* the press. Below about 6 ms the leading-edge click comes back, because a gain stepping
from 0 to 0.3 in one sample is a click whatever the recipe asked for.

**`Mixer.setGain` takes no ramp length.** It always approaches over about 15 ms, which is right
for a duck *down* and far too fast for the recovery — so a recovery has to be driven frame by
frame from your own envelope, and because **an approach re-anchored sixty times a second never
arrives**, quantize the write to about a hundredth so it only fires when the number actually
moves. Wire a duck on the **mixer**, from `onScheduled`, rather than at each call site: there is
then exactly one place it can be forgotten.

**A bed that must duck cannot be on the ducking bus.** `createBed` defaults to `sfx`, correctly,
because a player muting *music* should not silence the world — but a bed that ducks under
gameplay sounds must be on a bus those sounds are not, which ties the ambience to the music
switch. Both defaults are right on their own and they conflict; pick deliberately.

**`createBed`'s `sagTo` default is too deep for a low-pitched bed**, and `validateSounds` does not
check bed layers. At the 0.55 default a 41 Hz layer sags to 22.7 Hz — under the audible floor the
validator enforces for one-shots. Use about 0.8 for anything pitched that low.

---

## The bed — the half that survives twenty minutes

A loop is annoying at twenty minutes because it is the same twenty minutes regardless of what the
player did. **What wears out is melody; texture does not.** Nobody has ever been annoyed by rain.

- `level` scales gain and opens the filters — an empty world is **silent**, not quiet.
- `tone` sags the pitch, closes the top end and crossfades `band` layers. A plant losing power
  winds *down*: a drop in level alone reads as a mixing change, a drop in pitch reads as
  machinery stopping.
- `band: [0, 0.55]` on crickets and `band: [0.45, 1]` on coil whine gives a day↔night crossfade as
  two layers trading places. One filter sweep sounds like a filter sweep; two layers trading
  places sounds like evening. **Overlap the bands**, or keep one unbanded layer — a bed that is
  silent at some middle value of `tone` is a hole the player walks into.

`set` is safe to call every frame: it ramps toward the figures, allocates nothing, creates no
nodes after the first, and does not re-issue an unchanged target.

A bed built before `unlock()` stands its nodes up on the first unlock, at whatever level it has
been driven to in the meantime.

---

## Testing it with no speaker

```ts
import { createAudio } from '@latticekit/audio';
import type { SoundDef, VoicePlan } from '@latticekit/audio';

const SOUNDS = {
  collect: { bus: 'sfx', minGapMs: 45,
             layers: [{ wave: 'triangle', hz: 660, gain: 0.16, hold: 0.1 }] },
} satisfies Record<string, SoundDef>;

export function throttleTest(): number {
  let now = 0;
  const audio = createAudio({ sounds: SOUNDS, context: () => null, now: () => now });
  const plans: VoicePlan[] = [];
  audio.onScheduled((plan) => plans.push({ ...plan }));   // COPY: the object is reused

  audio.play('collect');
  audio.play('collect');       // inside the 45 ms gap
  return plans.length;         // 1 — the gap, asserted with no mock at all
}
```

`context: () => null` is a headless run. `onScheduled` is not only a test hook: a HUD can flash a
meter on the beat from it, with no analyser and no real context.

**The test every game built on this needs**, because `validateSounds` cannot see a sound that is
declared and never played — a defect that is silent, and is a game that is simply quiet at the
one moment it should not be:

```ts
/** In a test: read your own `src/**` with `node:fs`, join it, and pass it here. */
export function unplayed(sourceText: string, ids: readonly string[]): readonly string[] {
  return ids.filter((id) => !sourceText.includes(`play('${id}')`));
}
```

That grep fails on any table indexed by an integer — one exhibit reported twelve of fifteen
sounds "unplayed" because they were played through `STRING_IDS[i]`. Know that before you trust it.

---

## Buses, and what you persist

Three buses — `music`, `sfx`, `ui` — plus `master`. Fixed and closed, because the reason buses
exist is a player who wants the music off and the alerts on, and that player needs the *same
three switches* in every game.

**This package stores nothing.** `mixer.snapshot()` returns a small versioned value and
`restore()` takes one back; hand it to the save layer as a **device-scoped preference**, not as
save state — a player who hits START OVER must not get their sound turned back on.

**Screen-x → pan is not computed here.** That needs a camera, and this package does not know the
camera exists. Four lines in the game; `PlayOptions.pan` takes the result.

---

## If the game ships silent, say why

Four exhibits in this kit deliberately make no sound, and they all give the same reason: **a page
that starts making noise before a visitor has touched it is worse than a silent one.** If you are
not going to wire an unlock gesture, do not declare sounds. And if audio is genuinely refused,
say so plainly in the HUD rather than pretending — pretending is a worse lie than the notice.

---

## What this skill does not cover

| you want | read |
|---|---|
| where `unlock()` gets called from | `input` |
| the one number that should drive both the light and the bed | `art` |
| storing a player's volume settings | `saving` |
| a meter or a beat indicator on screen | `hud` |

Long form, on disk: `node_modules/@latticekit/audio/README.md`.
