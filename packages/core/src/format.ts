/**
 * Numbers a player can read at a glance, with no `Intl`.
 *
 * Taken from a shipped game and sharpened. Three properties are load-bearing
 * and each one is a bug that shipped before it was a rule:
 *
 * - **Bounded width.** `fmtCompact` is never wider than six characters, ever, for any finite
 *   double. A resource pill that reflows as the number grows makes a HUD feel unstable, and
 *   the reflow lands exactly when the player is watching the number.
 * - **Never `NaN` on screen.** A non-finite input formats as an em dash. A player reads `NaN`
 *   as a broken game; they read `—` as "not yet".
 * - **Locale-free by construction.** ASCII digits, an ASCII comma, no `Intl`. `Intl.NumberFormat`
 *   formats differently across engines and ICU versions — which makes a screenshot test and a
 *   save file both platform-dependent — and constructing one inside a frame is one of the
 *   slowest things you can do. A game that wants French grouping formats in its own layer.
 *
 * This module is deliberately free-standing: it imports nothing, not even from the rest of
 * core. Its place in layer 0 rests on `draw` alone (canvas text; `ui` chose to format in the
 * game layer), so if that second consumer never materialises this module moves out — and the
 * move stays cheap only for as long as nothing here has grown a dependency.
 *
 * Tier A: `+ - * /`, `Math.abs/floor/round`, and the exactly-specified `toFixed` and
 * `toExponential`. No transcendentals.
 */

/** What a non-finite number formats to. An em dash reads as "not yet"; `NaN` reads as broken. */
const DASH = '—';

/** The compact width budget, sign included. `fmtInteger` is deliberately outside it — a
 *  grouped number belongs in a tooltip, where width is free, and never in a HUD pill. */
const MAX_WIDTH = 6;

/** The `decimals` arguments are bounded here so that a bad one names itself rather than
 *  arriving as `toFixed`'s own message, which mentions neither the caller nor the value. */
const MAX_DECIMALS = 6;

/**
 * The magnitude ladder: `['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc']`.
 *
 * Exported so a game can render its own ladder in the same tiers, and so a test can assert the
 * boundary behavior at every tier without duplicating the table. Frozen, because a consumer
 * that mutated it would change every number in the game from one line in one file.
 *
 * The ladder tops out at `Oc` = 10^27. Past that `fmtCompact` switches to exponential form
 * rather than inventing suffixes nobody can rank — an idle economy really does reach 1e40, and
 * `'Qig'` communicates nothing while `'1e40'` communicates everything.
 */
export const COMPACT_SUFFIXES: readonly string[] = Object.freeze([
  '',
  'K',
  'M',
  'B',
  'T',
  'Qa',
  'Qi',
  'Sx',
  'Sp',
  'Oc',
]);

/** 1000 ** COMPACT_SUFFIXES.length — the first magnitude the ladder cannot name. */
const LADDER_LIMIT = 1e30;

/** Bound a `decimals` argument, naming the caller per the constitution's rule 9. */
function expectDecimals(decimals: number, label: string): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(
      `${label}: expected decimals to be an integer in [0, ${String(MAX_DECIMALS)}], got ${String(decimals)}`,
    );
  }
  return decimals;
}

/**
 * A value truncated — never rounded — to `decimals` places.
 *
 * Truncation is the whole of trap 20. `999.95` rounded to one decimal is `'1000.0'`, which is
 * a mantissa that has left its own tier: seven characters wide and claiming a magnitude the
 * suffix contradicts. Truncating gives `'999.9'`, which is also the honest answer for a stock
 * — a player who is shown `1.0M` and can afford nothing at 1M files a bug, correctly.
 *
 * Done by correcting `toFixed` rather than by scaling with a multiply, because `value * 10`
 * is not exact for every double and a floor over an inexact product loses a whole digit.
 */
function truncate(value: number, decimals: number): string {
  const rounded = value.toFixed(decimals);
  if (Number(rounded) <= value) return rounded;
  const step = Number(`1e-${String(decimals)}`);
  return (Number(rounded) - step).toFixed(decimals);
}

/**
 * Exponential fallback for magnitudes past the ladder, trimmed to fit the width budget.
 *
 * `toExponential` is used rather than a `Math.log10`: the spec defines it exactly, and core
 * may not reach for a transcendental in a Tier A module even for presentation.
 */
function exponential(value: number, budget: number): string {
  const withDecimal = value.toExponential(1).replace('e+', 'e');
  return withDecimal.length <= budget ? withDecimal : value.toExponential(0).replace('e+', 'e');
}

/**
 * Compact magnitude: `12500` → `'12.5K'`.
 *
 * An idle game lives on this function — a player reads a magnitude in a glance with their
 * thumb already moving. **Output is never wider than six characters**, sign included, for
 * every finite double up to `1e308`, so a resource pill never reflows and a wallet that
 * changes width as you play never makes the HUD feel unstable.
 *
 * The width bound is what decides the decimals, not the other way round. `999_900` is
 * `'999.9K'` at six characters, `-999_900` is `'-999K'` at five: when the decimal will not
 * fit, it goes, because a truncated digit costs less than a moving layout. Below the first
 * suffix a whole number stays whole — `250` is `'250'`, never `'250.0'`.
 *
 * Values are **truncated**, never rounded up across a tier: `999_950` is `'999.9K'` and never
 * `'1000.0K'`. Non-finite input returns `'—'`; a HUD showing `NaN` reads as a broken game.
 *
 * @param decimals - digits of mantissa to attempt. Default 1. More than the width allows are
 * dropped rather than honoured.
 * @throws RangeError if `decimals` is not an integer in [0, 6].
 */
export function fmtCompact(value: number, decimals = 1): string {
  expectDecimals(decimals, 'fmtCompact');
  if (!Number.isFinite(value)) return DASH;
  const negative = value < 0;
  const sign = negative ? '-' : '';
  const magnitude = Math.abs(value);
  const budget = negative ? MAX_WIDTH - 1 : MAX_WIDTH;

  if (magnitude >= LADDER_LIMIT) return `${sign}${exponential(magnitude, budget)}`;

  // Walking the ladder rather than indexing it keeps `suffix` a definite string: the value is
  // below `LADDER_LIMIT`, so the loop always breaks before it runs out of suffixes.
  let scaled = magnitude;
  let suffix = '';
  for (const candidate of COMPACT_SUFFIXES) {
    suffix = candidate;
    if (scaled < 1000) break;
    scaled /= 1000;
  }
  const whole = `${sign}${String(Math.floor(scaled))}${suffix}`;
  // Below the first suffix the number is exact, so a decimal is noise on a whole quantity;
  // above it the mantissa is already an approximation and the decimal is the precision left.
  if (decimals === 0 || (suffix === '' && (scaled % 1 === 0 || scaled >= 10))) return whole;
  const detailed = `${sign}${truncate(scaled, decimals)}${suffix}`;
  return detailed.length <= MAX_WIDTH ? detailed : whole;
}

/**
 * Compact magnitude with an explicit sign on positives: `'+12.5K'`.
 *
 * For deltas, where the sign *is* the information — an offline-earnings summary, a trade
 * preview, a stat comparison. Zero is rendered without a sign: `'+0'` next to a stalled
 * production line reads as progress, which is the one thing it is not.
 */
export function fmtSigned(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  return value > 0 ? `+${fmtCompact(value)}` : fmtCompact(value);
}

/**
 * Grouped integer: `1234567` → `'1,234,567'`.
 *
 * Always an ASCII comma — a locale-aware separator would make a screenshot test engine-
 * dependent, and a save file that embedded one would be worse. Unlike `fmtCompact` this is
 * unbounded in width, so it belongs in a tooltip or a detail panel, not in a HUD pill.
 *
 * Rounds to the nearest integer, and falls back to compact form above 1e21, where a double
 * has no exact digit string to group and `String()` itself switches to exponential.
 */
export function fmtInteger(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1e21) return fmtCompact(rounded);
  const digits = String(Math.abs(rounded));
  const head = digits.length % 3 === 0 ? 3 : digits.length % 3;
  let grouped = digits.slice(0, head);
  for (let i = head; i < digits.length; i += 3) grouped += `,${digits.slice(i, i + 3)}`;
  return rounded < 0 ? `-${grouped}` : grouped;
}

/**
 * A per-second rate: `'1.2/s'`.
 *
 * Rates get an extra decimal below one, because early-game rates *are* below one and `'0/s'`
 * next to a visibly filling bar is the kind of thing players file bugs about. Below one
 * hundredth of a unit the readout becomes `'<0.01/s'` rather than rounding to zero — the same
 * complaint, one order of magnitude down, and the `<` is honest where `'0.00'` is not.
 *
 * @param suffix - default `'/s'`. Pass `'/min'`, `'/tick'` or `''` for anything measured on
 * another cadence; the number is formatted the same way regardless.
 */
export function fmtRate(perSecond: number, suffix = '/s'): string {
  if (!Number.isFinite(perSecond)) return DASH;
  const magnitude = Math.abs(perSecond);
  if (magnitude === 0) return `0${suffix}`;
  if (magnitude < 0.01) return `${perSecond < 0 ? '-' : ''}<0.01${suffix}`;
  if (magnitude < 1) return `${perSecond.toFixed(2)}${suffix}`;
  if (magnitude < 10) return `${perSecond.toFixed(1)}${suffix}`;
  return `${fmtCompact(perSecond)}${suffix}`;
}

/**
 * `0.075` → `'7.5%'`.
 *
 * Takes a **fraction, not a percentage**, so there is one convention in the kit and not two.
 * The bug this prevents is silent and permanent: a progress bar fed `0.5` where it wanted `50`
 * looks plausible at every value, and nobody notices until a designer asks why nothing ever
 * fills.
 *
 * Width is deliberately fixed by `decimals` rather than trimmed — a percentage that switches
 * between `'7.5%'` and `'8%'` as it changes makes a row of stats jitter.
 *
 * @throws RangeError if `decimals` is not an integer in [0, 6].
 */
export function fmtPercent(fraction: number, decimals = 1): string {
  expectDecimals(decimals, 'fmtPercent');
  if (!Number.isFinite(fraction)) return DASH;
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/**
 * How `fmtDuration` renders.
 *
 * `'short'` reads better in prose and in a tooltip; `'clock'` is width-stable for a countdown,
 * which matters because a timer that changes width every ten seconds drags the layout around
 * it once a second.
 */
export type DurationStyle = 'short' | 'clock';

/** Two-digit zero padding, for clock style. Hours above 99 widen rather than truncate. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `'2m 30s'` (short) or `'02:30'` (clock).
 *
 * Seconds in, always — never milliseconds. Negative input clamps to zero, because the only
 * things that produce a negative duration are a clock correction and a subtraction in the
 * wrong order, and `'-3s remaining'` on a build timer is worse than `'0s'`.
 *
 * Rounds before splitting, not after: rounding each component separately is how `59.6` becomes
 * `'0m 60s'`. Short style carries at most two units, largest first, and drops a trailing zero
 * unit — `'2h'`, not `'2h 0m'`.
 *
 * @throws TypeError if `style` is not a `DurationStyle`. A typo'd style is otherwise a silent
 * fallback to the other format, which reads as a layout bug.
 */
export function fmtDuration(seconds: number, style: DurationStyle = 'short'): string {
  if (style !== 'short' && style !== 'clock') {
    throw new TypeError(`fmtDuration: expected style 'short' or 'clock', got ${String(style)}`);
  }
  if (!Number.isFinite(seconds)) return DASH;
  const total = Math.max(0, Math.round(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);

  if (style === 'clock') {
    return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  const days = Math.floor(total / 86400);
  if (days > 0) {
    const hoursOfDay = h % 24;
    return hoursOfDay > 0 ? `${String(days)}d ${String(hoursOfDay)}h` : `${String(days)}d`;
  }
  if (h > 0) return m > 0 ? `${String(h)}h ${String(m)}m` : `${String(h)}h`;
  if (m > 0) return `${String(m)}m ${String(s)}s`;
  return `${String(s)}s`;
}
