# The landing page

**Nothing on this page is a picture of Lattice. Everything on it is Lattice, running.**

The hero is `examples/demo` in an iframe, playable. The ten gallery tiles are the ten exhibits,
live, at their own viewports, scaled into a grid. The backdrop is drawn with `@latticekit/draw`, the
page's color scheme is `lerpPalette(DUSK, NIGHT, scrollProgress)`, and the frame-time readout in
the header is `@latticekit/loop` measuring the page it is printed on.

This directory is **not part of the kit**, is **not a workspace member**, and nothing in it may be
imported by a package or by an exhibit. It reads `packages/*/dist` and `examples/*` and writes only
to `site/`.

---

## Build and look at it

```bash
npm run build                                  # at the repo root, first — the page bundles dist/
node site/tools/build.mjs                      # typecheck, generate, bundle page, bundle exhibits
npx vite preview --config site/vite.config.ts  # http://localhost:5171
```

`node site/tools/build.mjs crowd clay` rebuilds only those exhibits and skips clearing `dist/`.

There is also `npx vite --config site/vite.config.ts` for editing the page itself, but the gallery
is served from `dist/x/` and only exists after a build, so the tiles are empty in dev.

## What is generated and what is written by hand

| | |
|---|---|
| `index.html`, `public/llms.txt`, `public/api.json`, `public/kit.json` | **generated** by `tools/build-page.mjs`. Do not edit; your change is gone on the next build |
| `src/page.css`, `src/page.ts` | the design and the behavior |
| `data/measured.json` | every number the page prints, each with the command that produced it |
| `data/exhibits.json` | the gallery, as data. Adding an exhibit is one row here and nothing else |
| `example/hello.ts` | the worked example the page prints, typechecked on every build |

**The API reference is generated from `.lattice/kit.json`**, which `npm run lint` fails the
repository's build over if a package exports a symbol it does not list. That is the whole reason
it is generated rather than written: a reference typed out beside the thing it describes drifts
from it inside a week, and this one cannot.

**Nothing on the page may state a number that is not in `data/measured.json` or read live off the
running kit.** If you want a figure that does not exist, measure it and add it with its command.

## The rules this page is built against

- **Fast on a phone.** At most two exhibit loops run at once, one below 900 px of viewport, and at
  most three exhibit documents exist at all. A tile off screen is `loop.stop()`ed, not throttled.
- **Honest without JavaScript.** An inline script stamps `.js` on `<html>`; everything that would
  be a live scene, a live number or an instruction to touch one is hidden by `html:not(.js)`. What
  remains is the writing, the figures and the complete reference. There is no fallback image,
  because there is nothing to make a fallback of.
- **Reduced motion and `saveData` are obeyed.** Neither the hero nor any tile animates on its own;
  each is built, painted once, and waits to be asked.
- **The numbers say `hidden` in a background tab**, because a frame time of 0.0 ms means
  `requestAnimationFrame` stopped, not that anything got faster. The worst figure is `worstGapMs`
  and never `worstFrameMs`.
- **The exhibits are untouched.** The page reads them, scales them and stops their loops through
  the `__latticeBoot` handle that `examples/_shared/src/bootstrap.ts` already parks on its mount
  element. No file under `examples/` or `packages/` is modified, and no exhibit knows this page
  exists.

## For an agent arriving here

- `/llms.txt` — the whole kit as plain text: the eleven rules, every package with its entry
  points and invariants, every exhibit with its source path and one measured number, the traps
  that cost this project real time, and a program that compiles.
- `/api.json` — the same as JSON, plus the measured figures and the command behind each.
- `/kit.json` — the repository's own manifest, verbatim.
