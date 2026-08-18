/**
 * Render a Lattice doc comment as HTML.
 *
 * These comments are not one-liners. Non-negotiable 5 asks every public symbol to explain a *why*,
 * and the result is prose with **tables**, fenced examples, numbered arguments and headings — the
 * `camera.ts` header alone carries a two-row table splitting position from policy, and the
 * `durations` note in `loop` is an RFC with a code block in it. Flattening that to plain text, or
 * printing the raw asterisks, throws away the half of the reference worth reading.
 *
 * So this is a small markdown renderer for exactly the subset those comments use, and nothing else:
 *
 * | | | |
 * |---|---|---|
 * | `## heading` | `- list` and `1. list` | `\| table \|` |
 * | ```` ```ts fenced code ```` | `> quote` | `` `code` `` |
 * | `**bold**` | `*italic*` | `[text](url)` |
 * | `{@link Symbol}` → a link to that symbol's entry | | |
 *
 * **Not a markdown library, and that is the point.** Adding one would be a dependency for a
 * document generator that already knows every construct its input contains, and the rule against
 * dependencies in this repository is worth honoring in a tool even though `site/` is not bound by
 * it. Anything unrecognized falls through as escaped text, which is the safe direction: an
 * unsupported construct reads as slightly-off prose rather than as broken markup.
 *
 * Escaping happens **first**, before any tag this file inserts, so a `<T>` in a signature or a
 * `&` in a comment cannot become markup and no substitution can double-escape what a previous one
 * produced.
 */

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inline spans, in one pass over already-escaped text.
 *
 * Code spans are lifted out first and put back last. Without that, `` `**ptr` `` — a real thing to
 * write about C — comes back bold, and a `{@link}` inside a code span becomes a link to a symbol
 * the author was quoting rather than referring to.
 *
 * `link` is how a `{@link Camera.zoom}` becomes an anchor: the page passes a function from a symbol
 * name to a URL, and a name it does not know stays `<code>`. Unresolvable rather than wrong — a
 * reference whose cross-links 404 is worse than one that does not link.
 */
function inline(text, link) {
  const spans = [];
  // The placeholder is delimited by a character the input cannot contain. A numeric one, put back
  // with `/ (\d+) /`, turns any bare number in the prose into an empty span — and these comments
  // are full of bare numbers.
  let out = esc(text).replace(/`([^`]+)`/g, (_m, code) => {
    spans.push(`<code>${code}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });

  out = out
    // `{@link Camera.zoom}`, `{@link zoomAt | anchored zoom}` and `{@link x the text}`.
    .replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g, (_m, target, label) => {
      const text_ = (label ?? '').trim() === '' ? target : label.trim();
      const href = link?.(target.split('.')[0] ?? target);
      const inner = `<code>${text_}</code>`;
      return href === undefined ? inner : `<a class="xref" href="${href}">${inner}</a>`;
    })
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|[./#][^)\s]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(—-])\*([^*\n]+)\*(?=$|[\s.,;:)—-])/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)] ?? '');
}

/** A fenced block, highlighted with the same four-token highlighter the landing page uses on its
 *  worked example, so a snippet looks the same in both documents. */
const fenced = (code, highlight) => `<pre class="code doc-code">${highlight === undefined ? esc(code) : highlight(code)}</pre>`;

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * Render one doc comment's prose.
 *
 * `heading` is the level a `##` in the comment becomes, because the same renderer runs at three
 * depths — a package introduction sits under an `h2`, a module's under an `h3`, a symbol's under
 * an `h4` — and a document whose headings skip levels is one a screen reader cannot outline.
 */
export function docHtml(md, { heading = 4, link, highlight } = {}) {
  if (md === undefined || md.trim() === '') return '';
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  const h = (n) => Math.min(6, heading + n);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    // fenced code
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence !== null) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(fenced(body.join('\n'), highlight));
      continue;
    }

    // heading
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head !== null) {
      const level = h(head[1].length - 2);
      out.push(`<h${level}>${inline(head[2], link)}</h${level}>`);
      i++;
      continue;
    }

    // table — a row followed by a `|---|` divider, which is what tells it from a paragraph that
    // happens to start with a pipe.
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && isTableRow(lines[i])) body.push(cells(lines[i++]));
      const th = header.map((c) => `<th>${inline(c, link)}</th>`).join('');
      const rows = body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c, link)}</td>`).join('')}</tr>`)
        .join('');
      // Every table here scrolls inside its own box: these are dense, and a reference read on a
      // phone must never scroll the document sideways.
      out.push(`<div class="scroller"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`);
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${docHtml(body.join('\n'), { heading, link, highlight })}</blockquote>`);
      continue;
    }

    // list — bullets or numbers, with wrapped continuation lines folded into the item they belong
    // to. These comments wrap at a hundred columns, so almost every item has one.
    const bullet = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet !== null) {
      const ordered = /\d/.test(bullet[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m !== null) { items.push(m[3]); i++; continue; }
        if (lines[i].trim() === '' || !/^\s+\S/.test(lines[i])) break;
        items[items.length - 1] = `${items[items.length - 1]} ${lines[i].trim()}`;
        i++;
      }
      const li = items.map((t) => `<li>${inline(t, link)}</li>`).join('');
      out.push(ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>`);
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(\s*```|#{1,6}\s|>\s?)/.test(lines[i]) &&
           !(isTableRow(lines[i]) && isDivider(lines[i + 1] ?? '')) &&
           !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length > 0) out.push(`<p>${inline(para.join('\n'), link)}</p>`);
    else i++;
  }

  return out.join('\n');
}

/** The first sentence, for a list a reader is scanning rather than reading. Markdown is stripped
 *  down to plain text here on purpose: a summary line in a sidebar is not the place for a table. */
export function summarize(md, max = 120) {
  const flat = String(md ?? '')
    .split('\n\n')[0]
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, '$1')
    .replace(/[*`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const stop = flat.search(/\.\s|\.$/);
  const one = stop === -1 ? flat : flat.slice(0, stop + 1);
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
