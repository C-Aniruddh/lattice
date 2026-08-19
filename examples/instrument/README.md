# Instrument

**Sound with no files — a board that shows the synthesis as it plays.** A hall of pipes, five wave
families striped across the floor, and every note built out of oscillators at the moment you ask
for it.

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-instrument
# http://localhost:5198
```

**Tap a pipe.** The hall is silent until you do — an `AudioContext` may not start before a gesture
— and the HUD says so in an ember line rather than leaving you to wonder whether it is broken.
After the first tap the bed comes up on the music bus and ducks under every struck pipe. Open
**knobs** and drag the voice ceiling to two, then mash the board: the choke is the demonstration.

---

## Who built this, and from what

**Built by Grok**, one of three vendors' agents in the gallery's fan-out, **from
`docs/GALLERY.md` alone.** It was given its own row, the whole standard and the tools, and it was
deliberately **not** shown any existing exhibit's source.

---

## The one idea: the picture is the schedule, not the signal

The obvious way to show synthesis is an `AnalyserNode`, and it would be the wrong one: an analyser
draws the *output*, which is a picture of a speaker rather than a picture of the kit. This exhibit
draws `Audio.onScheduled` instead — the reused `VoicePlan` is copied into a ring the moment the
voice is scheduled, and the ribbon in the air is that ring: wave, frequency, gain, start, end.

So what is on screen is exactly what `@latticekit/audio` was asked to make, drawn before it is
audible, and it is legible for the same reason the sound is honest: nothing was loaded. Five wave
families times twelve pitches is sixty recipes, and there is not a byte of audio anywhere in the
repository.

## Where `docs/GALLERY.md` is underwritten

Kept verbatim. The agent's framing: *"These are places the spec made me guess. Each guess is a hole
in the document."*

- **Where an exhibit lives.** The line-count command is `cd examples/<exhibit>`, and `_shared` is
  "never counted" because it lives next to the rows. This run was "in this directory", which only
  had `GALLERY.md`. I vendored `_shared` beside `src/` and did not count it. The spec never says
  how a row is built *outside* `examples/`.
- **The control panel is required and also unbuildable from the kit.** "Every exhibit ships a
  slider panel" and "nothing in the panel is exhibit-specific plumbing", but the panel is
  `examples/_shared`, not a package. A row in a bare folder cannot satisfy that sentence without
  copying gallery instruments. I copied them. That should be a sentence in the spec: a standalone
  row may vendor `_shared`, or it is not a row.
- **"A board" is not a shape.** § Scale is written for an isometric world — 1.6× extent, no
  visible corners, hundreds of a repeated thing, three distance bands. A synthesis board could
  have been a 2D panel. I guessed it is still a Lattice world — a hall of pipes you pan — because
  the listen first-screen is "a lit board humming one note" and the kit is isometric. The row does
  not say.
- **Hundreds of what.** *"Whatever the exhibit repeats."* For a sound board that could be keys,
  partials or waveform samples. I guessed pipes, about 2,000 of them. If the repeated thing was
  supposed to be *voices*, the density row and the voice ceiling fight.
- **Motion versus silence.** Rule 3 wants something moving before a touch. The audio package
  forbids a context until a gesture, and the opening frame is silent by design. I guessed: visual
  motion only — walking sparks — no autoplay and no fake gesture. The spec never names that split.
- **What "show the synthesis" looks like.** Driven from `onScheduled` rather than an analyser is
  firm. The *picture* is not. I guessed a ribbon of `glowDot`s from `wave` / `hz` / `gain` /
  `start` / `end`, plus the HUD's `sine · 116.5 Hz`. A bar graph of buses would also have fitted
  the sentence.
- **`@art` "on its own line" versus "has to come first".** The prose says the tag opens the
  header; `gallery.mjs` accepts `@art` on any header line that starts with it. I put it on its own
  line after the title sentence. Those two sentences disagree.
- **Cost on a headless capture.** "60 fps on a mid laptop, worst frame in ten seconds." The
  harness opens a fresh Chrome at ~17 ms cadence and reports 24 ms worst. Is that the gate, or is
  the gate a laptop with the tab in front? The spec does not say how a looking script scores the
  cost row.
- **Seed default.** "Every exhibit takes its seed from the URL." Not what the default is when the
  URL is empty. I used `overtone`.
- **The silent-opening sentence.** *"Must say so legibly"* — no words given. I used "Tap a pipe —
  nothing sounds until you do", after Resonance's phrasing, and avoided opacity because the
  harness has already caught that once.
- **Landing page / `?cost=0`.** The embedder contract is specified; there is no landing page here.
  I shipped `costNode` and `boot.showCost` anyway.
- **`knobs.ts` still claims `setMaxVoices` does not exist.** The copied panel file says the ceiling
  has no setter and must rebuild the engine. The package has `setMaxVoices`. I used the setter.
  **The gallery instrument is stale relative to the kit it documents.**
- **Look viewport.** § Scale is judged at 1440×900. The harness's `--size 1440x900` produced
  1440×813. The spec names a viewport the script does not actually paint.

## The numbers it reported

| | |
|---|---|
| logic / art | **130 logic** (`board.ts` 16, `hud.ts` 32, `main.ts` 82), 264 art plus the `<style>` block |
| density | 2,078 solids in the opening sort |
| worst gap / 10 s | 24.1 ms against a 17.4 ms cadence — 1.38× |
| harness | all five rows pass: 1,078 colors, 10% modal frame, 3.18% motion, 8 readable nodes, clean console |

## What changed when it moved into the repository

**One thing, and it is the finding the fan-out was built to produce.** The vendored `_shared/`
beside `src/` is gone and the imports resolve to the real `examples/_shared`. Seven of its eight
files were **byte-identical** to the originals; the eighth, `knobs.ts`, was 91 lines shorter — an
older snapshot missing the three `@latticekit/sim` offline-curve controls. Nothing was forked, and
nothing the copy did the real one cannot. The agent's last finding above is a consequence: the
`voiceCeiling` doc it read was the version written before `setMaxVoices` landed, and the real file
has said otherwise for some time.

The `file:` dependencies pointing at absolute paths on the build machine are gone too — the
workspace resolves `@latticekit/*` through its symlinks to each package's `dist`, which is what a
visitor who installed the kit gets.

`terrain: 'flat'` was already declared, and it is the right declaration: the floor of the hall
really is a plane. `MAX_HEIGHT_PX` here is how tall a *pipe* is, which is what `renderFrame`'s
terrain cull and the camera's bounds need, and not a height field — there is none.
