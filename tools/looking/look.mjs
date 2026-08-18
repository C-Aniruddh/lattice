#!/usr/bin/env node
/**
 * **Looking, reduced to measurement.** Renders a running page in headless Chrome and returns
 * numbers about the frame instead of a picture of it — so that an agent which cannot see an
 * image can still act on what is wrong with one.
 *
 * This exists because of a real result. Three agents were given one sentence and an empty
 * directory. The one that could look at its game caught four defects a compiler cannot see: a
 * viewport fitted to a tile rectangle so half the frame was empty ocean, a HUD drawn in the
 * game's night ink so three rows were black on black, light pools landing at the elevation they
 * were given rather than the ground they lit, and a flat price that made losing the cheapest
 * way to play. The one that could not look shipped near-black roofs and a small diorama in an
 * empty frame. **Three of those six have a signature in a histogram, and this script finds those
 * three.** The other three are named below, under what it does not catch, because a harness that
 * claimed all six would be the same mistake as a suite that passes over a black screen.
 *
 * **No dependencies, by design.** It speaks the Chrome DevTools Protocol over a WebSocket it
 * implements itself and decodes PNG with `node:zlib`, so it runs in a directory whose
 * `node_modules` has just been created by `npm create vite`, with no second install, no network,
 * and no version of puppeteer to keep in step with a browser.
 *
 * ## What it catches
 *
 * | reading | the failure it names |
 * |---|---|
 * | `anything` | a flat field of one color — the black screen, however it was reached |
 * | `framing` | a world that is a small diamond in a big empty frame. Measured at **99%** on the diorama the blind run shipped and **29%** on a world that fills the viewport, so the gap is not subtle |
 * | `motion` | a static first frame — a screenshot of a game rather than a game |
 * | `legibility` | HUD text that cannot be read against what is behind it. The black-on-black rows measure **contrast 1.03** against a required 3, and every node that clears 3 but misses WCAG AA is named in the same row without failing it |
 * | `console` | the exceptions and warnings a screenshot cannot show you |
 *
 * Note what `anything` is **not**: there is no brightness floor. A night game is legitimately
 * dark, and a threshold on mean luminance would fail exactly the games this kit is best at. The
 * black-screen test is flatness — one color and a rounding error — not darkness.
 *
 * ## What it does not catch, stated as plainly as what it does
 *
 * It has no opinion about whether the picture is any **good**. It cannot tell a lighthouse from
 * a grain silo, cannot judge silhouette or palette, and cannot see whether the beam sweeps the
 * way the sentence promised. A bright, busy, moving frame of complete nonsense passes every row.
 *
 * Specifically, of the six defects that prompted it, **three are outside its reach**:
 *
 * - **A roof painted in the outline slot**, so it renders near-black. This was tried and
 *   withdrawn. Anchored to the modal color it fires on every well-framed night scene, because
 *   once the world fills the frame the modal color is a lit tile and the sea is legitimately
 *   darker than it. A measure that is red on good frames trains an agent to ignore the report,
 *   which is worse than not measuring. **That defect is closed at source instead** — see the
 *   fills-versus-outlines slot table at the top of the `art` skill.
 * - **A light pool landing at the wrong elevation.** The frame is lit, the pool is round, the
 *   numbers are ordinary; only knowing what was *meant* to be lit distinguishes it.
 * - **A price curve that makes losing cheapest.** Not a picture at all. No frame of any game
 *   has ever had a signature for it.
 *
 * And three standing blind spots in the readings it does take:
 *
 * - **Depth and density** — two of the five rows in `looking.md` — are not in here. Nothing in a
 *   pixel histogram distinguishes four hundred huts from thirty. `--eval 'order.count'` is how
 *   you ask the game itself, and that is the intended answer rather than a workaround.
 * - **Motion is one second of wall clock.** A game whose only animation is a thirty-second day
 *   cycle reads as static and is not.
 * - **Text is found in the DOM.** A HUD painted into the canvas has no nodes, so `legibility`
 *   reports zero nodes — which is not the same as passing, and prints as its own sentence.
 *
 * So it is a floor, not a verdict: is there a frame, is anything moving in it, can the writing be
 * read, did anything throw. That is the whole of what the blind agent got wrong at the level a
 * number can see, and none of what makes a game worth playing.
 *
 * ## Use
 *
 * ```bash
 * node tools/looking/look.mjs http://localhost:5173
 * node tools/looking/look.mjs http://localhost:5173 --json --out shots/
 * node tools/looking/look.mjs http://localhost:5173 --eval 'window.__lattice.order.count'
 * node tools/looking/look.mjs http://localhost:5173 --advance 30s          # half a day later
 * node tools/looking/look.mjs http://localhost:5173 --at '__lattice.setHour(3)'
 * ```
 *
 * ## Choosing the hour rather than accepting it
 *
 * A day cycle has a worst hour and an author sees whichever hour was on screen when they looked.
 * One stranger's game was verified by its author at dawn, where it is lovely, and measured **84%
 * of the frame near-black across 98% of the border** when this script was later pointed at the
 * same build. Nothing was flaky; the clock had moved.
 *
 * So there are two ways to say *when*, and both are the `--eval` path with the timing moved:
 *
 * - `--advance DURATION` shifts the page's wall clock forward — `Date.now()` and `new Date()` —
 *   with the patch installed **before the first line of the page runs**, so the game is born at
 *   that hour rather than jolted to it. (Applying it after load instead makes any "has the day
 *   rolled over?" latch fire on the jump. Measured on the orchard above: the same shift applied
 *   mid-run opens its end-of-day panel over the scene, and the report then describes the panel —
 *   `motion 0.00%`, six legibility rows failing against a scrim — rather than the game.)
 * - `--at EXPRESSION` runs an expression in the page after load and before the capture, on the
 *   same `Runtime.evaluate` call `--eval` already uses. For a game that exposes its own phase.
 *
 * **`--advance` is narrow, and knowingly so.** It reaches a cycle read off the wall clock —
 * `(Date.now() % DAY_MS) / DAY_MS`, which is the shape a game with offline progress already has.
 * It does **not** reach a cycle accumulated from `dt` inside `loop.onUpdate`, and cannot: the loop
 * clamps a jump to `maxCatchUpMs` (250 ms) on purpose, so a shifted monotonic clock would buy
 * 250 ms of daylight and a corrupted `worstGapMs` reading. Those games need `--at` and a hook.
 * An expression that throws exits `2` — being unable to reach the hour you asked for is a failure
 * to look, never a passing game.
 *
 * Exit code is `0` when every row passed, `1` when a row failed (so `&&` works), and `2` when
 * the script itself could not run — a missing Chrome is a `2`, never a `1`, because "I could not
 * look" and "I looked and it is broken" are different sentences and an agent must not confuse
 * them.
 *
 * `--out DIR` writes `frame-a.png` and `frame-b.png`. An agent that *can* see images should pass
 * it and then open them: the numbers are the floor and the picture is the ceiling, and this
 * script is the same rung of the ladder either way.
 *
 * Impure by nature: spawns a browser, opens a socket, writes files.
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Finding Chrome
// ---------------------------------------------------------------------------

/**
 * Where a browser might be, in the order worth trying.
 *
 * `CHROME_PATH` is first because it is the one a user can fix without editing this file, and the
 * environments where the guesses fail — a CI image, a container, a Linux distribution with its
 * own naming — are exactly the ones that set it.
 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/** The first browser on disk, or `null`. Exported shape so preflight can ask the same question. */
export function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A WebSocket client, because CDP needs one and a dependency would cost more
// ---------------------------------------------------------------------------

/**
 * Enough of RFC 6455 to talk to a browser on loopback: text frames, continuation frames, ping,
 * close. No permessage-deflate, no extensions, no reconnection.
 *
 * It is here rather than in a package because the alternative is `ws` — and the whole promise of
 * this script is that it runs in a directory that has just been scaffolded, before anyone has
 * been asked to install anything. Ninety lines is cheaper than that ask.
 *
 * The one non-obvious rule: a client **must** mask every frame it sends and a server **must not**
 * mask what it sends back. Get that backwards and Chrome closes the socket without a word.
 */
class MiniSocket {
  #socket;
  #buffer = Buffer.alloc(0);
  #fragments = [];
  #fragmentOpcode = 0;
  #onMessage;
  #onClose;

  constructor(socket, onMessage, onClose) {
    this.#socket = socket;
    this.#onMessage = onMessage;
    this.#onClose = onClose;
    socket.on('data', (chunk) => this.#feed(chunk));
    socket.on('close', () => onClose());
    socket.on('error', () => onClose());
  }

  /** Open a connection to `ws://host:port/path`, resolving once the handshake is accepted. */
  static open(url, onMessage, onClose) {
    const parsed = new URL(url);
    const key = randomBytes(16).toString('base64');
    const expected = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    return new Promise((resolve, reject) => {
      const socket = connect(
        { host: parsed.hostname, port: Number(parsed.port || 80) },
        () => {
          socket.write(
            `GET ${parsed.pathname}${parsed.search} HTTP/1.1\r\n` +
              `Host: ${parsed.host}\r\n` +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              `Sec-WebSocket-Key: ${key}\r\n` +
              'Sec-WebSocket-Version: 13\r\n\r\n',
          );
        },
      );
      socket.setNoDelay(true);

      let head = Buffer.alloc(0);
      const onHead = (chunk) => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf('\r\n\r\n');
        if (end === -1) return;
        const headers = head.subarray(0, end).toString('latin1');
        socket.removeListener('data', onHead);
        if (!/^HTTP\/1\.1 101/.test(headers)) {
          socket.destroy();
          reject(new Error(`look: the browser refused the debugger handshake — ${headers.split('\r\n')[0]}`));
          return;
        }
        if (!headers.toLowerCase().includes(expected.toLowerCase())) {
          socket.destroy();
          reject(new Error('look: the debugger handshake did not verify (Sec-WebSocket-Accept mismatch)'));
          return;
        }
        const wire = new MiniSocket(socket, onMessage, onClose);
        const rest = head.subarray(end + 4);
        if (rest.length) wire.#feed(rest);
        resolve(wire);
      };
      socket.on('data', onHead);
      socket.on('error', (err) => reject(new Error(`look: could not reach the browser debugger — ${err.message}`)));
    });
  }

  send(text) {
    const payload = Buffer.from(text, 'utf8');
    const mask = randomBytes(4);
    const length = payload.length;
    const header =
      length < 126 ? Buffer.alloc(6)
      : length < 65536 ? Buffer.alloc(8)
      : Buffer.alloc(14);

    header[0] = 0x81; // FIN + text
    if (length < 126) {
      header[1] = 0x80 | length;
      mask.copy(header, 2);
    } else if (length < 65536) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
      mask.copy(header, 4);
    } else {
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(length, 6);
      mask.copy(header, 10);
    }

    const masked = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) masked[i] = payload[i] ^ mask[i & 3];
    this.#socket.write(Buffer.concat([header, masked]));
  }

  close() {
    try {
      this.#socket.destroy();
    } catch {
      /* the process is going away anyway */
    }
  }

  #feed(chunk) {
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : chunk;
    for (;;) {
      const frame = this.#readFrame();
      if (!frame) return;
      if (frame.opcode === 0x8) {
        this.#onClose();
        this.close();
        return;
      }
      if (frame.opcode === 0x9) continue; // a ping we do not need to answer on loopback
      if (frame.opcode === 0x0) {
        this.#fragments.push(frame.payload);
      } else {
        this.#fragments = [frame.payload];
        this.#fragmentOpcode = frame.opcode;
      }
      if (!frame.fin) continue;
      const whole = Buffer.concat(this.#fragments);
      this.#fragments = [];
      if (this.#fragmentOpcode === 0x1) this.#onMessage(whole.toString('utf8'));
    }
  }

  /** One frame off the front of the buffer, or `null` if it has not all arrived yet. */
  #readFrame() {
    const buf = this.#buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < 4) return null;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return null;
      const high = buf.readUInt32BE(2);
      if (high !== 0) throw new Error('look: the browser sent a frame larger than 4 GB, which cannot be right');
      length = buf.readUInt32BE(6);
      offset = 10;
    }
    if (masked) offset += 4;
    if (buf.length < offset + length) return null;

    const payload = buf.subarray(offset, offset + length);
    this.#buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }
}

// ---------------------------------------------------------------------------
// The protocol session
// ---------------------------------------------------------------------------

/**
 * A CDP connection to one page target.
 *
 * Attaching straight to the *page*'s socket rather than the browser's is deliberate: it removes
 * `Target.attachToTarget`, session ids, and the whole flattened-session dance, at the cost of
 * not being able to open a second tab. This script never wants a second tab.
 */
class Session {
  #wire;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();
  #dead = false;

  static async attach(wsUrl) {
    const session = new Session();
    session.#wire = await MiniSocket.open(
      wsUrl,
      (text) => session.#receive(text),
      () => session.#die(),
    );
    return session;
  }

  send(method, params = {}) {
    if (this.#dead) return Promise.reject(new Error('look: the browser closed the connection'));
    const id = this.#nextId++;
    const promise = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    this.#wire.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  on(method, handler) {
    const list = this.#listeners.get(method) ?? [];
    list.push(handler);
    this.#listeners.set(method, list);
  }

  close() {
    this.#wire?.close();
  }

  #receive(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const waiter = this.#pending.get(message.id);
      if (!waiter) return;
      this.#pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`look: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    for (const handler of this.#listeners.get(message.method) ?? []) handler(message.params);
  }

  #die() {
    this.#dead = true;
    for (const { reject } of this.#pending.values()) {
      reject(new Error('look: the browser closed the connection'));
    }
    this.#pending.clear();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chrome writes its chosen port here once the debugger is listening; poll until it appears. */
async function readDevToolsPort(userDataDir, timeoutMs) {
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf8').split('\n');
      if (port && Number(port) > 0) return Number(port);
    }
    await wait(50);
  }
  return null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// PNG, decoded here rather than shipped to the page and back
// ---------------------------------------------------------------------------

/**
 * Chrome's screenshot PNG → `{ width, height, data }` with four bytes per pixel.
 *
 * Only what a screenshot can actually be: bit depth 8, color type 2 or 6, no interlacing. A
 * general PNG decoder would be four times the size and would never be handed anything else.
 */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('look: the browser did not return a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      colorType = body[9];
      if (bitDepth !== 8) throw new Error(`look: unexpected PNG bit depth ${bitDepth}`);
      if (colorType !== 2 && colorType !== 6) throw new Error(`look: unexpected PNG color type ${colorType}`);
      if (body[12] !== 0) throw new Error('look: unexpected interlaced PNG');
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.allocUnsafe(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let src = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    raw.copy(line, 0, src, src + stride);
    src += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      line[i] = value & 0xff;
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
  }
  return { width, height, data: out };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// ---------------------------------------------------------------------------
// The measurements
// ---------------------------------------------------------------------------

/**
 * Relative luminance, 0..1, on sRGB values 0..255 — the WCAG definition, so that the contrast
 * numbers below mean the thing an accessibility checker would mean by them.
 *
 * @tier-b `Math.pow` is not bit-identical across engines. Nothing here is hashed or persisted;
 * these numbers are a report an agent reads once, so a last-bit disagreement is invisible.
 */
function luminance(r, g, b) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const contrastRatio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/**
 * The single color the frame is *mostly made of*, and how much of the frame that is.
 *
 * Colors are bucketed to five bits per channel before counting, because a sky with a gradient in
 * it is one background to a person and thirty thousand distinct colors to a histogram. Five bits
 * merges the gradient and keeps a lit roof separate from an unlit one, which is the distinction
 * that matters.
 */
function backgroundOf(frame) {
  const { width, height, data } = frame;
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey = 0;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  const modal = {
    r: ((bestKey >> 10) & 31) << 3,
    g: ((bestKey >> 5) & 31) << 3,
    b: (bestKey & 31) << 3,
  };

  // A second pass with a tolerance, so a dithered or gently-shaded background counts as one
  // thing. Without it a noise-textured sea reads as a busy frame and the emptiest possible
  // picture passes.
  //
  let near = 0;
  let edgeNear = 0;
  let edgeTotal = 0;
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  for (let y = 0; y < height; y++) {
    const onEdge = y < band || y >= height - band;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const isNear =
        Math.abs(data[i] - modal.r) <= 8 &&
        Math.abs(data[i + 1] - modal.g) <= 8 &&
        Math.abs(data[i + 2] - modal.b) <= 8;
      if (isNear) near++;
      if (onEdge || x < band || x >= width - band) {
        edgeTotal++;
        if (isNear) edgeNear++;
      }
    }
  }

  return {
    color: `#${[modal.r, modal.g, modal.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    fraction: near / (width * height),
    edges: edgeNear / edgeTotal,
    distinctColors: counts.size,
  };
}

/** Mean luminance over the whole frame and over each cell of a three-by-three grid. */
function luminanceOf(frame) {
  const { width, height, data } = frame;
  const grid = Array.from({ length: 9 }, () => ({ sum: 0, count: 0 }));
  let total = 0;
  for (let y = 0; y < height; y++) {
    const row = Math.min(2, Math.floor((y * 3) / height));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = luminance(data[i], data[i + 1], data[i + 2]);
      total += l;
      const cell = grid[row * 3 + Math.min(2, Math.floor((x * 3) / width))];
      cell.sum += l;
      cell.count++;
    }
  }
  return {
    mean: total / (width * height),
    grid: grid.map((cell) => Number((cell.sum / cell.count).toFixed(4))),
  };
}

/**
 * How much of the frame changed between the two captures.
 *
 * The threshold of eight is not arbitrary: below it, a dithered gradient and a video codec's
 * idea of "the same pixel" both register as motion, and every static frame passes.
 */
function motionBetween(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return { changedFraction: 1, meanDelta: 255, note: 'the frame resized between captures' };
  }
  let changed = 0;
  let deltaSum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
    deltaSum += delta;
    if (delta > 8) changed++;
  }
  const pixels = a.data.length / 4;
  return {
    changedFraction: changed / pixels,
    meanDelta: Number((deltaSum / pixels / 3).toFixed(3)),
  };
}

/**
 * Legibility of each visible text node, measured two ways because they fail differently.
 *
 * `contrast` is what the CSS *claims*: the node's own color against the color its rectangle is
 * mostly made of. `visibleRange` is what the pixels *do*: the spread between the dark and bright
 * ends of that rectangle. The first names the cause and the second cannot be argued with — a
 * node whose ink is a perfect match for the canvas behind it has a `visibleRange` near zero no
 * matter what any stylesheet says about it.
 */
function textLegibility(frame, nodes, scale) {
  const { width, height, data } = frame;
  return nodes.map((node) => {
    const x0 = Math.max(0, Math.floor(node.x * scale));
    const y0 = Math.max(0, Math.floor(node.y * scale));
    const x1 = Math.min(width, Math.ceil((node.x + node.w) * scale));
    const y1 = Math.min(height, Math.ceil((node.y + node.h) * scale));

    const lums = [];
    const counts = new Map();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        lums.push(luminance(data[i], data[i + 1], data[i + 2]));
        const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    if (lums.length === 0) {
      return { text: node.text, note: 'off screen', visibleRange: 0, contrast: 0 };
    }
    lums.sort((a, b) => a - b);
    const at = (q) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))];

    let bestKey = 0;
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    const groundLum = luminance(((bestKey >> 10) & 31) << 3, ((bestKey >> 5) & 31) << 3, (bestKey & 31) << 3);
    const inkLum = luminance(node.color[0], node.color[1], node.color[2]);

    return {
      text: node.text.length > 40 ? `${node.text.slice(0, 39)}…` : node.text,
      fontPx: node.fontPx,
      fontWeight: node.fontWeight,
      visibleRange: Number((at(0.97) - at(0.03)).toFixed(4)),
      contrast: Number(contrastRatio(inkLum, groundLum).toFixed(2)),
    };
  });
}

/**
 * Every visible text node's rectangle, ink color and size, gathered in the page.
 *
 * It walks text nodes rather than elements because a HUD row is a `<span>` inside a `<div>`
 * inside the overlay root, and measuring the outer box would average the ink over a rectangle
 * that is mostly not text — which is how a black-on-black row scores as fine.
 */
const COLLECT_TEXT = `(() => {
  const out = [];
  const viewport = { w: innerWidth, h: innerHeight };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (!text) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.1) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;
    // Chrome serializes a color-mix() as \`color(srgb 0.61 0.69 0.78 / 0.72)\` — components in
    // 0..1 — and everything else as \`rgb(157, 176, 200)\` — components in 0..255. Reading the
    // digits and assuming bytes scored an ordinary color-mix ink as near-black, which reported
    // a real 3.46 as 1.96. The unit is not in the numbers, it is in the function name.
    const raw = style.color.trim();
    const parts = raw.match(/-?[\\d.]+(?:e-?\\d+)?/g) || ['0','0','0'];
    const unit = raw.startsWith('color(') ? 255 : 1;
    out.push({
      text,
      x: rect.left, y: rect.top, w: rect.width, h: rect.height,
      fontPx: Math.round(parseFloat(style.fontSize)),
      // Weight comes back as a keyword on some elements and a number on others; \`bolder\` and
      // \`lighter\` are relative and only \`getComputedStyle\` on the used value resolves them, which
      // it does. Anything that does not parse is treated as normal, because guessing bold would
      // relax the floor on the one node whose styling we could not read.
      fontWeight: Number(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400),
      color: [Number(parts[0]) * unit, Number(parts[1]) * unit, Number(parts[2]) * unit],
    });
  }
  return { viewport, nodes: out.slice(0, 60) };
})()`;

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Thresholds, in one place and with the reason attached, because every one of them is a judgment
 * call somebody will want to argue with — and should be able to, by editing four numbers rather
 * than reading four hundred lines.
 */
const LIMITS = {
  /**
   * More than this much of the frame being one color is the empty-ocean failure.
   *
   * Set at 0.6 rather than lower because an isometric world is a *diamond*: even a map that
   * overflows the viewport leaves the four corners as background, and a well-framed one measured
   * here sits near 0.4. The two agents that got this wrong measured 0.99 and 0.97, so the gap is
   * wide and the threshold does not have to be clever.
   */
  backgroundFraction: 0.6,
  /**
   * Fewer distinct colors than this and nothing was drawn — the black-screen failure, however it
   * was reached. Deliberately *not* a luminance floor: a night game is legitimately dark, and a
   * brightness threshold would fail exactly the games this kit is best at. Sixteen five-bit
   * buckets is a low bar that an antialiased single-color page does not clear and any drawn
   * world clears immediately, which keeps this row independent of `framing` — one asks whether
   * anything was painted, the other whether it filled the frame.
   */
  distinctColors: 16,
  /** Below this, nothing moved in a second and the first frame is a photograph. */
  changedFraction: 0.001,
  /**
   * **The floor that fails a row, and it is deliberately not WCAG AA.**
   *
   * AA is 4.5 for normal text, and the `hud` skill teaches 4.5 as the number to *design* to. This
   * is 3, and the gap between the two is the difference between a design floor and a verdict.
   *
   * It was left at 3 on a guess and is now at 3 on evidence. Every text node in fourteen games —
   * this kit's eleven exhibits and the three a stranger's agent built blind — was measured at four
   * points of a day cycle: 660 readings. **Two exhibits that pass every row today live between 3
   * and 4.5**: `endless` reads its own frame time at **3.26**, and `crowd` puts its entire label
   * row — `PEOPLE`, `ON SCREEN`, `FRAME`, `WORST FRAME / 10 s`, `STATE PER PERSON`, `WORLD TIME` —
   * at **4.16**, its readouts at **3.93** and its caption at **4.16**. Moving the floor to 4.5
   * would turn `endless` red for the first time and take `crowd` from one failing node to
   * thirty-six, on two exhibits nobody thinks are broken. A row that is red when things are right
   * is a row an agent learns to skip, and that principle has already killed two earlier measures
   * here.
   *
   * **The size distinction does not rescue them either.** WCAG relaxes to 3 for large text — 24 px,
   * or 19 px bold — and every node in that band is 9 to 15 px, so the exemption applies to none of
   * them. Across all 660 readings it changes **zero** verdicts: the only node in the corpus at
   * 24 px or over is `terraces`'s `319 px` at 30 px/800, which measures 4.58 and clears both
   * floors. So the size rule is not in this threshold, where it would be inert; it is in the
   * advisory below, where it is what stops a legitimately large heading being nagged about.
   */
  textContrast: 3,
  /**
   * WCAG AA, reported and never failed.
   *
   * A passing `legibility` row says nothing is invisible; it does not say anything is easy to read,
   * and an agent that reads only the verdict column cannot tell those apart. So the nodes that
   * clear the floor and miss AA are **named in the detail with no verdict of their own** — the same
   * treatment the hour gets in the heading, and for the same reason: a line that reports a fact
   * rather than a pass is a line that must not have a verdict column it can never earn.
   */
  textContrastAA: 4.5,
  /** WCAG's large-text sizes, at which AA relaxes to {@link LIMITS.textContrast}. */
  largeTextPx: 24,
  largeBoldPx: 19,
  largeBoldWeight: 700,
  /** Ink and ground within this much luminance of each other is invisible, whatever CSS says. */
  textVisibleRange: 0.04,
};

/**
 * The AA floor for one node: 3 if WCAG calls it large text, 4.5 otherwise.
 *
 * `fontWeight` is a resolved number by the time it reaches here — `getComputedStyle` turns `bold`
 * and `bolder` into one — and anything unreadable is treated as 400, because guessing bold would
 * relax the bar on exactly the node whose styling could not be read.
 */
function aaFloorFor(node) {
  const px = node.fontPx ?? 0;
  const weight = node.fontWeight ?? 400;
  const large = px >= LIMITS.largeTextPx || (px >= LIMITS.largeBoldPx && weight >= LIMITS.largeBoldWeight);
  return large ? LIMITS.textContrast : LIMITS.textContrastAA;
}

/**
 * `30s`, `1500ms`, `2m`, or a bare number of milliseconds → milliseconds.
 *
 * A duration with no unit is milliseconds because that is what every other number on this command
 * line is; a duration with the wrong unit is a `2` rather than a silent thousandfold miss.
 */
function parseDuration(text) {
  const match = /^(-?\d+(?:\.\d+)?)(ms|s|m)?$/.exec(String(text).trim());
  if (!match) {
    throw Object.assign(
      new Error(`look: --advance wants a duration like 30s, 1500ms or 2m — got ${String(text)}`),
      { fatal: true },
    );
  }
  const scale = match[2] === 's' ? 1000 : match[2] === 'm' ? 60_000 : 1;
  return Number(match[1]) * scale;
}

/**
 * The wall clock, moved. Installed at document start so the page is *born* at that hour.
 *
 * Only `Date` — deliberately. `performance.now()` is the monotonic clock the loop measures itself
 * with, and shifting it neither advances a `dt`-accumulated cycle (the loop's catch-up clamp eats
 * the jump) nor leaves `worstGapMs` worth reading.
 */
const clockShift = (ms) => `(() => {
  const SHIFT = ${ms};
  const RealDate = Date;
  const now = () => RealDate.now() + SHIFT;
  function ShiftedDate(...args) {
    if (new.target === undefined) return new RealDate(now()).toString();
    return args.length === 0 ? new RealDate(now()) : new RealDate(...args);
  }
  ShiftedDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(ShiftedDate, RealDate);
  ShiftedDate.now = now;
  globalThis.Date = ShiftedDate;
})()`;

function parseArgs(argv) {
  const args = {
    url: null,
    out: null,
    evals: [],
    at: [],
    advanceMs: 0,
    json: false,
    settleMs: 1500,
    gapMs: 1000,
    width: 1280,
    height: 800,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--eval') args.evals.push(argv[++i]);
    else if (arg === '--at') args.at.push(argv[++i]);
    else if (arg === '--advance') args.advanceMs = parseDuration(argv[++i]);
    else if (arg === '--settle') args.settleMs = Number(argv[++i]);
    else if (arg === '--gap') args.gapMs = Number(argv[++i]);
    else if (arg === '--size') {
      const [w, h] = String(argv[++i]).split('x').map(Number);
      args.width = w;
      args.height = h;
    } else if (!arg.startsWith('-')) args.url = arg;
  }
  return args;
}

async function look(args) {
  const binary = findChrome();
  if (!binary) {
    throw Object.assign(
      new Error(
        'look: no Chrome, Chromium or Edge found. Set CHROME_PATH to a browser binary, or install one — ' +
          'without a browser there is nothing to look at and no number worth printing.',
      ),
      { fatal: true },
    );
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'lattice-look-'));
  const child = spawn(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${args.width},${args.height}`,
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const cleanup = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* a leftover temp dir is not worth failing a report over */
    }
  };

  try {
    const port = await readDevToolsPort(userDataDir, 20000);
    if (!port) throw Object.assign(new Error('look: the browser started but never opened a debugger port'), { fatal: true });

    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw Object.assign(new Error('look: the browser opened no page to attach to'), { fatal: true });

    const session = await Session.attach(page.webSocketDebuggerUrl);
    const consoleMessages = [];
    session.on('Runtime.consoleAPICalled', ({ type, args: values }) => {
      if (type !== 'error' && type !== 'warning' && type !== 'assert') return;
      consoleMessages.push({
        level: type,
        text: values.map((v) => v.value ?? v.description ?? v.type).join(' ').slice(0, 300),
      });
    });
    session.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      consoleMessages.push({
        level: 'exception',
        text: (exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 300),
      });
    });
    session.on('Log.entryAdded', ({ entry }) => {
      if (entry.level !== 'error') return;
      // A missing favicon is on every fresh Vite scaffold in existence. Reporting it makes the
      // console row red on a game with nothing wrong with it, and a row that is red when things
      // are right is a row an agent learns to skip — which is the one outcome this whole file
      // exists to prevent.
      if (/favicon\.ico/.test(entry.url ?? '')) return;
      consoleMessages.push({ level: 'network', text: `${entry.text} ${entry.url ?? ''}`.trim().slice(0, 300) });
    });

    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.send('Page.enable');

    const advanceMs = args.advanceMs ?? 0;
    if (advanceMs !== 0) {
      await session.send('Page.addScriptToEvaluateOnNewDocument', { source: clockShift(advanceMs) });
    }

    const loaded = new Promise((resolve) => session.on('Page.loadEventFired', resolve));
    const navigation = await session.send('Page.navigate', { url: args.url });
    if (navigation.errorText) {
      throw Object.assign(
        new Error(
          `look: could not open ${args.url} — ${navigation.errorText}. Is the dev server running?`,
        ),
        { fatal: true },
      );
    }
    await Promise.race([loaded, wait(15000)]);

    // Before the settle, so whatever the expression moved has the same time to come to rest that
    // the opening frame gets. A `--at` that throws is fatal: the hour asked for was not reached,
    // and reporting the hour that happened to be on screen instead is the exact mistake this flag
    // exists to prevent.
    for (const expression of args.at ?? []) {
      const result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        const why =
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
        throw Object.assign(
          new Error(`look: --at '${expression}' threw — ${String(why).split('\n')[0]}`),
          { fatal: true },
        );
      }
    }

    await wait(args.settleMs);

    const shoot = async () => {
      const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      return Buffer.from(data, 'base64');
    };

    const pngA = await shoot();
    const collected = (await session.send('Runtime.evaluate', { expression: COLLECT_TEXT, returnByValue: true }))
      .result.value ?? { viewport: { w: args.width, h: args.height }, nodes: [] };
    await wait(args.gapMs);
    const pngB = await shoot();

    const probes = [];
    for (const expression of args.evals) {
      const result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      probes.push({
        expression,
        value: result.exceptionDetails ? `threw: ${result.exceptionDetails.text}` : result.result.value,
      });
    }

    session.close();

    if (args.out) {
      mkdirSync(args.out, { recursive: true });
      writeFileSync(join(args.out, 'frame-a.png'), pngA);
      writeFileSync(join(args.out, 'frame-b.png'), pngB);
    }

    const frameA = decodePng(pngA);
    const frameB = decodePng(pngB);
    // CSS pixels to screenshot pixels. Read off the page rather than assumed from `--size`,
    // because the window Chrome actually gave us is not the window we asked for once a device
    // pixel ratio or a scrollbar is involved, and a wrong scale silently measures the ink of
    // one HUD row against the rectangle of another.
    const scale = frameA.width / collected.viewport.w;

    return {
      url: args.url,
      frame: { width: frameA.width, height: frameA.height },
      gapMs: args.gapMs,
      at: { advanceMs, expressions: [...(args.at ?? [])] },
      background: backgroundOf(frameA),
      luminance: luminanceOf(frameA),
      motion: motionBetween(frameA, frameB),
      text: textLegibility(frameA, collected.nodes, scale),
      console: consoleMessages,
      probes,
      screenshots: args.out ? [join(args.out, 'frame-a.png'), join(args.out, 'frame-b.png')] : [],
    };
  } finally {
    cleanup();
  }
}

/** Each measurement turned into a verdict, so the caller never has to remember a threshold. */
function judge(report) {
  const rows = [];
  const push = (name, ok, detail) => rows.push({ name, verdict: ok ? 'pass' : 'FAIL', detail });

  push(
    'anything',
    report.background.distinctColors >= LIMITS.distinctColors,
    `${report.background.distinctColors} distinct colors, mean luminance ${report.luminance.mean.toFixed(3)}`,
  );
  push(
    'framing',
    report.background.fraction < LIMITS.backgroundFraction,
    `${(report.background.fraction * 100).toFixed(0)}% of the frame is ${report.background.color}` +
      `, ${(report.background.edges * 100).toFixed(0)}% of the border`,
  );
  push(
    'motion',
    report.motion.changedFraction > LIMITS.changedFraction,
    `${(report.motion.changedFraction * 100).toFixed(2)}% of pixels changed in ${(report.gapMs / 1000).toFixed(1)}s`,
  );

  const illegible = report.text.filter(
    (t) => t.visibleRange < LIMITS.textVisibleRange || t.contrast < LIMITS.textContrast,
  );
  // Cleared the floor, missed AA. Advisory — it never moves the verdict, so it is appended to
  // whichever detail the row already has rather than given a row of its own.
  const underAA = report.text.filter((t) => !illegible.includes(t) && t.contrast < aaFloorFor(t));
  // Named individually up to a handful, counted after that. One exhibit puts nine nodes in this
  // band at once, and a line that runs off the terminal is a line nobody finishes reading — which
  // is the failure mode this whole file is organized against, one notch quieter.
  const AA_NAMED = 6;
  const aaNote =
    underAA.length === 0
      ? ''
      : ` — ${underAA.length} above the floor and under WCAG AA ` +
        `(${LIMITS.textContrastAA}, or ${LIMITS.textContrast} at ${LIMITS.largeTextPx}px / ` +
        `${LIMITS.largeBoldPx}px bold): ` +
        underAA
          .slice(0, AA_NAMED)
          .map((t) => `"${t.text}" ${t.contrast} at ${t.fontPx}px`)
          .join(', ') +
        (underAA.length > AA_NAMED ? `, and ${underAA.length - AA_NAMED} more` : '');
  push(
    'legibility',
    illegible.length === 0,
    report.text.length === 0
      ? 'no DOM text found — a canvas-drawn HUD is not checked here'
      : (illegible.length === 0
          ? `${report.text.length} text nodes, all readable`
          : illegible.map((t) => `"${t.text}" contrast ${t.contrast}, range ${t.visibleRange}`).join('; ')) +
        aaNote,
  );
  push(
    'console',
    report.console.length === 0,
    report.console.length === 0 ? 'clean' : report.console.map((m) => `[${m.level}] ${m.text}`).join(' | '),
  );

  return rows;
}

function render(report, rows) {
  // The hour is in the heading rather than in a row of its own. It is an *input*, and a row that
  // reports an input has a verdict column it can never earn — which is how a report acquires a
  // line an agent learns to skip.
  const when =
    report.at.advanceMs !== 0 ? ` — wall clock +${(report.at.advanceMs / 1000).toFixed(1)}s` : '';
  const lines = [`looked at ${report.url} — ${report.frame.width}×${report.frame.height}${when}`, ''];
  for (const expression of report.at.expressions) lines.push(`  at    ${expression}`);
  if (report.at.expressions.length) lines.push('');
  for (const row of rows) {
    lines.push(`  ${row.verdict === 'pass' ? 'pass' : 'FAIL'}  ${row.name.padEnd(11)} ${row.detail}`);
  }
  if (report.probes.length) {
    lines.push('');
    for (const probe of report.probes) lines.push(`  eval  ${probe.expression} → ${JSON.stringify(probe.value)}`);
  }
  if (report.screenshots.length) {
    lines.push('', `  frames written to ${report.screenshots.join(' and ')}`);
  }
  lines.push(
    '',
    '  These are a floor, not a verdict. Depth, density, and whether the picture is any good',
    '  are not measured here — open the frames, or ask the game with --eval.',
  );
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  if (!args.url) {
    process.stderr.write(
      'usage: node look.mjs <url> [--json] [--out DIR] [--eval EXPR] [--size WxH]\n' +
        '                     [--advance DURATION] [--at EXPR]\n',
    );
    process.exit(2);
  }
  try {
    const report = await look(args);
    const rows = judge(report);
    if (args.json) process.stdout.write(`${JSON.stringify({ ...report, verdicts: rows }, null, 2)}\n`);
    else process.stdout.write(`${render(report, rows)}\n`);
    process.exit(rows.some((r) => r.verdict !== 'pass') ? 1 : 0);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
}

export { look, judge, decodePng, backgroundOf, luminanceOf, motionBetween, textLegibility, LIMITS };
