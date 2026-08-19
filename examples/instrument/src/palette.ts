/**
 * The workshop's stop sets.
 *
 * @art
 *
 * Brass, walnut, teal, ember — the four materials the hall is made of, added to both day and
 * night so a lerp cannot leave one of them gold at midnight. Delete this file and the exhibit
 * still plays; it just plays in the kit's default grass.
 */
import { DAY, NIGHT, extendStops } from '@latticekit/draw';

export const WORKSHOP = extendStops(DAY, {
  brass: 0xc4893aff,
  walnut: 0x3d2416ff,
  teal: 0x2eb8b0ff,
  ember: 0xe07a3aff,
});

export const WORKSHOP_NIGHT = extendStops(NIGHT, {
  brass: 0x7a4a22ff,
  walnut: 0x1a120cff,
  teal: 0x1f7a76ff,
  ember: 0xa85228ff,
});
