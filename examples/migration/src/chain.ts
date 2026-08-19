/**
 * The five builds, the four rungs between them, and the archive they are asked to open.
 *
 * This is the exhibit. Everything else on screen is a way of looking at this file.
 *
 * ## The chain is the version, so the exhibit seals it five times
 *
 * `@latticekit/persist` reads the current version off `chain.head`; there is no `version: 5`
 * constant anywhere that could disagree with it. A gallery row about migration therefore cannot
 * be a row about a *number* — it has to be a row about the ladder. So this file declares the
 * rungs **once** and seals the builder at each one, which the package's own doc comment blesses:
 * *"the builder is immutable: `step` returns a new one, so a chain may be branched in a test."*
 *
 * The result is {@link BUILDS} — the shipped v1 build, the shipped v2 build, and so on to v5,
 * each a real `Store` over its own `memoryStorage()`. One archive of envelope bytes, opened five
 * times by five different builds, is the whole apparatus. A crate standing on terrace *k* has
 * been through `BUILDS[k].decode(text)` and is showing what that build made of those bytes.
 *
 * ## Where each rung came from, and why two of them are the seams
 *
 * | rung | the migration | the seam it is |
 * |---|---|---|
 * | 1 → 2 | one coin counter became a wallet of two currencies | the ordinary case, and the one every game has |
 * | 2 → 3 | the stored `#rrggbb` became the hue it was derived from | `SEAMS.md`: **persist the input, never the derived value**. v1 saved a presentation-tier token, so this rung has to *invert a lossy derivation* to get the durable number back — and 8-bit channels mean the hue it recovers is near the one the player picked and never the one they picked |
 * | 3 → 4 | `ticks` and `runs` collapsed into the best run they only ever computed | `SEAMS.md`: **`Infinity` is a perfectly Tier A result and does not survive JSON.** `ticks / runs` with `runs: 0` is a legal, bit-identical, cross-engine-reproducible `Infinity`, and `JSON.stringify` writes `null` for it with a valid checksum. `expectSerializable` in the v4 recognizer is what stands between that and a wallet coming back `NaN` two saves later |
 * | 4 → 5 | the wallet learned to hold a third currency | the ordinary case again, so the ladder does not end on a special case |
 *
 * The third rung is the one worth watching. It is the only failure in this exhibit that is
 * nobody's mistake: the arithmetic is right, the bytes are intact, the checksum matches, and the
 * save still cannot be carried forward — so it degrades, at a named rung, with a reason, which is
 * the behaviour `SEAMS.md` asks to be shown rather than hidden.
 *
 * ## Every field is read through one accessor, on purpose
 *
 * `f(value, key)` rather than five `as Partial<Vn>` casts. A recognizer receives `unknown` — that
 * is the whole point of it — and a cast that says otherwise is a claim about a file on somebody
 * else's disk. This way the only thing that ever asserts a type here is `num` and `str`, at the
 * moment they have checked it.
 */
import { asEpochMillis, expectSerializable, hash2, toUnit } from '@latticekit/core';
import { hueToHex } from '@latticekit/draw';
import { createStore, memoryStorage, migrations, type MigrationChain, type OpenResult, type Recognize, type Store } from '@latticekit/persist';

// ── the five shapes ──────────────────────────────────────────────────────────────────────────

interface Purse { readonly coin: number; readonly ore: number }
interface Vault extends Purse { readonly seal: number }
export interface V1 { readonly version: 1; readonly coins: number; readonly tint: string; readonly ticks: number; readonly runs: number }
export interface V2 { readonly version: 2; readonly wallet: Purse; readonly tint: string; readonly ticks: number; readonly runs: number }
export interface V3 { readonly version: 3; readonly wallet: Purse; readonly hue: number; readonly ticks: number; readonly runs: number }
export interface V4 { readonly version: 4; readonly wallet: Purse; readonly hue: number; readonly best: number }
export interface V5 { readonly version: 5; readonly wallet: Vault; readonly hue: number; readonly best: number }
/** What a crate is carrying, whichever terrace it is standing on. */
export type Save = V1 | V2 | V3 | V4 | V5;

// ── recognizers: typed or thrown, never a boolean ────────────────────────────────────────────

const f = (v: unknown, k: string): unknown => (v as Record<string, unknown> | null | undefined)?.[k];
/** A finite number, or a `RangeError` naming the field. `String(v)` rather than a bare
 *  interpolation, so `undefined` and `null` read as themselves on the placard. */
const num = (v: unknown, at: string): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${at}: expected a finite number, got ${String(v)}`); return v; };
const str = (v: unknown, at: string): string => { if (typeof v !== 'string' || v === '') throw new RangeError(`${at}: expected a non-empty string, got ${String(v)}`); return v; };
const purse = (v: unknown, at: string): Purse => ({ coin: num(f(v, 'coin'), `${at}.coin`), ore: num(f(v, 'ore'), `${at}.ore`) });

const isV1: Recognize<V1> = (v) => ({ version: 1, coins: num(f(v, 'coins'), 'save.v1.coins'), tint: str(f(v, 'tint'), 'save.v1.tint'), ticks: num(f(v, 'ticks'), 'save.v1.ticks'), runs: num(f(v, 'runs'), 'save.v1.runs') });
const isV2: Recognize<V2> = (v) => ({ version: 2, wallet: purse(f(v, 'wallet'), 'save.v2.wallet'), tint: str(f(v, 'tint'), 'save.v2.tint'), ticks: num(f(v, 'ticks'), 'save.v2.ticks'), runs: num(f(v, 'runs'), 'save.v2.runs') });
const isV3: Recognize<V3> = (v) => ({ version: 3, wallet: purse(f(v, 'wallet'), 'save.v3.wallet'), hue: num(f(v, 'hue'), 'save.v3.hue'), ticks: num(f(v, 'ticks'), 'save.v3.ticks'), runs: num(f(v, 'runs'), 'save.v3.runs') });
// `expectSerializable` and not `num`, on the one field that can arrive as a legal `Infinity` from
// this build's own arithmetic. `@latticekit/persist`'s README asks for it by name — *"put
// `expectSerializable` from core's guard on your currencies inside the head recognizer; it is
// worth more than a recognizer that checks thirty field names and no ranges"* — and the message
// it throws is the placard a visitor reads when a crate falls off the third rung.
const isV4: Recognize<V4> = (v) => ({ version: 4, wallet: purse(f(v, 'wallet'), 'save.v4.wallet'), hue: num(f(v, 'hue'), 'save.v4.hue'), best: expectSerializable(f(v, 'best'), 'save.v4.best') });
const isV5: Recognize<V5> = (v) => ({ version: 5, wallet: { ...purse(f(v, 'wallet'), 'save.v5.wallet'), seal: num(f(f(v, 'wallet'), 'seal'), 'save.v5.wallet.seal') }, hue: num(f(v, 'hue'), 'save.v5.hue'), best: expectSerializable(f(v, 'best'), 'save.v5.best') });

// ── the four rungs ───────────────────────────────────────────────────────────────────────────

/**
 * `#rrggbb` back to the hue it came from — the inverse of `draw`'s `hueToHex`, and the reason
 * `SEAMS.md` says to store the input.
 *
 * Max, min, subtract and divide: every operation here is IEEE-exact, so the rung is Tier A and
 * two engines migrate the same save to the same hue. What it is **not** is lossless — the
 * derivation went out through 8-bit channels, so a player who picked 197 gets 197 back only when
 * the rounding happens to agree, and no amount of care in this function changes that. Which is
 * the whole argument for the rule: a migration can recover a discarded input approximately, and
 * can never recover it exactly.
 */
function hueOfHex(css: string): number {
  const n = Number.parseInt(css.slice(1), 16) || 0, r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const hi = Math.max(r, g, b), c = hi - Math.min(r, g, b);
  return c === 0 ? 0 : Math.round((hi === r ? ((g - b) / c + 6) % 6 : hi === g ? (b - r) / c + 2 : (r - g) / c + 4) * 60);
}

/** The prose on the four rungs. `step` refuses an empty one, and this is what a reviewer in two
 *  years has instead of the commit that added the rung — so it is written for them, and then put
 *  on the wall for a visitor, which is one audience at two distances. */
export const WHY = ['one coin counter became a wallet of two currencies', 'the stored #rrggbb became the hue it was derived from',
  'ticks and runs collapsed into the best run they only ever computed', 'the wallet learned to hold a third currency'] as const;

const c1 = migrations(1, isV1);
const c2 = c1.step(2, WHY[0], (s: V1): V2 => ({ version: 2, wallet: { coin: s.coins, ore: 0 }, tint: s.tint, ticks: s.ticks, runs: s.runs }), isV2);
const c3 = c2.step(3, WHY[1], (s: V2): V3 => ({ version: 3, wallet: s.wallet, hue: hueOfHex(s.tint), ticks: s.ticks, runs: s.runs }), isV3);
const c4 = c3.step(4, WHY[2], (s: V3): V4 => ({ version: 4, wallet: s.wallet, hue: s.hue, best: s.ticks / s.runs }), isV4);
const TOP = c4.step(5, WHY[3], (s: V4): V5 => ({ version: 5, wallet: { ...s.wallet, seal: 0 }, hue: s.hue, best: s.best }), isV5).seal();
const CHAIN: readonly MigrationChain<number, Save>[] = [c1.seal(), c2.seal(), c3.seal(), c4.seal(), TOP];
/** How many builds are on the ladder — `chain.head`, and never a literal standing beside it. */
export const HEAD: number = TOP.head;

// ── the five builds, each a real store over its own storage ──────────────────────────────────

/**
 * The archive's clock, which this file owns because `persist` deliberately owns none: `now` is a
 * required field of `StoreOptions`, and defaulting it would make every save load with an elapsed
 * of zero while nothing looked broken. It is wound backwards while the archive is being written,
 * so the crates carry real ages, and parked at {@link ARCHIVE_NOW} for the rest of the session.
 */
const DAY = 86_400_000; export const ARCHIVE_NOW = 1_771_000_000_000; let clock = ARCHIVE_NOW;
const fresh = (): Save => ({ version: 1, coins: 0, tint: '#6b7c8a', ticks: 0, runs: 1 });
const shipped = (i: number): Store<Save> => createStore<number, Save>({ key: `yard:build-${String(i + 1)}`, chain: CHAIN[i] ?? TOP, adapter: memoryStorage(), fresh, now: () => asEpochMillis(clock) });
const B1 = shipped(0), B5 = shipped(4);
/** `BUILDS[k]` is the build that shipped at version `k + 1`. Five stores, one archive. */
export const BUILDS: readonly Store<Save>[] = [B1, shipped(1), shipped(2), shipped(3), B5];

// ── the archive ──────────────────────────────────────────────────────────────────────────────

/** One filed save: the bytes on disk, and nothing else. What is wrong with it — if anything — is
 *  not recorded here and is never guessed at. It is whatever a build's `decode` says it is. */
export interface Filed { readonly text: string }

/**
 * One filed save, straight out of the seed.
 *
 * Every draw is `hash2(seed, i, salt)` rather than an `Rng`, so a save's identity is a pure
 * function of its index and the archive needs no array: it is unbounded in exactly the way the
 * ground is, and the damage slider changes which saves are damaged without re-rolling anybody's
 * coins. The same `?seed=` produces the same shelf on any machine.
 *
 * Four kinds of save come off this shelf and **none of them is marked as such**. One in fourteen
 * was recorded across a run that never ended (`runs: 0`, legal at v1, v2 and v3, and an infinity
 * the moment the third rung divides by it). One in twenty was written by a *newer* build, which
 * is a player who opened a stale deploy on a second device. `damage` of them have one flipped
 * character in the payload with the checksum left alone, which is what a truncated write looks
 * like. One in seventeen was stamped below the chain floor. Nothing here knows which is which,
 * and neither does the yard: only `decode` knows.
 *
 * The clock is wound back before the envelope is written, so every crate carries a real age, and
 * it is deliberately not wound forward again — nothing else in this exhibit reads it, and a
 * reset would be a line whose absence has no symptom.
 */
export function fileOne(seed: number, i: number, damage: number): Filed {
  const runs = toUnit(hash2(seed, i, 3)) < 0.07 ? 0 : 1 + (hash2(seed, i, 4) % 40);
  clock = ARCHIVE_NOW - Math.round(toUnit(hash2(seed, i, 5)) * 400) * DAY;
  const state: V1 = { version: 1, coins: hash2(seed, i, 1) % 9973, tint: hueToHex(hash2(seed, i, 2) % 360), ticks: hash2(seed, i, 6) % 90_000, runs };
  const v1 = B1.encode(state), roll = toUnit(hash2(seed, i, 7));
  if (roll < 0.05 && runs > 0) return { text: B5.encode(TOP.run(state, 1)) };
  if (roll < 0.05 + damage) return { text: damaged(v1, hash2(seed, i, 8)) };
  return { text: roll > 0.94 ? JSON.stringify({ ...(JSON.parse(v1) as object), v: 0 }) : v1 };
}

/** One damaged character in the payload, with the envelope's checksum left untouched. The version
 *  stamp and the sequence number survive, so this reads as `corrupt` — damaged bytes — rather
 *  than as `malformed`, which is something else having written to the key. */
function damaged(text: string, at: number): string {
  const env = JSON.parse(text) as { readonly d: string }, i = at % env.d.length;
  return JSON.stringify({ ...env, d: `${env.d.slice(0, i)}${env.d[i] === '7' ? '8' : '7'}${env.d.slice(i + 1)}` });
}

/** `decode` — the entire read pipeline as a function of a string, touching no storage and
 *  quarantining nothing. It is the only way this exhibit ever learns anything about a save. */
export const openWith = (build: number, filed: Filed): OpenResult<Save> => (BUILDS[build] ?? B1).decode(filed.text);

/**
 * The sentence a visitor reads when a save does not survive, written **here** rather than taken
 * from `ReadFailure.message`.
 *
 * That is `persist`'s own instruction and it is worth obeying visibly: *"do not show it to a
 * player — it is written in one voice and one language, and a game that puts it on screen has a
 * sentence in its UI it cannot change without patching a dependency. Switch on `reason` and say
 * it yourself."* The one place this reaches back into the package is `failure.cause`, and only
 * because on a failed rung the thing that threw is this exhibit's own recognizer talking.
 *
 * `at` is the build that refused it, which the failure itself does not carry — the same save
 * reads `invalid` from the v4 build and `migration-failed` from the v5 build, and a placard that
 * could not say which one was asking would be describing two different events with one sentence.
 */
export function excuse(o: OpenResult<Save>, at: number): string {
  const x = o.failure; if (x === null) return '';
  const cause = x.cause instanceof Error ? x.cause.message : String(x.cause);
  if (x.reason === 'corrupt') return `the v${String(at + 1)} build could not hash these bytes to what the envelope claims. Something wrote over this save, and the payload was never parsed`;
  if (x.reason === 'orphaned') return `written at version ${String(x.savedVersion)}, below the floor this chain still carries — announced data loss, not damage`;
  if (x.reason === 'future') return `written by a newer build (version ${String(x.savedVersion)}). The v${String(at + 1)} build will not write over it, and the save is intact`;
  if (x.reason === 'migration-failed') return `rung ${String((x.atVersion ?? 1) - 1)} → ${String(x.atVersion)} rejected its own output. ${cause}`;
  if (x.reason === 'invalid') return `it reached the v${String(at + 1)} build's head and that build's recognizer still refused. ${cause}`;
  return `${x.reason}: the v${String(at + 1)} build could not read the envelope at all`;
}
