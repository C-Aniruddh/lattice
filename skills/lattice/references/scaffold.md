# Scaffold and install

Six files and two commands. Nothing here is a decision the user should be shown, so do not show
it to them — one line ("Setting it up.") covers the whole section.

---

## 1. Install

Always install these five. They are the spine of every Lattice game and the layering is not the
user's problem:

```bash
npm init -y
npm pkg set type=module
npm i -D vite typescript
npm i @lattice/core @lattice/iso @lattice/draw @lattice/loop @lattice/input
```

Then add only what the shape needs:

| shape | also install |
|---|---|
| lit, build, crowd, terrain, explore | `@lattice/ui` |
| idle | `@lattice/ui @lattice/sim @lattice/persist` |
| listen | `@lattice/ui @lattice/audio` |
| story | `@lattice/ui @lattice/persist` |

Add `@lattice/audio` to any shape the moment you decide it makes noise, and `@lattice/persist`
the moment it has progress worth keeping. Both are one command; do not front-load them "just in
case", because an installed package with no import is a lie about what the game is.

### Check that what arrived is Lattice

**Do this every time. It costs one command and it catches a failure whose other symptom is a
hundred incomprehensible type errors.**

```bash
node -e "const p=require('./node_modules/@lattice/core/package.json');console.log(p.description||'',p.keywords||[])"
```

You want a description about deterministic primitives and keywords including `isometric` or
`lattice`+`gamedev`. If you get something about a REST framework, dependency injection, or
`inversify`, **you have installed a different package that happens to share the name** — the
`@lattice` npm scope is not exclusively this project's. Stop and follow *Install did not work*
below rather than trying to make the code compile against it.

### Install did not work

Two failures, one response each. Neither is ever shown to the user as an error.

**404 / not found, or the wrong package arrived.** The registry copy is not available on this
machine. Say one sentence and take the next action yourself:

> One of the pieces isn't downloading — give me a minute, I'll build it from source.

Then, if `git` is present:

```bash
git clone --depth 1 https://github.com/C-Aniruddh/lattice /tmp/lattice-kit
cd /tmp/lattice-kit && npm install && npm run build
for p in core iso draw loop input ui sim persist audio; do (cd packages/$p && npm pack --pack-destination /tmp/lattice-tgz); done
```

then back in the game folder, install the tarballs you need by path:

```bash
npm i /tmp/lattice-tgz/lattice-core-*.tgz /tmp/lattice-tgz/lattice-iso-*.tgz ...
```

Tarballs install exactly what the registry would have shipped — the `files` list, the `exports`
map, the built `dist`, the README — so nothing about the game changes.

**If `git` is also missing**, you are out of moves. Say it plainly, in one sentence, with the
one thing they can do:

> I can't download the game engine on this machine and there's no way around it from here —
> it needs either an internet connection to npm or `git` installed. Everything else is ready.

That is the only dead end in this whole flow, and it is a dead end because the alternative is
lying about a game that does not exist.

---

## 2. The files

### `index.html`

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Lighthouse</title>
<style>
  html, body { margin: 0; height: 100%; background: #0a0d18; overscroll-behavior: none; }
  #app { position: fixed; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
```

Title it after their game. `overscroll-behavior: none` stops a phone pulling the page down
while they drag the map, and it is one of about four lines here that are not obvious.

The HUD's whole appearance goes in this file's `<style>`, because `@lattice/ui` ships no
stylesheet at all — see the `hud` skill.

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`"types": ["vite/client"]` is not optional. Without it `import.meta.hot` is a type error, and
`import.meta.hot` is the line that stops a hot reload leaving two live games driving one canvas.

`noUncheckedIndexedAccess` is on deliberately. It is the setting that makes `array[i]` a
`T | undefined`, which is annoying for ten seconds and is what stops a depth-sorted frame
reading past its own bucket.

### `package.json` scripts

```bash
npm pkg set scripts.dev="vite --port 5173 --strictPort"
npm pkg set scripts.build="tsc --noEmit && vite build"
npm pkg set scripts.check="tsc --noEmit"
```

**`--strictPort` matters.** Without it Vite silently moves to 5174 when 5173 is busy, and you
end up screenshotting somebody else's app and declaring victory. If the port is taken, kill the
old server rather than moving.

**`vite` does not typecheck.** A type error will not stop the page from loading; it will produce
a subtly wrong game instead. So `npm run check` is a real step, not a formality — run it before
every screenshot.

### `src/main.ts`

Do not write this from memory. **Read the `starting` skill first.** The boot has two mistakes in
it that produce no error, no warning, and a plausible-looking picture:

- a hand-written `stepMs` beside a loop that runs at 16.667 (gestures mistimed by 4%, and a
  recorded session that gets refused months later);
- a light field that was created but never attached to the pen, which disables the entire night
  in silence while the field goes on reporting that it is working.

`starting` has the wiring order that avoids both, as a runnable file.

### No `vite.config.ts`

You do not need one. Vite's defaults serve `index.html` from the project root and resolve
`node_modules` on their own. Adding a config file is one more thing to be wrong.

---

## 3. Run it

```bash
npm run dev
```

Start it as soon as the ground renders, and **leave it running for the rest of the session**.
Vite hot-reloads every save, so the browser tab you open in step 5 stays current without
restarting anything.

One trap that will bite you the first time you edit `main.ts`:

> **Under Vite, dispose your input on hot reload or the game becomes a zombie.** HMR
> re-evaluates the module, `createInput` correctly throws on a second binding to the same
> canvas — and the *first* instance is still bound and still rendering. So the symptom is not
> the error: it is a game that keeps drawing while every tap does nothing and the readout is
> frozen at whatever it last showed, with the real message buried in a console nobody is
> looking at by then. The `starting` skill's boot includes the one line that pays for itself.

---

## 4. What to say

Nothing about any of this. The user hears one sentence when it starts and the next thing they
hear is about their game:

> Setting it up.

…and then, a minute later:

> Here's the coast. The fog's moving; the lighthouse is the stub on the point. Adding the beam
> next.
