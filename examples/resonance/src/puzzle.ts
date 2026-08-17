/**
 * The rules: what a gate is asking for, and whether you answered it.
 *
 * The whole mechanic, and it is deliberately tiny, because *hearing* the answer is the game and
 * the code that decides whether you got it right has no opinion about sound at all. **There is
 * not a frequency in this file.** A chord here is a set of string *indices*; which pitch index 3
 * stands for, and what it sounds like when struck, is `sound.ts` — that is the seam
 * `docs/GALLERY.md` draws when it calls a table of recipes art, and it lands in exactly the right
 * place for this exhibit: the puzzle is which strings, the synthesis is which hertz.
 *
 * ## Why a chord is a bitmask
 *
 * Six strings fit in six bits, so *what a gate asks for* and *what you just played* are the same
 * kind of value and the comparison is `===`. There is no set, no sort, no tolerance and nowhere
 * for a near miss to be accepted. Order does not matter, which is what makes striking three
 * strings with three fingers and striking them one at a time the same answer — and it has to be,
 * because on a phone it is one finger.
 */

/** How many strings you carry. Six is a hand, and six bits is a chord. */
export const STRINGS = 6;
/** The largest chord a gate may ask for. Three is the most a player can strike at once. */
export const CHORD_MAX = 3;

/**
 * Every chord of two and of three strings, indexed by size.
 *
 * Enumerated rather than sampled, so a gate's chord is one hash and one array index, with no
 * rejection loop that could spin on some seed. It also makes the puzzle *closed*: a chord the six
 * strings cannot play is not in the table, so it cannot be handed to a gate.
 */
const CHORDS: number[][] = [[], [], [], []];
for (let mask = 1; mask < 1 << STRINGS; mask += 1) {
  let size = 0;
  for (let bit = 0; bit < STRINGS; bit += 1) size += (mask >> bit) & 1;
  if (size >= 2 && size <= CHORD_MAX) CHORDS[size]?.push(mask);
}

/** The chord a gate asks, from its own hash. `size` is 2 or 3. */
export function chordOf(hash: number, size: number): number {
  const table = CHORDS[size] ?? [];
  return table[hash % table.length] ?? 0b000011;
}

// The last three strings struck, oldest first. Three scalars and not a ring buffer, because
// `CHORD_MAX` is 3; −1 means "nothing yet", and `1 << -1` is a negative number that can never
// equal a mask, so the guard is the arithmetic rather than a branch.
let older = -1, old = -1, last = -1;

/** Forget the run — when the gate you are answering changes, and after one opens. */
export function forget(): void { older = -1; old = -1; last = -1; }

/**
 * Record a strike and hand back the chord the last `size` strings make, or 0 while fewer than
 * `size` have been struck.
 *
 * A rolling window rather than a START OVER button, because the first thing anybody does is mash
 * every string at once, and a mechanic that punished that with a reset would make the exhibit's
 * own opening move feel like a mistake. Mash six against a three-string gate and the last three
 * are simply the answer you gave.
 */
export function played(index: number, size: number): number {
  older = old; old = last; last = index;
  if (old < 0 || (size > 2 && older < 0)) return 0;
  return (size > 2 ? 1 << older : 0) | (1 << old) | (1 << last);
}
