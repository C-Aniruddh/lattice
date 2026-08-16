/**
 * `examples/_shared` — what every exhibit in the gallery shares, and nothing more.
 *
 * ```ts
 * import { bootstrap, controlPanel, knobs } from '../../_shared/src/index.js';
 * ```
 *
 * **This is a gallery instrument and never a kit feature.** Nothing here may move into
 * `packages/`, no exhibit may depend on the landing page, and the landing page may not depend on
 * an exhibit. `@lattice/ui` is deliberately not a controls library and this is not an attempt to
 * make it one — the panel is DOM the gallery owns, styled by the gallery, thrown away if the
 * gallery is.
 *
 * Two modules do the work and they are independent on purpose: {@link bootstrap} is the boot an
 * exhibit would otherwise hand-roll, and {@link controlPanel} is the instrument that makes the
 * kit's parameters visible. An exhibit may take either without the other.
 *
 * See `README.md` beside this file for the argument about which half of this belongs in a
 * `@lattice/kit` package and which half does not.
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

export { readParams } from './params.js';
export type { Params } from './params.js';

/**
 * The kit's parameters, pre-declared.
 *
 * A namespace import rather than fifteen loose names, so an exhibit's panel reads
 * `knobs.tapSlop(boot)` and a reader can see at a glance that every row came from here rather
 * than being invented locally.
 */
export * as knobs from './knobs.js';
export type { Box, Knob } from './knobs.js';
