/**
 * **`@browser-only`** — the two things `/reference/` needs that a static document cannot do:
 * find a symbol without scrolling, and say where in 540 of them the reader currently is.
 *
 * It is a separate module from `page.ts` because it is a separate document's behavior. The landing
 * page has a hero, a gallery budget and a day cycle and none of that appears here; the reference
 * has a filter over a list nobody can scan by eye and nothing like it appears there.
 *
 * **Nothing here is required to read the page.** The filter is `js-only` in the markup, so with
 * script off the list is a complete index of every symbol with every link live — longer to read
 * and not broken, which is what `docs/GALLERY.md` means by honest rather than graceful.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────
 * The filter.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A substring match over a key the generator wrote into the markup.
 *
 * The key is `name kind package module`, already lowercased at build time, so a query matches any
 * of them: `camera` finds `createCamera` and everything in `camera.ts`, `interface` finds the
 * types, `iso` finds the package. Typing the wrong one of those three is the common case and
 * costing the reader a second for it would be the whole feature failing.
 *
 * Substring rather than fuzzy: a reference is read by somebody who half-remembers a name, and
 * fuzzy matching answers `pathSample` for `pse`, which looks like a bug the first time it happens
 * to be wrong.
 */
function wireFinder(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('[data-finder-input]');
  const count = root.querySelector<HTMLElement>('[data-finder-count]');
  const empty = root.querySelector<HTMLElement>('[data-finder-empty]');
  if (input === null) return;
  const items = [...root.querySelectorAll<HTMLElement>('[data-key]')];
  const groups = [...root.querySelectorAll<HTMLElement>('[data-group]')];

  const apply = (): void => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const item of items) {
      const hit = q === '' || (item.dataset['key'] ?? '').includes(q);
      item.hidden = !hit;
      if (hit) shown++;
    }
    // A module heading over nothing is worse than no heading: it reads as a module with no
    // matching symbols in it, which is exactly what it is not.
    for (const g of groups) g.hidden = [...g.querySelectorAll<HTMLElement>('[data-key]')].every((i) => i.hidden);
    if (count !== null) count.textContent = String(shown);
    if (empty !== null) empty.hidden = shown > 0;
    root.dataset['filtered'] = q === '' ? 'no' : 'yes';
  };

  input.addEventListener('input', apply);
  // Enter opens the only thing left, which is what a reader who typed a whole name wants and the
  // reason they typed the whole name.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; apply(); return; }
    if (e.key !== 'Enter') return;
    const first = items.find((i) => !i.hidden)?.querySelector('a');
    if (first !== null && first !== undefined) { e.preventDefault(); first.click(); }
  });
  apply();

  // `/` is the shortcut every documentation site has trained this reader to try, and it costs one
  // listener. Never while they are typing in something else.
  addEventListener('keydown', (e) => {
    const target = e.target;
    const typing = target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.focus(); input.select(); }
  });
}

for (const root of document.querySelectorAll<HTMLElement>('[data-finder]')) wireFinder(root);

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Where the reader is, in the sidebar.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Mark the symbol currently being read in the rail, and keep that mark visible.
 *
 * A hundred entries do not fit in a viewport, so a rail that highlights an entry scrolled out of
 * its own box is a rail that appears to highlight nothing. The nav is scrolled by hand rather than
 * with `scrollIntoView`, which on a sticky element also scrolls the *document* — the reader
 * scrolls down, the rail catches up, and the page jumps under them.
 *
 * `IntersectionObserver` rather than a scroll handler because the entries are far apart and the
 * question is only ever asked when one crosses the line, and the line is a third of the way down
 * for the same reason `page.ts`'s spy uses that number: a heading whose first pixel has appeared
 * is not the thing anybody is reading.
 */
const nav = document.querySelector<HTMLElement>('[data-symbol-nav]');
const entries = [...document.querySelectorAll<HTMLElement>('article.sym[id]')];
if (nav !== null && entries.length > 0 && 'IntersectionObserver' in window) {
  const links = new Map<string, HTMLAnchorElement>();
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    links.set(decodeURIComponent(a.getAttribute('href')?.slice(1) ?? ''), a);
  }
  const visible = new Set<string>();
  let marked = '';

  const mark = (): void => {
    // The **last** entry in document order that is still in the band, not the first.
    //
    // An interface with twenty documented members is four screens tall, so while the reader
    // arrives at the function underneath it both are in the band — and taking the first marks the
    // one they have finished reading. The last is the one whose heading they most recently passed,
    // which is the same rule a table of contents follows.
    let current = marked;
    for (const e of entries) if (visible.has(e.id)) current = e.id;
    if (current === marked) return;
    const previous = links.get(marked);
    if (previous !== undefined) previous.removeAttribute('aria-current');
    marked = current;
    const link = links.get(current);
    if (link === undefined) return;
    link.setAttribute('aria-current', 'true');
    // Measured rather than added up from `offsetTop`: the rail is `position: sticky`, so whether
    // it is the link's `offsetParent` depends on the layout the media query picked, and the
    // version of this that did the arithmetic left the mark permanently off screen at desktop
    // width — the one width it was written for.
    const box = nav.getBoundingClientRect();
    const here = link.getBoundingClientRect();
    if (here.top < box.top + 8) nav.scrollTop += here.top - box.top - 8;
    else if (here.bottom > box.bottom - 8) nav.scrollTop += here.bottom - box.bottom + 8;
  };

  const observer = new IntersectionObserver(
    (records) => {
      for (const r of records) {
        if (r.isIntersecting) visible.add(r.target.id);
        else visible.delete(r.target.id);
      }
      mark();
    },
    // A band from the top of the viewport to a third of the way down: an entry is "being read"
    // when its heading is in the top third, which is where a reader's eye sits.
    { rootMargin: '0px 0px -66% 0px' },
  );
  for (const e of entries) observer.observe(e);
}
