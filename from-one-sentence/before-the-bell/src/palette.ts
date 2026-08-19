import { DAY, DUSK, extendStops, hex } from '@latticekit/draw';

/** Morning bakery: apricot sky, warm cobble, crust-brown brand. */
export const DAY_X = extendStops(DAY, {
  crust: hex('b85a32'),
  flour: hex('e8d9b8'),
  awning: hex('c4452d'),
  leaf: hex('5d8a4a'),
  cobble: hex('c4a57a'),
});

/** Closing hour — warmer, lower, the oven is the brightest thing left. */
export const DUSK_X = extendStops(DUSK, {
  crust: hex('7a3a28'),
  flour: hex('c4a888'),
  awning: hex('8a2e24'),
  leaf: hex('3d5a38'),
  cobble: hex('8a6a4e'),
});
