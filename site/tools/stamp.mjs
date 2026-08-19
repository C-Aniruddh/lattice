/**
 * Stamp the two things every built page needs into every built page.
 *
 * This runs last, over `dist/`, rather than in the generators. There are five things that write
 * HTML here — build-page.mjs writes the landing page, doc-html.mjs writes the reference, and Vite
 * writes twenty-two more from the exhibits' and games' own `index.html` files, which live outside
 * `site/` and are not ours to edit (the three under `from-one-sentence/` are shipped unedited on
 * purpose, and editing them would be a lie about what the agent produced). A generator-side
 * injection would therefore have to be repeated five times and would silently miss the twenty-third
 * page the day someone adds a producer. `dist/` is the one place every page is guaranteed to pass
 * through.
 *
 * The analytics tag is deliberately not part of the dev server. Local iteration should not appear
 * in the property.
 *
 * The share card is stamped here for a narrower reason: `build-page.mjs` writes the `og:` and
 * `twitter:` tags into the three documents it generates itself, and cannot reach the twenty-two
 * Vite builds under `/x/` and `/g/`. Those are the pages somebody shares when they mean *look at
 * this one*, and without a card they arrive as a bare link like everything else did.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The measurement ID for lattice.aniruddh.tech. */
const MEASUREMENT_ID = 'G-297ZBRFQ2G';

const TAG = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${MEASUREMENT_ID}');
</script>`;

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/**
 * @param {string} dist absolute path to the built site
 * @returns {number} how many pages were stamped
 */
export function injectAnalytics(dist) {
  const pages = htmlFiles(dist);
  if (pages.length === 0) throw new Error(`injectAnalytics: no .html under ${dist}. Build first.`);

  let stamped = 0;
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    if (html.includes(MEASUREMENT_ID)) continue; // already stamped; the step is safe to re-run

    // Two spellings, both legal. The generated pages open a literal <head>; the three games under
    // `from-one-sentence/` omit <html> and <head> entirely and lean on the parser's implicit head,
    // which is where a <script> before any body content lands anyway. Those three ship unedited on
    // purpose, so meeting them where they are — rather than editing them into a shape this step
    // finds convenient — is the whole reason this runs over `dist/` and not over the sources.
    const head = html.indexOf('<head>');
    const doctype = html.toLowerCase().indexOf('<!doctype html>');
    let at;
    if (head !== -1) at = head + '<head>'.length;
    else if (doctype !== -1) at = doctype + '<!doctype html>'.length;
    else {
      throw new Error(
        `injectAnalytics: ${relative(dist, page)} has neither a <head> nor a doctype, so there is ` +
          `no position that is certainly inside the head. Teach this step how that producer spells it.`,
      );
    }

    writeFileSync(page, html.slice(0, at) + '\n' + TAG + html.slice(at));
    stamped++;
  }
  return stamped;
}

export { MEASUREMENT_ID };

/** The canonical origin, read from the manifest rather than typed a third time. */
function siteUrl() {
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  return JSON.parse(readFileSync(join(dirname(repo), '.lattice/kit.json'), 'utf8')).homepage;
}

/**
 * Give the Vite-built exhibit and game pages a share card.
 *
 * They share one image rather than each having its own. Twenty-two captures at forty-one seconds
 * of real exhibit time apiece is fifteen minutes added to every build, to distinguish cards that a
 * reader sees one of. The title is per-page and comes from the page's own `<title>`, which its
 * author wrote; the picture says Lattice, which is the true thing the picture is for.
 *
 * @param {string} dist absolute path to the built site
 * @returns {number} how many pages were stamped
 */
export function injectSocial(dist) {
  const origin = siteUrl();
  let stamped = 0;
  for (const page of htmlFiles(dist)) {
    const html = readFileSync(page, 'utf8');
    if (html.includes('og:image')) continue; // build-page.mjs already wrote a better, per-page set

    const title = (html.match(/<title>([^<]*)<\/title>/) ?? [, 'Lattice'])[1];
    const route = `/${relative(dist, page).replace(/index\.html$/, '')}`;
    const desc = `${title} — an exhibit from Lattice, an isometric, deterministic, zero-asset game kit your coding agent knows how to use.`;
    const tags = [
      `<link rel="canonical" href="${origin}${route}">`,
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Lattice">',
      `<meta property="og:url" content="${origin}${route}">`,
      `<meta property="og:title" content="${title}">`,
      `<meta property="og:description" content="${desc}">`,
      `<meta property="og:image" content="${origin}/og.png">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${title}">`,
      `<meta name="twitter:description" content="${desc}">`,
      `<meta name="twitter:image" content="${origin}/og.png">`,
    ].join('\n');

    const head = html.indexOf('<head>');
    const doctype = html.toLowerCase().indexOf('<!doctype html>');
    const at = head !== -1 ? head + '<head>'.length : doctype !== -1 ? doctype + '<!doctype html>'.length : -1;
    if (at === -1) {
      throw new Error(`injectSocial: ${relative(dist, page)} has neither a <head> nor a doctype.`);
    }
    writeFileSync(page, `${html.slice(0, at)}\n${tags}${html.slice(at)}`);
    stamped++;
  }
  return stamped;
}
