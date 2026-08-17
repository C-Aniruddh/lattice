/**
 * The one real bridge from `@latticekit/draw` to the DOM.
 *
 * It draws nothing itself. It hands you a `Surface` — the same interface the world is painted
 * through — and turns what you painted into a `data:` URL for an `<img src>`, cached by a key
 * you choose. One code path for the building in the world and the building on the shop card is
 * what stops the two from ever drifting apart.
 *
 * Two failures are designed out rather than documented:
 *
 * 1. **The key does not name the brand hue, and `setBrand` invalidates.** The source game keyed
 *    on `${id}|${brand}|${w}x${h}` into an unbounded `Map` of `data:` URL strings, which never
 *    went stale and also grew without limit for a player who enjoyed the color picker. Keying
 *    on the brand is the fix for staleness and the cause of the leak; inverting it fixes both.
 * 2. **The device pixel ratio is clamped to 2.** A 3× phone painting a 240×140 card allocates a
 *    720×420 canvas and nine times the fill per shop item; twelve cards is a visible stall on
 *    the frame the shop opens, on exactly the hardware least able to absorb it.
 */

import { clamp, expectFinite } from '@latticekit/core';
import { createOffscreenSurface, hex, type Surface } from '@latticekit/draw';
import { hostPixelRatio } from './host.js';
import { internalsOf, type Overlay } from './overlay.js';

/** What to paint, and how big. */
export interface ThumbSpec {
  /** CSS pixels. The backing canvas is this times the effective `dpr`. */
  readonly width: number;
  /** CSS pixels. */
  readonly height: number;
  /** Device pixel ratio, clamped to [1, 2]. Default: the window's, clamped. Pin it to 1 in a
   *  test and the bytes are identical across machines. */
  readonly dpr?: number;
  /**
   * Painted before `paint` runs. A `#rgb`, `#rrggbb` or `#rrggbbaa` string — `@latticekit/draw`'s
   * color model parses those and nothing else, and a second parser here would be this package
   * holding a second opinion about what a color is. Default: transparent.
   */
  readonly background?: string;
  /**
   * Draw the thumbnail. The same `Surface` the world is drawn with, already scaled for `dpr`, so
   * `width` and `height` are CSS pixels.
   *
   * This must be **deterministic**: same key, same pixels. If your sprite jitters, seed it from
   * an `Rng` you construct here from the key, or hard-code the jitter — a card whose building
   * leans a different way on every reload is a card that makes the shop look broken.
   */
  readonly paint: (surface: Surface, width: number, height: number) => void;
}

/** A bounded, keyed set of painted thumbnails. */
export interface ThumbCache {
  /**
   * A `data:` URL for `<img src>`, painted once per key.
   *
   * The key must name **everything that changes the pixels** — the building id, its level, and
   * the size. It must **not** name the brand hue: `setBrand` invalidates every cache on the
   * overlay for you.
   *
   * @throws TypeError if `key` is empty.
   * @throws RangeError if `width`, `height` or `dpr` is not finite and positive.
   * @throws Error, from `@latticekit/draw`, if the host cannot give the canvas a 2D context.
   */
  url(key: string, spec: ThumbSpec): string;
  /** Drop everything. Called for you by `setBrand`. */
  invalidate(): void;
  /** How many keys are held. Never above `capacity`. */
  readonly size: number;
  /** Drop everything and unregister from the overlay. Idempotent. */
  destroy(): void;
}

/** Default capacity. A `data:` URL for a 240×140 card is tens of kilobytes of string, so this
 *  is about a megabyte and a half of cache in the worst case — a shop, not a world. */
const DEFAULT_CAPACITY = 64;

/**
 * A bounded thumbnail cache bound to an overlay.
 *
 * Least-recently-used eviction at `capacity`, default 64. Bound to the overlay so that
 * `setBrand` can invalidate it and `ui.destroy()` can drop it: a cache that outlives its
 * overlay is a megabyte of strings pinned by nothing anybody can name.
 *
 * @throws RangeError if `capacity` is below 1.
 */
export function thumbnails(ui: Overlay, capacity: number = DEFAULT_CAPACITY): ThumbCache {
  const internals = internalsOf(ui);
  const limit = Math.floor(expectFinite(capacity, 'thumbnails: capacity'));
  if (limit < 1) {
    throw new RangeError(`thumbnails: \`capacity\` must be at least 1, got ${String(capacity)}`);
  }

  /** Insertion-ordered, which is what makes eviction a `keys().next()` rather than a heap: a hit
   *  deletes and re-sets its key, so the front of the map is always the least recently used. */
  const entries = new Map<string, string>();

  const cache: ThumbCache = {
    url(key: string, spec: ThumbSpec): string {
      if (typeof key !== 'string' || key === '') {
        throw new TypeError(
          `thumbnails.url: \`key\` must be a non-empty string naming everything that changes the pixels, got ${JSON.stringify(key)}`,
        );
      }
      const hit = entries.get(key);
      if (hit !== undefined) {
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }

      const width = expectFinite(spec.width, 'thumbnails.url: width');
      const height = expectFinite(spec.height, 'thumbnails.url: height');
      if (width <= 0 || height <= 0) {
        throw new RangeError(
          `thumbnails.url: width and height must be greater than 0, got ${String(width)}×${String(height)}`,
        );
      }
      const requested =
        spec.dpr === undefined ? hostPixelRatio() : expectFinite(spec.dpr, 'thumbnails.url: dpr');
      const ratio = clamp(requested, 1, 2);

      const surface = createOffscreenSurface(width, height, { pixelRatio: ratio });
      // `begin` erases and then paints the clear color, so a transparent background is `0` and
      // not "leave whatever was there" — a detached canvas starts empty either way, but the one
      // code path is worth more than the one saved call.
      surface.begin(spec.background === undefined ? 0 : hex(spec.background));
      spec.paint(surface, width, height);
      surface.end();
      const url = surface.toDataUrl();

      entries.set(key, url);
      // The front of an insertion-ordered map is the least recently used, because a hit above
      // deletes and re-sets its key. One iteration, one delete, no heap.
      for (const oldest of entries.keys()) {
        if (entries.size <= limit) break;
        entries.delete(oldest);
      }
      return url;
    },

    invalidate(): void {
      entries.clear();
    },

    get size(): number {
      return entries.size;
    },

    destroy(): void {
      entries.clear();
      internals.caches.delete(cache);
      release();
    },
  };

  internals.caches.add(cache);
  const release = internals.scope.add(() => {
    entries.clear();
    internals.caches.delete(cache);
  });

  return cache;
}
