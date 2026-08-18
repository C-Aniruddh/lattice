/**
 * Fenced code blocks, pulled out of markdown the one way both documentation gates agree on.
 *
 * This lived inside `check-docs.mjs` until `check-skills.mjs` needed the same answer, and
 * sharing it is not merely tidiness. The two gates disagreed about **the opt-out tag**, which
 * is the worst kind of disagreement for a rule an author has to remember: `check-docs.mjs`
 * honored ` ```ts ignore ` and the skills had been written with ` ```ts wrong `, so eight
 * deliberately-broken examples were opted out of a gate that had never read them and would
 * have been dragged into one the day someone pointed it at `skills/`.
 *
 * **Both words are honored now, and they mean different things.**
 *
 * | tag | says | use it for |
 * |---|---|---|
 * | ` ```ts wrong ` | this code *is* the defect | the wrong-version half of a trap. Non-negotiable: every trap in this kit was found as working-looking code, so a skill that shows only the right answer teaches half the lesson |
 * | ` ```ts ignore ` | this code is not a program | a fragment, a signature, an ellipsis — something that could not compile standing alone and is not claiming to |
 *
 * Prefer `wrong`. It says *why* the block is exempt, and a reader scanning for the trap can
 * grep for it; `ignore` says only that the compiler was told to look away, which is a thing a
 * future author can reach for to silence a real error.
 */

/**
 * Every ` ```ts ` block in `markdown`, in document order, minus the opted-out ones.
 *
 * Returns `{ line, code, info }` per block, where `line` is the **1-based line of the block's
 * first line of code in the source document** — not the fence. Every error message either gate
 * prints is derived from that number, so it is the difference between "fix `skills/hud/SKILL.md`
 * line 240" and "fix a temporary file that no longer exists".
 */
export function tsBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');

  /** `null` outside any fence; otherwise the fence we are inside. */
  let fence = null;
  let buffer = [];

  lines.forEach((line, i) => {
    const marker = line.match(/^```(.*)$/);
    if (marker === null) {
      if (fence?.capture === true) buffer.push(line);
      return;
    }
    if (fence === null) {
      const info = (marker[1] ?? '').trim();
      const lang = info.split(/\s+/)[0] ?? '';
      fence = { capture: lang === 'ts' && !/\b(ignore|wrong)\b/.test(info), line: i + 2, info };
      buffer = [];
      return;
    }
    // Closing.
    if (fence.capture) blocks.push({ line: fence.line, code: buffer.join('\n'), info: fence.info });
    fence = null;
    buffer = [];
  });

  return blocks;
}
