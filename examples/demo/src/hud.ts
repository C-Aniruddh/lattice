/**
 * The HUD — **and the one seam in this exhibit that is not wired to the package that owes it.**
 *
 * `@lattice/ui` had not landed when this was built: it exports `VERSION` and nothing else, so
 * there is no panel, no number roll, no toast and no CSS-variable bridge holding the DOM's colors
 * to `draw`'s. Rather than invent a substitute DOM overlay, everything here is drawn in the
 * Overlay pass out of `draw`'s screen-space primitives, which is what they are for. What is
 * missing is exactly what `ui` was going to give: rolls instead of jumps, real buttons with an
 * affordable state, and a HUD that keeps reading while the canvas is throttled.
 *
 * {@link Hud} is the shape `ui` should fill. Swap the body of `drawHud`; keep the call.
 */
import { fmtCompact } from '@lattice/core';
import { DEFAULT_TEXT, mix, screenText, shade, withAlpha, type Pen, type Rgba, type TextStyle } from '@lattice/draw';

/** The HUD must read at midnight, so its type colors are fixed rather than taken from the palette. */
const PAPER = 0xf2f5fbff;
const DIM = 0x9aa6bcff;
const TITLE: TextStyle = { ...DEFAULT_TEXT, size: 11, weight: 800, align: -1, baseline: 0 };
const BODY: TextStyle = { ...DEFAULT_TEXT, size: 15, weight: 600, align: -1, baseline: 0 };
const VALUE: TextStyle = { ...DEFAULT_TEXT, size: 21, weight: 800, align: -1, baseline: 0 };
const LABEL: TextStyle = { ...DEFAULT_TEXT, size: 10, weight: 700, align: -1, baseline: 0 };
const RATE: TextStyle = { ...DEFAULT_TEXT, size: 11, weight: 600, align: -1, baseline: 0 };
const CHIP: TextStyle = { ...DEFAULT_TEXT, size: 14, weight: 700, align: 0, baseline: 0 };

export interface Hud {
  /** One line, always naming the next action. The entire tutorial. */
  readonly objective: string;
  readonly coin: number;
  readonly coinRate: number;
  readonly lit: number;
  readonly stations: number;
  readonly walkers: number;
  readonly daylight: number;
  readonly showCoin: boolean;
}

/** A panel with its corners cut. Eight points, one fill, one hairline — a whole visual language. */
function plate(pen: Pen, x: number, y: number, w: number, h: number, fill: Rgba, edge: Rgba): void {
  const c = 7;
  const xy = pen.xy;
  const pts = [x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c];
  for (let i = 0; i < pts.length; i++) xy[i] = pts[i] ?? 0;
  pen.surface.poly(xy, 8, fill);
  pen.surface.stroke(xy, 8, true, edge, 1);
}

export function drawHud(pen: Pen, h: Hud): void {
  const s = pen.surface;
  const ink = pen.palette.get('ink');
  const card = withAlpha(shade(ink, 0.75), 0.86);
  const edge = withAlpha(PAPER, 0.14);
  const warm = pen.palette.get('warn');
  const ok = pen.palette.get('ok');

  // The objective card: a title, and one line that always names the next action.
  plate(pen, 18, 18, 336, 78, card, edge);
  screenText(pen, 34, 38, 'LAMP ROAD', warm, TITLE);
  screenText(pen, 34, 68, h.objective, PAPER, BODY);

  let y = 108;
  if (h.showCoin) {
    // The coin pill: a struck-coin glyph, a label, a value, and the rate under it.
    plate(pen, 18, y, 190, 58, card, edge);
    s.softEllipse(46, y + 29, 17, 17, withAlpha(warm, 0.4), withAlpha(warm, 0));
    s.ellipse(46, y + 29, 11, 11, warm);
    s.ellipse(46, y + 29, 7, 7, withAlpha(shade(warm, 0.8), 0.9));
    screenText(pen, 68, y + 20, 'COIN', DIM, LABEL);
    screenText(pen, 68, y + 38, fmtCompact(h.coin), PAPER, VALUE);
    screenText(pen, 138, y + 40, `+${h.coinRate.toFixed(1)}/s`, withAlpha(ok, 0.95), RATE);
    y += 70;
  }

  // The road bar: the one number that is actually the subject, drawn as a place rather than a stat.
  plate(pen, 18, y, 190, 52, card, edge);
  screenText(pen, 34, y + 18, 'ROAD LIT', DIM, LABEL);
  screenText(pen, 150, y + 18, `${h.lit}/${h.stations}`, PAPER, LABEL);
  const track = 158;
  const fill = (h.lit / Math.max(1, h.stations)) * track;
  plate(pen, 34, y + 28, track, 10, withAlpha(0x000000ff, 0.45), withAlpha(PAPER, 0.08));
  if (fill > 2) {
    s.softEllipse(34 + fill * 0.5, y + 33, fill * 0.5 + 8, 12, withAlpha(warm, 0.35), withAlpha(warm, 0));
    plate(pen, 34, y + 28, fill, 10, mix(warm, 0xfff0c0ff, 0.2), withAlpha(warm, 0.5));
  }

  // A day/night chip, so the coming dusk is something the player can see arriving.
  const cw = 176;
  const cx = s.width - 18 - cw;
  plate(pen, cx, 18, cw, 44, card, edge);
  const day = h.daylight > 0.5;
  const body = day ? warm : 0xdfe6f5ff;
  s.softEllipse(cx + 24, 40, 16, 16, withAlpha(body, 0.4), withAlpha(body, 0));
  s.ellipse(cx + 24, 40, 8.5, 8.5, body);
  if (!day) s.ellipse(cx + 27, 37, 7, 7, card);
  screenText(pen, cx + 42, 34, day ? 'DAY' : 'NIGHT', PAPER, LABEL);
  screenText(pen, cx + 42, 50, `${h.walkers} on the road`, DIM, LABEL);

  // The one instruction, bottom center, where a thumb is already looking.
  if (h.objective !== '') {
    const w = s.measure('Tap a marker to light the next lamp', CHIP) + 44;
    plate(pen, s.width / 2 - w / 2, s.height - 62, w, 36, card, edge);
    screenText(pen, s.width / 2, s.height - 44, 'Tap a marker to light the next lamp', withAlpha(PAPER, 0.9), CHIP);
  }
}
