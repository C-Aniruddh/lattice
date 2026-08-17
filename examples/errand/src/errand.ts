/**
 * The errand: the state machine, the cast, and **the three numbers that reach the disk**.
 *
 * An RPG's skeleton is smaller than it looks, and this file is the claim. Five verbs — walk, talk,
 * take, use, save — need one integer of progress and one place to stand, and everything else a
 * player can see is derived from those on the way back up.
 *
 * ## What is in the save, and what is deliberately not
 *
 * `docs/SEAMS.md`: **persist the input, never the derived value.** The inputs here are the tile the
 * player walked to and the answers they gave; everything else is a function of those.
 *
 * | | in the file | why |
 * |---|---|---|
 * | `stage` | **yes** | the only thing a player *decided*. Four values, and the whole game |
 * | `gx`, `gy` | **yes** | where they walked to. A tile — not a world pixel, not an arc length |
 * | carrying the key | no | `stage === 2`. A second copy is a copy that can disagree |
 * | the gate being open | no | `stage === 3`. The gate is a weight in `makeCost`, not a flag |
 * | the key still in the well | no | `stage === 1`, and nothing is spliced. **The well does not go
 *   anywhere** — the glint on it is `stage === 1` and the key in your hand is `stage === 2`, so the
 *   take is two renderers reading one integer rather than an object leaving a list |
 * | the route being walked | no | derived from a tap that has already happened |
 * | the valley, the houses, the trees | no | a hash re-derives all of it, exactly |
 *
 * The route is the interesting omission. A walker's position is `pathSample(route, s)`, and both the
 * route and `s` are Tier A but *derived* — write them down and a reload resumes a walk toward
 * somewhere the player has forgotten they tapped. Landing on the tile is the honest resume, and it
 * costs one `Math.round` at write time.
 *
 * ## The seed and the save are the same question, so they share a key
 *
 * `?seed=` moves the river, the fields and the thickets. The landmarks do not — they are constants
 * in `valley.ts` — but tile (41, 73) is a hedge on one seed and open meadow on another, so a save
 * carried across seeds would stand the player somewhere that no longer exists. Three ways out:
 * refuse the save, clamp it, or **give every seed its own save**. The third is the only one with
 * nothing to explain to a player, and it is one line: the seed is hashed into the storage key. Two
 * links with different seeds are two worlds with two histories, `?seed=` is always a fresh start,
 * and the wrong-world case is not handled because it cannot be reached.
 */
import { expectObject, expectRange, hashString, type Now } from '@latticekit/core';
import type { Path } from '@latticekit/iso';
import { browserStorage, createStore, migrations, type Store } from '@latticekit/persist';
import { H, START, W } from './valley.js';

/** How far along the errand you are. The four values, in order, are the four verbs that move it. */
export type Stage = 0 | 1 | 2 | 3;

/** The whole save. Three numbers, and a chain that will not accept a fourth by accident. `stage` is
 *  0 nothing asked · 1 asked, key still in the well · 2 carrying it · 3 the gate is open. */
export interface Save { readonly stage: Stage; readonly gx: number; readonly gy: number }

/**
 * The cast: everything that goes into the frame as an object rather than as a tile.
 *
 * `you` is in the union although the player answers no tap, because they are drawn and sorted — and
 * *picked over* — out of the same list as the three that do. A second list for "things that are only
 * scenery" is the beginning of two collections sorted separately, which is the one bug this
 * exhibit's picking cannot afford.
 */
export type SpotKind = 'you' | 'miller' | 'key' | 'gate';

/** A thing in the world. `gx`/`gy` are mutable for exactly one member of the cast — the player,
 *  whose position is re-sampled off the path every update. Where you *stand* to use one is
 *  `(gx, gy + 1)` for all of them, which is a fact about the layout rather than a coincidence: the
 *  gate is a wall until it is not, so the tile below it is the mill lane's last metalled square,
 *  and `valley.ts` puts the miller and the well one tile north of open ground for the same reason. */
export interface Spot { readonly kind: SpotKind; gx: number; gy: number }

/** Everything that changes while the exhibit is running, in one object, because `view.ts` reads all
 *  of it and passing five mutable locals into a render function is five chances to pass a stale
 *  one. `facing` is a `pathDirAt` code or 0 for standing still, and `walked` is arc length consumed
 *  along `route`, in world pixels. */
export interface Play { stage: Stage; facing: number; walked: number; readonly you: Spot; readonly route: Path }

/** The stage that answering this spot leads to, or the stage you are already in when it leads
 *  nowhere. **The entire game rule, and the only place it is written down.** `hud.ts` shows a
 *  confirming button exactly when this returns something new, so a line of dialog cannot grow a
 *  consequence by being written differently. */
export function advance(kind: SpotKind, stage: Stage): Stage {
  if (kind === 'miller') return stage === 0 ? 1 : stage;
  if (kind === 'key') return stage === 1 ? 2 : stage;
  return kind === 'gate' && stage === 2 ? 3 : stage;
}

/**
 * What a payload must look like to be believed.
 *
 * Per-version by design: the recognizer belongs to its rung, so a chain that grows a step cannot
 * forget to check the shape it just invented. It has to be strict about *range* and not only type —
 * `gx: 4e9` parses, passes a `typeof` check, and puts the player outside the grid, where
 * `PathFinder` hunts for a goal it will never reach and the exhibit hangs on boot for the length of
 * the node ceiling. Note what it does **not** do: throw at a player. A rejection makes `open()`
 * report `'invalid'` and hand back `fresh()`, so the exhibit is playable across a corrupt save with
 * no branch anywhere in `main.ts`.
 */
function recognize(value: unknown): Save {
  const o = expectObject(value, 'errand save');
  return { stage: expectRange(Number(o['stage']), 0, 3, 'errand save.stage') as Stage,
    gx: expectRange(Number(o['gx']), 0, W - 1, 'errand save.gx'), gy: expectRange(Number(o['gy']), 0, H - 1, 'errand save.gy') };
}

/**
 * The store for one seed's valley.
 *
 * @param seed hashed into the key rather than into the payload — see the header. The
 *   `normalize('NFC')` is `persist`'s own advice for any key a human can type: without it the same
 *   seed typed on macOS and on Windows is two keys and two worlds.
 * @param now the calendar, and the one clock here that is not the loop's. `persist` refuses to
 *   default it, correctly: a zeroed `savedAt` is a bug that looks like nothing.
 */
export function openErrand(seed: string, now: Now): Store<Save> {
  return createStore({
    key: `errand:save:${hashString(seed.normalize('NFC')).toString(36)}`,
    chain: migrations(1, recognize).seal(), adapter: browserStorage(), now, fresh: (): Save => ({ stage: 0, gx: START.gx, gy: START.gy }),
    // Three quarters of the default. It has to be short enough that a visitor's whole engagement —
    // about ninety seconds — contains several writes, and **long enough that the clock beside it
    // visibly climbs**: at the 1000 ms this started on, the readout said "0s ago" for ever, which
    // proves a save is happening and proves nothing about when. `Autosave` has no dirty check, so a
    // player standing still still writes the same eighty-eight bytes on every tick; the interval is
    // the only lever a game has over that, and it is filed as a finding.
    minWriteIntervalMs: 3000,
  });
}
