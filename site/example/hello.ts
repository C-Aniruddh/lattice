/**
 * The whole of a Lattice program, and the one the landing page prints and runs side by side.
 *
 * It is a real file rather than a snippet, and it is the same file in both places: `site/tools/
 * build.mjs` typechecks it against the built packages before the page is generated, and
 * `site/example/index.html` is a real page that boots it, which the Getting started section
 * mounts in an iframe. So the listing cannot become a lie in either direction — a signature that
 * moves in the kit breaks the build, and a program that no longer draws anything is visible on
 * the page beside its own source.
 *
 * **Ten code lines, and that is the specification rather than a coincidence.** The forty-line
 * version this replaces was a seeded town on rolling ground with a depth sorter, a `Passes`
 * object and pointer input, and it was read by somebody who does not write TypeScript as proof
 * that a Lattice program is long. What a stranger has to be able to see in four seconds is: a
 * surface, a camera, a palette, a loop, and a world drawn inside it. Everything past that is in
 * the gallery, standing over the thing it does.
 *
 * The one thing the listing leaves to its host is the canvas's size, because
 * `createCanvas2dSurface` reads `clientWidth`/`clientHeight` and a bare `<canvas>` is 300x150.
 * `index.html` beside this file gives it the viewport in two lines of CSS.
 */
import { createCamera } from '@latticekit/iso';
import { BASE_SLOTS, beginFrame, createCanvas2dSurface, createPalette, endFrame, isoBox } from '@latticekit/draw';
import { browserFrames, createLoop } from '@latticekit/loop';

const surface = createCanvas2dSurface(document.body.appendChild(document.createElement('canvas')));
const camera = createCamera(innerWidth, innerHeight, { zoom: 0.62 }), palette = createPalette(BASE_SLOTS);

createLoop({ clock: { now: () => performance.now() }, frames: browserFrames(), render: (_alpha, t) => {
  const pen = beginFrame({ surface, camera, palette, t, clear: 'sky' });   // erase, then paint the sky
  // Back to front is just the loop order in a 2:1 projection, so this city needs no depth sort.
  for (let gy = -7; gy < 7; gy++) for (let gx = -7; gx < 7; gx++) isoBox(pen, gx, gy, 1, 1, { color: 'metal', h: 2 + 5 * Math.sin(t + (gx + gy) * 0.4) ** 2 });
  endFrame(pen);
} }).start();
