/**
 * `examples/_shared` — what every exhibit in the gallery shares, and nothing more.
 *
 * ```ts
 * import { bootstrap, controlPanel, knobs } from '../../_shared/src/index.js';
 * ```
 *
 * **This is a gallery instrument and never a kit feature.** Nothing here may move into
 * `packages/`, no exhibit may depend on the landing page, and the landing page may not depend on
 * an exhibit. `@latticekit/ui` is deliberately not a controls library and this is not an attempt to
 * make it one — the panel is DOM the gallery owns, styled by the gallery, thrown away if the
 * gallery is.
 *
 * Three modules do the work and they are independent on purpose: {@link bootstrap} is the boot an
 * exhibit would otherwise hand-roll, {@link controlPanel} is the instrument that makes the kit's
 * parameters visible, and {@link createBucket} holds the array a `DepthSorter`'s integers index
 * into. An exhibit may take any one of them without the others.
 *
 * See `README.md` beside this file for the argument about which half of this belongs in a
 * `@latticekit/kit` package and which half does not.
 */

export { bootstrap } from './bootstrap.js';
export type { Boot, BootOptions, CameraPolicy } from './bootstrap.js';

export { controlPanel, PANEL_CLASS } from './panel.js';
export type {
  ChoiceControl,
  Control,
  Panel,
  PanelEntry,
  PanelOptions,
  RangeControl,
  TextControl,
  ToggleControl,
  Wrong,
} from './panel.js';

export { createBucket } from './bucket.js';
export type { Bucket } from './bucket.js';

export { readParams } from './params.js';
export type { Params } from './params.js';

/**
 * The frame-cost switch, and the two markers a HUD applies it with.
 *
 * `?cost=0` — or `bootstrap({ showCost: false })` — suppresses the worst-frame figure and
 * nothing else. On by default, because § Scale's cost row is a gate. See `cost.ts`.
 */
export { COST_PARAM, costNode, costShown, costText } from './cost.js';

/**
 * The kit's parameters, pre-declared.
 *
 * A namespace import rather than fifteen loose names, so an exhibit's panel reads
 * `knobs.tapSlop(boot)` and a reader can see at a glance that every row came from here rather
 * than being invented locally.
 */
export * as knobs from './knobs.js';
export type { Box, Knob } from './knobs.js';
