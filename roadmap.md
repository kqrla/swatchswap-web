# swatchswap — roadmap

technical implementation notes for planned features.

---

## bulk asset processing

### what it is

process a folder or zip of images in one pass using a single color mapping. output a zip of recolored files with original names preserved.

### how it works bts

**input handling**

the browser's `File System Access API` (`showDirectoryPicker`) lets us read a folder directly without the user having to zip it first. for browsers that don't support it yet, a `<input type="file" multiple accept="image/*">` plus a zip upload path covers the gap. drag-and-drop of a folder also works via the `DataTransferItem.getAsFileSystemHandle()` api.

for zip input, `fflate` (3kb gzip) is the right decompression library — it's async, zero-dependency, and handles the whole zip→file array in a single call without blocking the main thread.

**processing pipeline**

each file gets queued and processed through the existing `recolorImage` from `recolor.js` — the core engine doesn't change. the new layer is:

1. a job queue that holds `{ file, replacements }` pairs
2. a worker pool — `recolorImage` uses `OffscreenCanvas` which is available inside web workers. spinning up 4 workers (matching typical cpu core count) and distributing the queue across them means a 200-image batch processes roughly 4x faster than sequential
3. each worker receives the file bytes via `postMessage` with a `Transferable` arraybuffer (zero-copy), runs `recolorImage`, and posts the result blob back
4. the main thread collects results, tracks progress, and streams completed files into a zip using `fflate`'s streaming `Zip` class — so the zip is assembled incrementally as files complete rather than holding all results in memory at once
5. when the queue is empty, `URL.createObjectURL(zipBlob)` gives the user a single download

**color mapping for bulk mode**

two approaches will be offered:
- **manual mapping** — the user specifies exact hex pairs (`from → to`) that apply to every file in the batch. useful for rebrand work where you know the exact old and new colors
- **auto-remap dominant** — run `detectColors` on each file individually and apply the mapping function per-file. useful when files have different dominant colors but you want to remap all of them to a consistent target palette

**progress ui**

a `ReadableStream`-backed progress feed updates a simple progress bar and a file count (`42 / 200`). individual file errors (corrupt image, unsupported format) are collected into an error log shown at the end — they don't abort the whole batch.

**estimated scope**
- new `worker.js` file (~80 lines): receives arraybuffer + replacements, runs recolorImage, posts result back
- updated `index.html`: bulk mode tab, folder/zip input, progress bar, download button
- no changes to `recolor.js`

---

## brand palette system

### what it is

save named color palettes locally and load them as replacement targets when working on an image. shareable as json. compatible with design token formats.

### how it works bts

**storage**

palettes are stored in `localStorage` as a json array:

```json
[
  {
    "id": "uuid",
    "name": "acme brand 2025",
    "colors": [
      { "name": "primary", "hex": "#7C3AED" },
      { "name": "secondary", "hex": "#059669" },
      { "name": "neutral-900", "hex": "#111827" }
    ]
  }
]
```

`localStorage` keeps it zero-infrastructure — no backend, no login, works offline. for teams that need to share across machines, the palette is exported as a `.json` file and imported on other machines. the import/export is a plain json file read/write via `FileReader` and `URL.createObjectURL(new Blob([json], { type: 'application/json' }))`.

**palette format compatibility**

the internal format maps cleanly onto:
- **css custom properties** — export as `:root { --color-primary: #7C3AED; ... }` via a simple template string
- **figma variables** — the figma plugin can call `figma.variables.createVariable` and populate a collection from the palette json
- **design tokens community format (w3c dtcg)** — the `hex` field maps to `$value`, `name` to the token name, the palette name to the group key

**ui integration**

when the color replacement picker is open, a palette selector appears above the hex input. clicking a palette color fills the `to` field. this is purely additive — the hex input still works as before and palettes are optional.

**in the figma plugin**

the figma plugin stores palettes in `figma.clientStorage` (async key-value store available in plugins) rather than localStorage. this keeps palettes available across figma sessions and across files, without requiring a server. the same json schema is used so palettes can be exported from the web app and imported into the figma plugin and vice versa.

**estimated scope**
- `palette.js` module (~120 lines): crud operations against localStorage, import/export, token format converters
- updated `index.html`: palette manager panel, color picker integration
- figma plugin update: clientStorage read/write, palette panel in plugin ui

---

## api access and offline/local processing

### what it is

a local http server (`npx swatchswap serve`) that exposes `POST /detect` and `POST /recolor` endpoints. designed for ci pipelines, scripting from non-js languages, air-gapped environments, and any case where importing a js module directly isn't practical.

### how it works bts

**runtime**

the server runs in node.js using `node:http` (no express, no dependencies). the only npm package needed is a node-compatible canvas implementation since `OffscreenCanvas` isn't available in node. two options:
- `@napi-rs/canvas` — native bindings, fastest, no system dependencies beyond the npm install
- `canvas` (node-canvas) — the established choice, requires cairo to be installed on the system but is widely tested

`recolor.js` will be refactored to abstract the canvas layer behind a thin interface:

```js
// canvas-adapter.js — browser
export const createCanvas = (w, h) => new OffscreenCanvas(w, h)
export const loadBitmap = (blob) => createImageBitmap(blob)

// canvas-adapter.node.js — node
import { createCanvas as nodeCanvas, loadImage } from '@napi-rs/canvas'
export const createCanvas = (w, h) => nodeCanvas(w, h)
export const loadBitmap = async (buffer) => loadImage(buffer)
```

`recolor.js` imports from `./canvas-adapter.js` — the bundler or the explicit import path swap provides the right implementation per environment. this means the core algorithm stays in one file and browser + server share identical logic.

**api surface**

`POST /detect`
- accepts: `multipart/form-data` with an `image` field (file upload), or `application/json` with `{ "image": "<base64>" }`
- returns: `application/json` — `{ "colors": ["#C23B22", "#3B82F6"] }`
- options passed as query params: `?maxColors=8&dedupeDistance=30`

`POST /recolor`
- accepts: `multipart/form-data` with `image` field + `replacements` json field, or full json body with base64 image
- returns: `image/png` binary (or `image/jpeg` if `?format=jpeg` is passed)
- options as query params: `?threshold=35&format=image/png`

example curl call:
```bash
curl -X POST http://localhost:4242/recolor \
  -F "image=@logo.png" \
  -F 'replacements=[{"from":"#C23B22","to":"#7C3AED"}]' \
  --output logo-recolored.png
```

**auth / security**

the server binds to `127.0.0.1` only by default — not exposed to the network. an optional `--token` flag adds a bearer token check on each request for cases where the server needs to be reachable on a local network. no multi-user model, no accounts.

**ci usage pattern**

```yaml
# github actions example
- run: npx swatchswap serve --port 4242 --token ${{ secrets.SWATCHSWAP_TOKEN }} &
- run: |
    for file in assets/*.png; do
      curl -s -X POST http://localhost:4242/recolor \
        -H "Authorization: Bearer $SWATCHSWAP_TOKEN" \
        -F "image=@$file" \
        -F 'replacements=[{"from":"#C23B22","to":"#7C3AED"}]' \
        --output "dist/$(basename $file)"
    done
```

**python / non-js client example**

```python
import httpx

with open('logo.png', 'rb') as f:
    r = httpx.post(
        'http://localhost:4242/recolor',
        files={'image': f},
        data={'replacements': '[{"from":"#C23B22","to":"#7C3AED"}]'}
    )

with open('logo-recolored.png', 'wb') as out:
    out.write(r.content)
```

**offline / air-gapped environments**

once installed (`npm install -g swatchswap` or vendored into the repo), the server runs entirely locally. no external requests, no cloud dependency. the canvas library bundles its own native binaries so there's no system-level dependency beyond node itself (when using `@napi-rs/canvas`).

**estimated scope**
- `server.js` (~150 lines): http server, multipart parsing (using node's built-in `IncomingMessage` stream), route handlers
- `canvas-adapter.js` + `canvas-adapter.node.js` (~30 lines each): thin abstraction layer
- refactor `recolor.js` to use the adapter (~5 lines changed)
- `bin/swatchswap.js` (~30 lines): cli entry point, `--port`, `--token`, `--help` flags
- `package.json` with `"bin"` field pointing to the cli entry
