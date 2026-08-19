/**
 * Render the social card, from the kit rather than from a drawing program.
 *
 * The page had no `og:` or `twitter:` tags at all, so every share of it — Hacker News, X, Reddit,
 * Slack, Discord, Bluesky — rendered as a bare blue link. For a project whose entire argument is
 * *look at this*, a link with no picture is the worst possible first impression, and it is the one
 * impression most people will ever get.
 *
 * The card is a real frame of a real exhibit, captured headless at exactly 1200×630. That is the
 * honest version: the picture a stranger sees before they click is the picture they get after.
 *
 * **Why the exhibit and not the landing page.** Capturing the landing page's own above-the-fold was
 * the first attempt and it looked good — the wordmark, the headline and the install command are
 * already composed there. But it is a page built to scroll, so at card height the canvas bled off
 * the bottom edge and the buttons under it were sliced in half. Worse, a capture of somebody else's
 * layout is coupled to that layout: the day the hero moves, the card silently becomes a picture of
 * the wrong thing, and nothing fails. `/x/demo/` is a canvas that fills its viewport at any size,
 * so the frame needs no cropping, and everything drawn over it below is written here and owned
 * here. There is nothing left to drift.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const site = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = dirname(site);

/** Facebook, X, LinkedIn and Slack all crop toward 1.91:1. 1200×630 is that ratio at retina width. */
export const CARD = { width: 1200, height: 630 };

/** Where in the exhibit's own day the shutter falls. See the comment on `--settle` below. */
export const DUSK_MS = 41_000;

/**
 * The overlay, injected before the shot.
 *
 * Everything here is written into a page that is otherwise a bare canvas, so it depends on nothing
 * the exhibit does beyond "there is a canvas filling the window". The HUD goes because a control
 * panel is for somebody who is already playing; the card is for somebody who has not clicked yet.
 */
const OVERLAY = `(() => {
  for (const el of document.querySelectorAll('.lattice-ui, .lattice-layer-toasts')) el.style.display = 'none';

  const css = document.createElement('style');
  css.textContent = \`
    @font-face { font-family: 'Fraunces'; src: url('/fonts/fraunces-600.woff2') format('woff2'); font-weight: 600; font-display: block; }
    @font-face { font-family: 'Plex'; src: url('/fonts/ibm-plex-mono-500.woff2') format('woff2'); font-weight: 500; font-display: block; }
    @font-face { font-family: 'Plex'; src: url('/fonts/ibm-plex-mono-600.woff2') format('woff2'); font-weight: 600; font-display: block; }

    /* A scrim, not a wash. The scene has to stay legible as a scene — if the art is dimmed until
       the type is comfortable, the card is selling the type, and the type is not the product. */
    #og-scrim {
      position: fixed; inset: 0; z-index: 9998; pointer-events: none;
      background:
        linear-gradient(to right, rgba(10,8,6,.93) 0%, rgba(10,8,6,.88) 34%, rgba(10,8,6,.52) 55%, rgba(10,8,6,.06) 76%, rgba(10,8,6,0) 100%),
        linear-gradient(to top, rgba(10,8,6,.78) 0%, rgba(10,8,6,.28) 34%, rgba(10,8,6,0) 62%);
    }
    #og-card {
      position: fixed; left: 64px; right: 64px; bottom: 54px; z-index: 9999;
      color: #f4efe6; -webkit-font-smoothing: antialiased;
    }
    #og-mark { font: 600 46px/1 'Fraunces', Georgia, serif; letter-spacing: -.015em; color: #f4efe6; }
    #og-line { margin-top: 14px; font: 600 40px/1.18 'Fraunces', Georgia, serif; letter-spacing: -.02em; color: #e8a93e; }
    #og-sub  { margin-top: 16px; font: 500 21px/1.45 'Plex', ui-monospace, monospace; color: #c9bfb0; }
    #og-cmd  {
      display: inline-block; margin-top: 22px; padding: 12px 20px;
      font: 600 21px/1 'Plex', ui-monospace, monospace; color: #0c0a08; background: #e8a93e;
      clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
    }
  \`;
  document.head.append(css);

  const scrim = document.createElement('div');
  scrim.id = 'og-scrim';
  const card = document.createElement('div');
  card.id = 'og-card';
  card.innerHTML =
    '<div id="og-mark">lattice</div>' +
    '<div id="og-line">Isometric games made easy</div>' +
    '<div id="og-sub">One sentence to your agent. A deterministic, zero-asset game you can play in a browser.</div>' +
    '<div id="og-cmd">/lattice a game where&hellip;</div>';
  document.body.append(scrim, card);

  return document.fonts.ready.then(() => 'og overlay ready');
})()`;

/**
 * @param {string} baseUrl a running preview of `site/dist`
 * @returns {string} the path written
 */
export function renderCard(baseUrl, keepDir = null, settleMs = DUSK_MS) {
  const out = keepDir ?? mkdtempSync(join(tmpdir(), 'lattice-og-'));
  try {
    // `--at` runs before the shutter and `--eval` runs after it, which is the whole reason the
    // overlay goes in as `--at`. Getting that backwards produces a clean card of an empty scene.
    execFileSync(
      'node',
      [
        join(repo, 'tools/looking/look.mjs'),
        `${baseUrl.replace(/\/$/, '')}/x/demo/`,
        '--size', `${CARD.width}x${CARD.height}`,
        // Dusk, which is what the exhibit's own caption promises: `rules.ts` gives it forty
        // seconds of day, a seven-second ramp, then night, so 45 s lands mid-ramp with the sun
        // low and the lamps coming on.
        //
        // This is real running time and not `--advance`, and the difference is the point. The
        // kit bans `Date.now()` and `performance.now()` inside every package, so the day is
        // counted in simulation ticks; shifting the browser's wall clock moves nothing. Seven
        // clock offsets across two minutes were captured before that landed, and all seven
        // returned a mean luminance of 0.252 — the same flat noon frame, seven times.
        '--settle', String(settleMs),
        '--at', OVERLAY,
        '--out', out,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const dest = join(site, 'public/og.png');
    copyFileSync(join(out, 'frame-b.png'), dest);
    return dest;
  } finally {
    if (!keepDir) rmSync(out, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const base = process.argv[2] ?? 'http://localhost:4173';
  const written = renderCard(base);
  const { size } = statSync(written);
  console.log(`og card: ${written} — ${(size / 1024).toFixed(0)} kB, ${CARD.width}x${CARD.height}, captured from /x/demo/`);
}
