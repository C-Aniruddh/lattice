/**
 * Reading source the way the two budgets read it: comments out, blanks out, code left.
 *
 * This lived inside `size.mjs` until `gallery.mjs` needed the same answer, and sharing it is
 * not merely tidiness. The gallery's line rule and the size budget make the *same* claim —
 * that prose is a load-bearing part of this product (non-negotiable 5) and a number that
 * charged for it would be a number arguing against explaining yourself. Two implementations
 * of that claim would drift, and the day they disagree is the day an author reports one
 * figure and the gate reports another.
 *
 * It is also already the published metric. `docs/GALLERY.md` states the line rule as a
 * `grep -cvE` and reports 1,286 code lines across Lamp Road's nine modules; `codeLines` below
 * returns 1,286 across those nine files, and every per-file figure in that document's table
 * matches too. A measure that reproduces the figure already in the doc is one nobody has to
 * be talked into.
 *
 * Note `lint.mjs` keeps its own `strip`, deliberately: that one blanks comments *in place* so
 * line numbers survive into its error messages. This one collapses them, because neither
 * caller here reports a line number and both want a count.
 */

/**
 * Remove comments and leading indentation, preserving string and template literals.
 *
 * Written out rather than regexed because a naive non-greedy block-comment pattern eats the
 * contents of any string that happens to contain a comment terminator — and this kit has
 * several, since its own linter quotes comment syntax back at you in its error messages.
 *
 * Writing that sentence with the terminator spelled literally is what broke this file the
 * first time, which is a fair demonstration of the point.
 */
export function strip(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** How many lines of a source file are neither blank nor entirely comment. */
export function codeLines(source) {
  const stripped = strip(source);
  return stripped.length === 0 ? 0 : stripped.split('\n').length;
}
