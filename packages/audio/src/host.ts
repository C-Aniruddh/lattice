/**
 * `@browser-only` — the whole of this package's contact with a host. Two functions.
 *
 * This is the only module in `@lattice/audio` that reads a global, and it is deliberately the
 * only one: everything else takes a context and a clock as parameters, which is why the rest
 * of the package imports cleanly into a Node test and why the declared-adapter count printed
 * by `npm run lint` stays at one. That count going up is the earliest sign the kit is drifting
 * out of Node, so the value of this file is as much in what it keeps out of the others as in
 * what it does.
 *
 * Both functions are replaceable from outside — `AudioOptions.context` overrides the first,
 * `createDeck({ autoPump: false })` opts out of the second — so no test ever has to reach a
 * real global to cover a policy branch.
 */

import type { Disposer } from '@lattice/core';

/** The two names a browser has ever given the constructor, and nothing else. */
interface AudioGlobals {
  readonly AudioContext?: new () => AudioContext;
  /** Safari before 14.1. Still shipping on devices people play games on. */
  readonly webkitAudioContext?: new () => AudioContext;
}

/**
 * Construct an `AudioContext`, or return `null` — never throw.
 *
 * Three ways to get `null`, all of them ordinary rather than exceptional: there is no such
 * global (Node, a worker, a server render), the constructor is absent under both names, or
 * the constructor throws because the browser is locked down or has run out of contexts. A
 * boot path that can throw because of a *sound* is the worst trade in the kit, so all three
 * land on the same silent outcome and `Audio.available` reports it truthfully.
 *
 * **This is called from `unlock()` and from nowhere else.** Not at module load and not at
 * construction: a context created at boot is a console warning on every refresh, a suspended
 * object in every unit test, and a browser autoplay policy violation on top.
 */
export function defaultContext(): AudioContext | null {
  const globals = globalThis as AudioGlobals;
  const constructor = globals.AudioContext ?? globals.webkitAudioContext;
  if (constructor === undefined) return null;
  try {
    return new constructor();
  } catch {
    return null;
  }
}

/**
 * Call `callback` every `ms` until the returned disposer runs.
 *
 * The deck's pump, and the one timer in the package. It decides only *when to schedule* —
 * every note is pinned to the audio clock — because `setInterval` drifts by tens of
 * milliseconds under load and a drifting sequencer sounds drunk. A background tab throttles
 * it to a second or more, which is exactly why the deck's horizon is measured in seconds and
 * not in frames.
 *
 * Never drive a pump from `requestAnimationFrame` instead: rAF is 0 Hz in a hidden tab, so
 * the music would stop the moment the player changed tabs and resume when they came back.
 */
export function everyInterval(callback: () => void, ms: number): Disposer {
  const handle = setInterval(callback, ms);
  let cleared = false;
  return (): void => {
    if (cleared) return;
    cleared = true;
    clearInterval(handle);
  };
}
