/**
 * The whole of a Lattice program, and the one that appears on the landing page.
 *
 * It is a real file rather than a snippet: `site/tools/build.mjs` typechecks it against the built
 * packages before the page is generated, so a signature that changes in the kit breaks the
 * page's build instead of quietly making its example a lie.
 *
 * Keep it inside one screen. `docs/GALLERY.md` asks for an example "sized so the whole thing fits
 * on screen at once", and a listing a reader has to scroll is a listing they skim.
 */
import { createRng, noise2 } from '@lattice/core';
import { DepthSorter, createCamera } from '@lattice/iso';
import { BASE_SLOTS, beginFrame, createCanvas2dSurface, createPalette, endFrame,
  isoBox, isoTile, renderFrame, type Passes } from '@lattice/draw';
import { browserFrames, createLoop } from '@lattice/loop';
import { createInput } from '@lattice/input';

const canvas = document.body.appendChild(document.createElement('canvas'));
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';

const surface = createCanvas2dSurface(canvas);
const camera = createCamera(innerWidth, innerHeight, { zoom: 1.4 });
const palette = createPalette(BASE_SLOTS);
const order = new DepthSorter(256);
const loop = createLoop({ clock: { now: () => performance.now() }, frames: browserFrames() });

// Drag pans, wheel zooms to the pointer, pinch works. Input never learns what is in the world.
createInput({ element: canvas, camera, step: loop });

const rng = createRng('hello-lattice');      // same seed, same town, on every machine
const N = 28;
const ground = (gx: number, gy: number) => Math.round(noise2(1, gx * .11, gy * .11) * 2) * 8;
const town = Array.from({ length: 60 }, () => ({ gx: rng.int(0, N), gy: rng.int(0, N), h: rng.int(2, 7) }));

const passes: Passes = {
  maxHeightPx: 112,
  terrain: (pen, seen) => {
    for (let gy = seen.gy0; gy < seen.gy1; gy++)
      for (let gx = seen.gx0; gx < seen.gx1; gx++) isoTile(pen, gx, gy, 'ground', 'ink', 0, ground(gx, gy));
  },
  solids: (pen, sorted) => {
    for (let i = 0; i < sorted.count; i++) {          // back to front, culled, never allocated
      const it = town[sorted.indexAt(i)];
      if (it) isoBox(pen, it.gx, it.gy, 1, 1, { color: 'metal', h: it.h, z: ground(it.gx, it.gy) });
    }
  },
};

loop.onRender((_alpha, t) => {
  order.clear();
  for (const it of town) order.add(it.gx, it.gy, 1, 1, it.h * 16);
  const pen = beginFrame({ surface, camera, palette, t, clear: 'sky' });
  renderFrame(pen, passes, order);
  endFrame(pen);
});

camera.centerOnTile(N / 2, N / 2);
loop.start();
