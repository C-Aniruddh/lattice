/**
 * `time` — most of this file is a type-level test, because most of this module is a type.
 *
 * The runtime half is two finite checks. The half that matters is the `@ts-expect-error`
 * assertions: `EpochMillis` and `MonotonicMillis` are both `number` at runtime, so a suite
 * that only runs cannot see the confusion this module exists to prevent. Those lines are
 * checked by `tsc -p tsconfig.check.json`, and if a brand is ever weakened they stop erroring,
 * the directive becomes unused, and the type-check fails.
 *
 * The substitution being defended against, concretely: `loop`'s clock runs at quarter speed in
 * a hidden tab and its origin is the document. Passing one where a calendar instant is
 * expected stamps a save with a number that means "a few seconds since the page loaded", so
 * offline accrual credits nothing and the report reads "offline progress is broken" rather
 * than "wrong clock".
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  asEpochMillis,
  asMonotonicMillis,
  type EpochMillis,
  type MonotonicMillis,
  type MonotonicNow,
  type Now,
} from '../src/time.js';

describe('asEpochMillis', () => {
  it('returns the value it was given, unchanged', () => {
    expect(asEpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(asEpochMillis(0)).toBe(0);
    expect(asEpochMillis(-1)).toBe(-1);
    expect(asEpochMillis(1.5)).toBe(1.5);
  });

  it('accepts 0 and 1000 — every manual clock in every test starts there', () => {
    // This is why there is no "that looks like seconds, not milliseconds" range check: it
    // would reject exactly the values a fake clock uses.
    expect(asEpochMillis(0)).toBe(0);
    expect(asEpochMillis(1000)).toBe(1000);
  });

  it('accepts a pre-epoch instant, because a negative calendar time is a real date', () => {
    expect(asEpochMillis(-86_400_000)).toBe(-86_400_000);
  });

  it('rejects the three values that are not a time', () => {
    expect(() => asEpochMillis(NaN)).toThrow(RangeError);
    expect(() => asEpochMillis(Infinity)).toThrow(RangeError);
    expect(() => asEpochMillis(-Infinity)).toThrow(RangeError);
  });

  it('names the caller and the value in the message, per non-negotiable #9', () => {
    // A message that only makes sense with the source open beside it is not an error message.
    expect(() => asEpochMillis(NaN, 'save.stampedAt')).toThrow(/save\.stampedAt/);
    expect(() => asEpochMillis(NaN, 'save.stampedAt')).toThrow(/NaN/);
    expect(() => asEpochMillis(Infinity, 'save.stampedAt')).toThrow(/Infinity/);
  });

  it('falls back to naming the unit, which is the thing that goes wrong', () => {
    expect(() => asEpochMillis(NaN)).toThrow(/epochMillis/);
  });

  it('is the load-boundary check that a cast is not', () => {
    // Trap 31: a save hand-edited to `"lastSeen": null` becomes an EpochMillis of null under a
    // cast, and every later subtraction is NaN with no exception anywhere near the cause.
    // `null` is not a number at all, so this is the wrong *kind* of value: a TypeError.
    const fromStorage = JSON.parse('{"lastSeen": null}') as { lastSeen: number };
    expect(() => asEpochMillis(fromStorage.lastSeen, 'save.lastSeen')).toThrow(TypeError);
    expect(() => asEpochMillis(fromStorage.lastSeen, 'save.lastSeen')).toThrow(/save\.lastSeen/);
  });

  it('splits the two error kinds the way the rest of the kit does', () => {
    // Wrong kind of thing is a TypeError; wrong value of the right kind is a RangeError. The
    // check is `guard`'s `expectFinite`, so this module cannot drift from that split.
    const notANumber = '1700000000000' as unknown as number;
    expect(() => asEpochMillis(notANumber, 'save.stampedAt')).toThrow(TypeError);
    expect(() => asEpochMillis(NaN, 'save.stampedAt')).toThrow(RangeError);
    expect(() => asEpochMillis(NaN, 'save.stampedAt')).not.toThrow(TypeError);
  });
});

describe('asMonotonicMillis', () => {
  it('returns the value it was given', () => {
    expect(asMonotonicMillis(0)).toBe(0);
    expect(asMonotonicMillis(12_345.678)).toBe(12_345.678);
  });

  it('rejects the non-finite values with a message naming the caller', () => {
    expect(() => asMonotonicMillis(NaN)).toThrow(RangeError);
    expect(() => asMonotonicMillis(Infinity)).toThrow(RangeError);
    expect(() => asMonotonicMillis(-Infinity, 'clock.now')).toThrow(/clock\.now/);
    expect(() => asMonotonicMillis(NaN, 'clock.now')).toThrow(/NaN/);
  });

  it('names its own unit by default, so the two errors are distinguishable', () => {
    // The unit lives in the name — in the type, and here in the label. Two messages that read
    // identically would leave a reader unable to tell which clock was handed the bad value.
    expect(() => asMonotonicMillis(NaN)).toThrow(/monotonicMillis/);
    expect(() => asEpochMillis(NaN)).toThrow(/epochMillis/);
    expect(() => asEpochMillis(NaN)).not.toThrow(/monotonicMillis/);
  });
});

describe('the brands', () => {
  it('a bare number is not a calendar instant', () => {
    // @ts-expect-error a plain number must not be assignable to EpochMillis — the brand is
    // the whole product of this module.
    const t: EpochMillis = 5;
    expect(t).toBe(5);
  });

  it('a bare number is not a monotonic reading either', () => {
    // @ts-expect-error the brand runs both ways.
    const t: MonotonicMillis = 5;
    expect(t).toBe(5);
  });

  it('a monotonic reading cannot be stamped into a save slot', () => {
    // Trap 28, as a compile error. This is the most damaging substitution available in the
    // kit and the one direction that must never compile.
    const reading = asMonotonicMillis(1234);
    // @ts-expect-error MonotonicMillis is not EpochMillis
    const stamped: EpochMillis = reading;
    expect(stamped).toBe(1234);
  });

  it('a calendar instant cannot be used as a stopwatch reading', () => {
    const instant = asEpochMillis(1_700_000_000_000);
    // @ts-expect-error EpochMillis is not MonotonicMillis
    const elapsed: MonotonicMillis = instant;
    expect(elapsed).toBe(1_700_000_000_000);
  });

  it('the two injected clocks cannot be swapped at an injection site', () => {
    const wallClock: Now = () => asEpochMillis(1_700_000_000_000);
    const stopwatch: MonotonicNow = () => asMonotonicMillis(16);
    // @ts-expect-error a stopwatch is not a calendar
    const wrongCalendar: Now = stopwatch;
    // @ts-expect-error a calendar is not a stopwatch
    const wrongStopwatch: MonotonicNow = wallClock;
    expect(wrongCalendar()).toBe(16);
    expect(wrongStopwatch()).toBe(1_700_000_000_000);
  });

  it('the brands survive being handed to a function that wants one', () => {
    const stampedAt = (now: Now): EpochMillis => now();
    expect(stampedAt(() => asEpochMillis(42))).toBe(42);
  });

  it('arithmetic widens to number, because a difference is a duration and not an instant', () => {
    const a = asEpochMillis(2000);
    const b = asEpochMillis(1000);
    const elapsedMillis: number = a - b;
    expect(elapsedMillis).toBe(1000);
    // @ts-expect-error the difference of two instants is a duration; re-brand deliberately
    const wrong: EpochMillis = a - b;
    expect(wrong).toBe(1000);
    // The deliberate form: an offset is re-branded at the point it becomes an instant again.
    const later: EpochMillis = asEpochMillis(a + 1000);
    expect(later).toBe(3000);
  });

  it('an epoch tolerates going backwards, which a wall clock really does', () => {
    // An NTP correction, a timezone change, or a player skipping a build timer. Anything that
    // subtracts two of these must tolerate a negative result.
    const before = asEpochMillis(1_700_000_010_000);
    const after = asEpochMillis(1_700_000_000_000);
    expect(after - before).toBe(-10_000);
  });

  it('is erased at runtime — which is why the validator, not a cast, is the boundary', () => {
    const instant = asEpochMillis(5);
    expect(typeof instant).toBe('number');
    expect(JSON.parse(JSON.stringify({ t: instant })).t).toBe(5);
  });
});

describe('the module charter', () => {
  it('reads no clock — core owns the word, not the reading', () => {
    // Non-negotiable #1: `lint` bans these in every src/, and this is the same rule stated
    // where the temptation actually is. There is deliberately no default `Now` in the kit.
    const source = readFileSync(
      fileURLToPath(new URL('../src/time.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(/Date\.now|performance\.now|new Date/.test(code)).toBe(false);
  });

  it('does not export Millis or Seconds — loop owns those names', () => {
    // A second identical alias in core would be exactly the drift this module exists to
    // prevent, with core as the culprit.
    const source = readFileSync(
      fileURLToPath(new URL('../src/time.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(/export\s+type\s+(Millis|Seconds)\b/.test(code)).toBe(false);
  });
});
