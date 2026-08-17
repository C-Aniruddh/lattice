/**
 * @art — every word the exhibit says. The dialog, the objectives, and the four button labels.
 *
 * Text is art, and separating it from the state machine is not tidiness — it is what makes the
 * state machine readable. `errand.ts` is nineteen lines of `if` about four values; the *reason*
 * those four values are interesting is entirely in this file, and mixing the two would have hidden
 * a nine-line rule inside sixty lines of prose. Delete this module and the errand still runs
 * exactly as it does now, silently, which is the test `docs/GALLERY.md` sets for art.
 *
 * ## The dialog is a table, and that is the honest size of it
 *
 * Four speakers times four stages is sixteen cells, of which nine are reachable, and the whole of
 * an RPG's conversation system at this scale is a lookup. There is no dialog tree, no node graph
 * and no script language, because a sixth verb is exactly what those are for. `docs/GALLERY.md`:
 * *"if it does not fit in five verbs it belongs in a different exhibit."*
 *
 * **`hud.ts` decides whether the confirming button appears**, from `advance()` in `errand.ts` — not
 * from anything here. A line of dialog cannot grow a consequence by being written differently,
 * which is the one way a text file is allowed to be dangerous.
 */
import type { SpotKind, Stage } from './errand.js';

/** One exchange: who is speaking, what they say, and what the two buttons are called. */
export interface Speech {
  readonly who: string;
  readonly says: string;
  /** The label on the button that acts, when the state machine says there is one to act with. */
  readonly act: string;
  /** The label that only closes. Never absent — every dialog can be walked away from. */
  readonly leave: string;
}

const MILLER: readonly Speech[] = [
  {
    who: 'Aldis, the miller',
    says: 'The mill gate has been chained since Tuesday and the key went down the old well with the bucket. I am too old for wells. Would you go?',
    act: "I'll go",
    leave: 'Not today',
  },
  {
    who: 'Aldis, the miller',
    says: 'East along the high road, over the bridge, and the well is in the meadow past it. Mind the bucket — it swings.',
    act: '',
    leave: 'Right',
  },
  {
    who: 'Aldis, the miller',
    says: 'That is the one. Up the mill lane, and do not let the gate swing back on you.',
    act: '',
    leave: 'Right',
  },
  {
    who: 'Aldis, the miller',
    says: 'Listen to that. Four days of grain standing in sacks and now it goes. Come back at harvest and there will be bread in it for you.',
    act: '',
    leave: 'Gladly',
  },
];

const KEY: readonly Speech[] = [
  { who: 'The old well', says: 'Cold stone, and a long way down.', act: '', leave: 'Leave it' },
  {
    who: 'The old well',
    says: 'The bucket comes up heavy. An iron key, green at the teeth, on a loop of wet cord.',
    act: 'Take the key',
    leave: 'Leave it',
  },
  { who: 'The old well', says: 'Nothing else down there but water.', act: '', leave: 'Leave it' },
  { who: 'The old well', says: 'Nothing else down there but water.', act: '', leave: 'Leave it' },
];

const GATE: readonly Speech[] = [
  { who: 'The mill gate', says: 'Chained shut, and the chain is through a lock nobody here has a key to.', act: '', leave: 'Leave it' },
  { who: 'The mill gate', says: 'Chained shut. Somewhere at the bottom of a well is the answer to this.', act: '', leave: 'Leave it' },
  {
    who: 'The mill gate',
    says: 'The key turns stiffly, and then all at once. The chain runs out of the ring and falls in the grass.',
    act: 'Unlock the gate',
    leave: 'Not yet',
  },
  { who: 'The mill gate', says: 'Open, and the sails are going round for the first time this week.', act: '', leave: 'Good' },
];

const YOU: Speech = { who: 'You', says: 'Somewhere to be, and an afternoon to do it in.', act: '', leave: 'Quite' };

/** What this spot says at this stage. Total — there is no reachable pair with nothing to say. */
export function speechFor(kind: SpotKind, stage: Stage): Speech {
  if (kind === 'miller') return MILLER[stage] ?? YOU;
  if (kind === 'key') return KEY[stage] ?? YOU;
  if (kind === 'gate') return GATE[stage] ?? YOU;
  return YOU;
}

/**
 * The one line of the HUD that names the next action, per stage.
 *
 * Written as a *place plus a direction*, always, because the thing it is naming is off-screen every
 * time. An objective that says "find the key" in a valley three viewports wide is a maze; one that
 * says "east, over the bridge" is an errand.
 */
export const OBJECTIVES: readonly string[] = [
  'Speak to Aldis, the miller — he is on the green, east of the square.',
  'The old well: east along the high road, over the bridge, in the meadow.',
  'Carry the key up the mill lane, north from the high road, to the gate.',
  'The mill is turning. Walk wherever you like — the valley keeps going.',
];

/** The brief, under the title. One sentence, and it has to name the control. */
export const BRIEF = 'Tap the ground to walk. Tap a person or a thing to reach it and use it. Everything you do is saved.';

/** What the carried-item chip says. One item, one string; an inventory would be a sixth verb. */
export const CARRYING = 'IRON KEY';

/**
 * What `persist` is worried about, in the exhibit's own voice.
 *
 * `StoreStatus` is a *condition* rather than a message — stable while the condition is, and
 * deliberately carrying no timestamp, count or version, because a status that differed each time
 * would defeat the latch it exists for. Turning a condition into a sentence is this file's job for
 * the same reason turning a stage into a line of dialog is: `ok` says nothing at all, and the other
 * three are written in the register the rest of the valley speaks in rather than in the package's.
 */
export const TROUBLE: Readonly<Record<string, string>> = {
  ok: '',
  'refusing-newer': 'A newer save is on this browser. Nothing you do now is being written.',
  'write-failing': 'Storage refused the last write. Progress since then is not saved.',
  'not-persistent': 'Private browsing: this valley will not be here tomorrow.',
};
