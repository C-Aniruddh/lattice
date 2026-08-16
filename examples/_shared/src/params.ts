/**
 * **`@browser-only`** — the URL is the gallery's only storage, and this is all of it.
 *
 * Every exhibit takes its seed from the query string and every panel control writes its value
 * there, so a configuration is a link: the one that made the valley look good, and the one
 * attached to a bug report. There is no `localStorage` anywhere in the gallery, deliberately —
 * a visitor who opens a shared link must see what the sender saw, and a stored preference that
 * quietly overrides a pasted URL makes that impossible to reason about.
 *
 * ## Two things this file exists to get right
 *
 * **Only non-default values are written.** A panel with thirty controls that stamped all thirty
 * into the address bar would make every link unreadable and every diff between two links
 * useless. `put` removes a key whose value has returned to its default, so a URL always reads
 * as *the list of things that differ from the exhibit as shipped*.
 *
 * **Writes are coalesced.** Dragging one slider emits an `input` event per pointer move — a
 * hundred of them in a second. Safari rate-limits `history.replaceState` (historically ~100
 * calls per 30 s) and *throws* past the limit, which would turn a slider drag into an
 * unhandled exception on one browser and nowhere else. So values are collected and written on
 * a trailing timer; the URL is correct a quarter-second after you stop moving, which is a
 * quarter-second before anyone could have copied it.
 *
 * Both the search string and the hash are read, because a static host that rewrites paths
 * frequently leaves only the hash intact, and `?seed=` failing silently on the deployed
 * gallery while working locally is precisely the class of bug nobody finds.
 */

/** How long to wait after the last change before touching the address bar. See the header. */
const WRITE_DEBOUNCE_MS = 250;

/** The panel's view of the URL: read at boot, written back as controls move. */
export interface Params {
  /** Every key present at boot, for a control that wants to know whether it was pinned. */
  has(key: string): boolean;

  /**
   * A number from the URL, or `fallback` when the key is absent **or unparseable**.
   *
   * Unparseable rather than throwing, because the input is a string a stranger pasted. A
   * malformed link should open the exhibit as shipped, not a stack trace.
   */
  num(key: string, fallback: number): number;

  /** `1`/`true`/`yes`/`on` are true, `0`/`false`/`no`/`off` are false, anything else is `fallback`. */
  bool(key: string, fallback: boolean): boolean;

  /** A string from the URL, or `fallback` when the key is absent or empty. */
  str(key: string, fallback: string): string;

  /**
   * Record a value.
   *
   * Writes the key when `value` differs from `fallback` and **removes it when it matches**, so
   * the address bar is always the shortest description of this configuration. Numbers are
   * rounded to six significant figures first: a slider's `0.6200000000000001` in a shared link
   * is noise that makes two identical configurations look different.
   */
  put(key: string, value: number | string | boolean, fallback: number | string | boolean): void;

  /** Write pending changes now rather than on the timer. For a test, and for a page unload. */
  flush(): void;
}

/** Trim a float to something a human can read in an address bar without changing what it means
 *  at slider resolution. `parseFloat` of the result round-trips to the same rendered value. */
function tidy(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toPrecision(6)));
}

/** One canonical string per value, so `put` can compare against the default without caring
 *  whether the caller passed `1` or `'1'`. */
function encode(value: number | string | boolean): string {
  if (typeof value === 'number') return tidy(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return value;
}

/**
 * Read the current URL.
 *
 * Query string first, then the fragment, so `#seed=x` works on a host that has eaten the
 * query. A key present in both takes its query value: the more explicit of the two wins.
 */
export function readParams(): Params {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const get = (key: string): string | null => search.get(key) ?? hash.get(key);

  /** Pending writes, keyed by param. `null` means "remove this key". */
  const pending = new Map<string, string | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function write(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.size === 0) return;
    const next = new URLSearchParams(location.search);
    for (const [key, value] of pending) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    pending.clear();
    const query = next.toString();
    const url = `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`;
    try {
      history.replaceState(history.state, '', url);
    } catch {
      // Safari's rate limiter, or a sandboxed iframe with an opaque origin. Neither is worth
      // taking the exhibit down for: the panel still works, the link just stops updating.
    }
  }

  return {
    has(key) {
      return get(key) !== null;
    },
    num(key, fallback) {
      const raw = get(key);
      if (raw === null || raw === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    },
    bool(key, fallback) {
      const raw = get(key);
      if (raw === null) return fallback;
      if (raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
      if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
      return fallback;
    },
    str(key, fallback) {
      const raw = get(key);
      return raw === null || raw === '' ? fallback : raw;
    },
    put(key, value, fallback) {
      const encoded = encode(value);
      pending.set(key, encoded === encode(fallback) ? null : encoded);
      if (timer === undefined) timer = setTimeout(write, WRITE_DEBOUNCE_MS);
    },
    flush: write,
  };
}
