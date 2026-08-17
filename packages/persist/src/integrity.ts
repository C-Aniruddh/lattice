/**
 * Integrity: one 32-bit digest, taken over the exact bytes that were written.
 *
 * This module is four lines of code and a page of prose, and the ratio is correct. The code
 * is `core`'s `hashString` rendered as hex; the prose is the two things a reader has to know
 * before they touch it — what the digest is for (damage, not adversaries) and why it must
 * never normalize its input (because the bytes are the subject, not the text).
 */

import { hashString } from '@latticekit/core';

/**
 * A checksum over the exact payload text.
 *
 * **A 32-bit digest detects corruption. It does not authenticate, and pretending otherwise
 * is worse than having none at all.** It catches a truncated write, a string clipped by a
 * quota limit, a sync extension that half-wrote the key, and a payload hand-edited into
 * invalid state — the class of damage that otherwise loads as a subtly wrong world three
 * sessions later. It cannot stop a determined player: the algorithm is in the bundle they
 * downloaded, there is no key, and recomputing it in a devtools console takes under a
 * minute. If your game's economy needs a save the player cannot edit, your game needs a
 * server, and this kit deliberately does not have one.
 *
 * Collision maths, stated so nobody has to guess: 32 bits is a birthday collision at roughly
 * 77,000 distinct inputs, and one specific damaged payload passes with probability 2^-32.
 * For "did these bytes survive the round trip" that is ample; for anything adversarial it is
 * meaningless, because an adversary does not need a collision, they need a calculator.
 *
 * Substituting your own is supported and is the reason this is a type: pass
 * `checksum: text => sha256Hex(text)` and the store uses it for both writing and reading. It
 * must be a **pure function of the string**, or every save written by one build fails to
 * verify under the next.
 */
export type Checksum = (text: string) => string;

/**
 * `hashString` from `@latticekit/core`, rendered as eight lowercase hex digits.
 *
 * Deliberately not a bespoke CRC or FNV implementation: `core` split `hash` into its own
 * module precisely so `persist`, `draw` and `iso` would not each grow a private 32-bit hash.
 * One implementation, one set of tests, one portability seam.
 *
 * ## The payload is checksummed as read, unnormalised — and that is deliberate
 *
 * `hashString` walks **UTF-16 code units**, so `'café'` spelled NFC (`café`) and NFD
 * (`café`) hash differently. That is *correct here*: they are different bytes, and the
 * checksum's entire job is to notice that the bytes changed. Do not "fix" it by normalising
 * before hashing — the digest would then cover a string that was never written, and a save
 * genuinely truncated mid-combining-sequence would pass.
 *
 * ## Where the same fact is a bug instead, and it is not in this file
 *
 * The moment a **player-authored string reaches a hash whose output is used as an identity**
 * — a save-file key, a slot id, a seed derived from a typed name — UTF-16 code units become a
 * portability defect rather than a feature. macOS hands you NFD from the filesystem and from
 * some IME paths; Windows and most browsers hand you NFC. The same visible name typed on two
 * machines then hashes to two different numbers, so the player gets two different save keys,
 * two different worlds, and a bug that reproduces on nobody's machine.
 *
 * The rule, and it belongs at every such call site rather than in here:
 *
 * ```ts
 * // A key derived from something a player typed. Normalize first, always.
 * const key = `campus:save:${hashString(playerName.normalize('NFC')).toString(16)}`;
 * ```
 *
 * ```ts
 * // A checksum over a payload. Never normalize — the bytes are the subject.
 * const c = defaultChecksum(payloadText);
 * ```
 *
 * The two rules look contradictory and are not: one hashes *text a human means*, the other
 * hashes *bytes a machine wrote*. Ask which of the two you have before you reach for
 * `normalize`.
 */
export const defaultChecksum: Checksum = (text: string): string =>
  (hashString(text) >>> 0).toString(16).padStart(8, '0');
