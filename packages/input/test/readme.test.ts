/**
 * The README's example, run.
 *
 * `README.md` opens with this program and prints these lines, and the two are kept honest by
 * this file rather than by anyone remembering. A README example that has drifted is worse than
 * none: it is the first thing a new caller copies, and the failure it produces is in *their*
 * code, where they will look for it.
 */

import { describe, expect, it } from 'vitest';
import { createCamera } from '@lattice/iso';
import { createHeadlessInput } from '../src/system.js';
import { createLog, record, replay } from '../src/record.js';
import { fixedStep } from '../src/step.js';

describe('the README example', () => {
  it('prints what the README says it prints', () => {
    const out: string[] = [];

    // ── a camera, and the input system over it ────────────────────────────────
    const camera = createCamera(800, 600); //         CSS pixels, centered on (0,0)
    const input = createHeadlessInput({
      camera,
      step: fixedStep(60), //                          or `step: loop` in a game
      actions: { collect: ['tap', 'key:Space'] }, //   two sources, one handler
      focus: (at) => {
        at.x = 400; //                     where the keyboard aims: the selection,
        at.y = 300; //                         or the viewport center if there is none
        return true;
      },
    });

    const collected: string[] = [];
    input.onAction('collect', (a) => {
      collected.push(`${a.source} via ${a.binding} at ${String(a.gx)},${String(a.gy)}`);
    });

    const tape = record(input); //                    everything from here is replayable

    // ── a tap: press in one tick, release in the next ─────────────────────────
    input.submit({ kind: 'down', id: 1, sx: 520, sy: 330, pointerType: 'touch' });
    input.tick(0);
    input.submit({ kind: 'up', id: 1, sx: 520, sy: 330 });
    input.tick(1);

    // ── a drag: past the finger's 9 px of slop, so it pans instead ────────────
    input.submit({ kind: 'down', id: 1, sx: 400, sy: 300, pointerType: 'touch' });
    input.tick(2);
    input.submit({ kind: 'move', id: 1, sx: 340, sy: 300 }); //  crosses the slop: dragstart
    input.tick(3);
    input.submit({ kind: 'move', id: 1, sx: 280, sy: 300 }); //  60 px of pan
    input.tick(4);
    input.submit({ kind: 'up', id: 1, sx: 220, sy: 300 }); //    released while moving: a fling
    input.tick(5);

    // ── the keyboard, which reaches the same handler ──────────────────────────
    input.submit({ kind: 'key', code: 'Space', down: true });
    input.tick(6);

    const log = tape.stop();

    out.push(collected.join('\n'));
    out.push(`camera x after the drag: ${String(camera.x)}`);
    out.push(`gliding: ${String(input.camera.gliding)}`);
    out.push(`log: ${String(log.samples.length)} samples, stepMs ${log.stepMs.toFixed(3)}`);

    // ── the replay ────────────────────────────────────────────────────────────
    const again = createHeadlessInput({
      camera: createCamera(800, 600),
      step: fixedStep(60),
      actions: { collect: ['tap', 'key:Space'] },
      focus: (at) => {
        at.x = 400;
        at.y = 300;
        return true;
      },
    });
    const replayed: string[] = [];
    again.onAction('collect', (a) => {
      replayed.push(`${a.source} via ${a.binding} at ${String(a.gx)},${String(a.gy)}`);
    });
    replay(again, log);
    out.push(`replayed identically: ${String(replayed.join('|') === collected.join('|'))}`);

    // ── and what `persist` compares before it agrees to replay anything ───────
    const compat = createLog(again);
    out.push(`compat: v${String(compat.version)} ${compat.profile.slice(0, 26)}…`);

    expect(out).toEqual([
      'pointer via tap at 2,-1\nkey via key:Space at 0,-1',
      'camera x after the drag: 60',
      'gliding: true',
      'log: 14 samples, stepMs 16.667',
      'replayed identically: true',
      'compat: v1 tap:4,9,6|longPressMs:450|…',
    ]);
  });
});
