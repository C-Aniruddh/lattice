/**
 * The mixer: three buses, one master, and a snapshot the game hands to `@lattice/persist`.
 *
 * ## Why gain and mute are two values and not one
 *
 * A mute implemented as "set the gain to 0" is the bug where turning the music back on
 * returns it at full volume, because the level the player chose was overwritten by the act of
 * silencing it. Here every bus carries an independent gain **and** an independent mute flag,
 * and the value sent to the device is their product. `setMuted('music', false)` therefore
 * restores the exact level that was there before, with no bookkeeping anywhere else.
 *
 * ## Why this module stores nothing
 *
 * `snapshot()` returns a small plain value and `restore()` takes one back; the game hands
 * that value to `@lattice/persist`. Three reasons, in order of weight. **Layering**: `audio`
 * and `persist` are both layer 1, so an edge between them is a design error rather than a
 * convenience. **A device preference is not save state**: a player who hits START OVER must
 * not get their sound turned back on, and a mute must not ride along in an export — that is a
 * device-scoped store, which belongs to `persist`. **Testability**: a mixer that writes to
 * storage cannot be tested without a storage shim.
 *
 * Tier A, no clock, no platform. The device is reached only through the `apply` callback.
 */

import { clamp } from '@lattice/core';

import { BUS_NAMES, RAMP_SEC, type BusName } from './sounds.js';

/**
 * The mixer as a value, versioned because it goes in a save and a save that cannot say what
 * it is cannot be migrated.
 *
 * Both maps are complete — every bus, every time — so a reader never has to guess whether a
 * missing key means "default" or "the writer had a different bus list".
 */
export interface MixerState {
  readonly version: 1;
  readonly gain: Readonly<Record<BusName, number>>;
  readonly muted: Readonly<Record<BusName, boolean>>;
}

/**
 * The three buses and master. Gain and mute are separate on purpose — see the module header.
 *
 * The reason the bus list is closed rather than a registry: a player who wants the music off
 * and the alerts on needs the same three switches in every Lattice game, and an open registry
 * gives every game a different settings panel.
 */
export interface Mixer {
  /** The player's chosen level, 0–1. Unaffected by muting — that is the whole point. */
  gain(bus: BusName): number;
  /**
   * Set a level, 0–1, clamped. A non-finite value is ignored rather than stored: `NaN` written
   * to an `AudioParam` poisons it for the life of the node, and a bus node lives as long as
   * the context does, so one bad slider frame would silence that bus for the session.
   *
   * Ramped over {@link RAMP_SEC} rather than assigned: a step change on a running oscillator
   * is an audible click, and dragging a slider would produce one per pixel of travel.
   */
  setGain(bus: BusName, gain: number): void;
  muted(bus: BusName): boolean;
  /**
   * Independent of gain. Muting master silences everything and preserves every bus's level,
   * so a settings panel can offer one switch and four sliders without them fighting.
   */
  setMuted(bus: BusName, muted: boolean): void;
  /**
   * The whole mixer as a value to hand to `@lattice/persist`.
   *
   * Not an output parameter and not on any hot path: this is called when a settings panel
   * closes, not per frame.
   */
  snapshot(): MixerState;
  /**
   * Apply a snapshot.
   *
   * Unknown, missing and out-of-range fields are clamped or ignored rather than thrown. A save
   * written by an older build — or a truncated one, or `{}` — must not be able to silence a
   * game permanently or stop it booting. The rule is: a value that parses as a number is
   * clamped into range; anything else leaves that bus exactly as it was.
   */
  restore(state: Readonly<MixerState>): void;
}

/**
 * What the device is actually set to for a bus: the player's level, or zero when muted.
 *
 * Exported because it is the one piece of arithmetic a caller has to repeat otherwise — a HUD
 * meter, or a test asserting that master 0.5 under music 0.5 renders a plan's gain at a
 * quarter. The plan itself carries the gain *before* bus and master, so the multiplication
 * belongs to whoever is asking.
 */
export function effectiveGain(mixer: Mixer, bus: BusName): number {
  return mixer.muted(bus) ? 0 : mixer.gain(bus);
}

/**
 * Build a mixer.
 *
 * @param apply called with the *effective* value whenever a bus changes — the seam to the
 *   device. It is invoked even when there is no device, in which case the engine's
 *   implementation does nothing; policy runs the same either way. `rampSec` is the time
 *   constant to approach the value over, never a step.
 */
export function createMixer(
  apply: (bus: BusName, effective: number, rampSec: number) => void,
): Mixer {
  // Defaults: everything audible, and music *unmuted* with no deck running. A saved mixer
  // that mutes music, restored by a game that then calls deck.play(), is a support ticket
  // nobody can diagnose — so "not playing" is the deck's business and "muted" is the
  // player's, and they are never confused for each other.
  const gains = new Map<BusName, number>([
    ['master', 0.7],
    ['music', 0.6],
    ['sfx', 1],
    ['ui', 1],
  ]);
  const mutes = new Map<BusName, boolean>(BUS_NAMES.map((bus) => [bus, false]));

  const mixer: Mixer = {
    gain(bus: BusName): number {
      return gains.get(bus) ?? 0;
    },

    setGain(bus: BusName, gain: number): void {
      if (!Number.isFinite(gain)) return;
      if (!gains.has(bus)) return;
      gains.set(bus, clamp(gain, 0, 1));
      apply(bus, effectiveGain(mixer, bus), RAMP_SEC);
    },

    muted(bus: BusName): boolean {
      return mutes.get(bus) ?? false;
    },

    setMuted(bus: BusName, muted: boolean): void {
      if (!mutes.has(bus)) return;
      mutes.set(bus, muted === true);
      apply(bus, effectiveGain(mixer, bus), RAMP_SEC);
    },

    snapshot(): MixerState {
      const gain: Record<BusName, number> = { master: 0, music: 0, sfx: 0, ui: 0 };
      const muted: Record<BusName, boolean> = { master: false, music: false, sfx: false, ui: false };
      for (const bus of BUS_NAMES) {
        gain[bus] = mixer.gain(bus);
        muted[bus] = mixer.muted(bus);
      }
      return { version: 1, gain, muted };
    },

    restore(state: Readonly<MixerState>): void {
      // Typed as a MixerState and treated as if it came off a disk written by a build that no
      // longer exists, because that is exactly where it comes from.
      const loose = state as { readonly gain?: unknown; readonly muted?: unknown } | null | undefined;
      const savedGain = asRecord(loose?.gain);
      const savedMuted = asRecord(loose?.muted);
      for (const bus of BUS_NAMES) {
        const gain = savedGain?.[bus];
        if (typeof gain === 'number' && Number.isFinite(gain)) {
          gains.set(bus, clamp(gain, 0, 1));
        }
        const muted = savedMuted?.[bus];
        if (typeof muted === 'boolean') mutes.set(bus, muted);
        apply(bus, effectiveGain(mixer, bus), RAMP_SEC);
      }
    },
  };

  return mixer;
}

/** A value from a save, if it is shaped like a map at all. Arrays included — they index fine. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
