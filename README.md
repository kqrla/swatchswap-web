# swatchswap — svg recolor plugin + web module

swap hardcoded colors in images and svg assets, both inside figma and anywhere on the web.

---

## the problem

design files accumulate images and imported svg assets with baked-in colors — a brand icon exported as png, an illustration from a stock library, a wallpaper, a set of ui vectors. when the color system changes (rebrand, dark mode, per-tenant theming), there's no clean way to update those assets. you're left choosing between:

- reopening the original source file (if it exists), changing the color, re-exporting, re-importing
- doing a destructive manual pixel edit in an image editor
- accepting that the asset stays the wrong color forever

none of these scale. the source file might not exist. the asset might be a rasterized export of someone else's svg. and doing it one-by-one for thirty assets across a design file is hours of context-switching.

the underlying engine problem is also non-trivial: a naive pixel replace breaks on anti-aliased edges and gradients. you need a tolerance-aware match that blends the swap proportionally based on how close a pixel is to the target color — otherwise you get hard white fringes and mismatched soft edges.

---

## what it is

**swatchswap** is two things that share a single engine:

### 1. figma plugin (svg recolor)

a figma plugin that operates directly on image-fill nodes and svg vector trees already placed on your canvas. select a node, run the plugin, it detects the dominant colors in that asset, shows you a before/after comparison, and lets you swap any of those colors to new values. the result is written back to the same node as a new image fill — no round-tripping through an external tool.

designed for:
- raster images with `image` fills (png, jpg, webp)
- svgs imported into figma as flattened rectangle image fills
- svg vectors that were pasted/placed as vector nodes with clip path groups

the plugin also creates a `— color layers` annotation frame alongside processed nodes so you have a record of what was swapped and what the original colors were.

### 2. swatchswap-web — standalone app + embeddable js module

a zero-dependency web app and importable es module that does the same thing outside of figma. ships as two files:

- `index.html` — a dark-mode drag-and-drop web ui. upload an image, see detected colors, pick replacements, download the result
- `recolor.js` — the raw engine, exported as es module functions. drop it into any project and call it programmatically — no ui involved

---

## behind-the-scenes flow

### color detection (`detectColors`)

1. the input (blob, file, or url string) is decoded into an `ImageBitmap` via `createImageBitmap`
2. it's drawn onto an `OffscreenCanvas` at native resolution, then downscaled to a thumbnail (longest edge 200px) for fast sampling
3. pixels are quantized into 5-bit buckets (each channel `>> 3`) — this collapses near-identical colors into the same bin without a full k-means pass
4. buckets are sorted by pixel count (most frequent first)
5. a greedy deduplication pass walks the sorted list and skips any candidate whose euclidean rgb distance to an already-kept color is below `dedupeDistance` (default 30)
6. returns up to `maxColors` hex strings, most dominant first

the thumbnail-then-bucket approach trades a bit of precision for speed. for typical ui assets and illustrations (not photographic gradients) it surfaces the meaningful structural colors reliably.

### color swapping (`recolorImage`)

1. the source is decoded to a full-resolution `OffscreenCanvas`
2. `getImageData` pulls the raw rgba pixel array
3. for each non-transparent pixel, it computes euclidean rgb distance to each `from` color in the replacement list
4. if the distance is below `threshold` (default 35 — roughly 8% of the maximum rgb distance of 441), the pixel is replaced
5. the replacement isn't a hard cut — it's a soft blend: `t = 1 - dist/threshold`, meaning pixels right at the match center get fully replaced and pixels near the edge of the tolerance zone get partially blended. this preserves anti-aliasing and soft shadows
6. `putImageData` writes the modified pixels back, and `convertToBlob` returns the result as a png (or whatever `format` you pass)

### figma plugin flow (on top of the engine)

1. user selects one or more nodes on the canvas
2. plugin calls `figma.exportAsync(node, { format: 'PNG' })` to get a raw byte array
3. wraps it in a `Blob` and passes to `detectColors` — colors surface in the plugin ui as swatches
4. user adjusts target colors
5. on apply, calls `recolorImage(blob, replacements)`
6. result blob is uploaded back via `figma.createImage(bytes).hash` and set as the node's image fill
7. a `— color layers` sibling frame is created alongside the node to document the swap

for svg vector nodes (not image fills), the plugin walks the node tree directly and modifies the `fills` array on each vector, using the same threshold matching logic against the detected hex values.

---

## using recolor.js in your own app

`recolor.js` is a plain es module — no build step, no npm install, no dependencies. copy the file into your project.

```js
import { detectColors, recolorImage, detectAndRecolor } from './recolor.js'
```

### detect dominant colors in an image

```js
const colors = await detectColors(imageBlob)
// → ['#C23B22', '#3B82F6', '#1A1A1A', '#F5F5F5']

// or pass a url
const colors = await detectColors('https://example.com/asset.png')
```

### swap specific colors

```js
const result = await recolorImage(imageBlob, [
  { from: '#C23B22', to: '#7C3AED' },
  { from: '#3B82F6', to: '#059669' },
])
// → Blob (png)

const url = URL.createObjectURL(result)
img.src = url
```

### detect + swap in one call

```js
const result = await detectAndRecolor(imageBlob, (colors) => [
  { from: colors[0], to: userBrandColor }, // swap dominant color to whatever the user picked
])
```

### all options

```js
await detectColors(source, {
  maxColors: 8,        // max distinct colors to return (default 8)
  minAlpha: 30,        // ignore pixels below this alpha (0–255, default 30)
  dedupeDistance: 30,  // euclidean rgb distance threshold for deduplication (default 30)
})

await recolorImage(source, replacements, {
  threshold: 35,        // match radius in rgb space (0–441, default 35)
  format: 'image/png',  // output mime type (default 'image/png')
  quality: undefined,   // quality for lossy formats like 'image/jpeg' (0.0–1.0)
})
```

---

## integration patterns

### theme switcher / per-tenant branding

```js
// swap the brand color in a logo based on which tenant is logged in
async function brandedLogo(tenantColor) {
  const colors = await detectColors('/assets/logo.png')
  return recolorImage('/assets/logo.png', [
    { from: colors[0], to: tenantColor }
  ])
}

const blob = await brandedLogo('#E11D48')
logoEl.src = URL.createObjectURL(blob)
```

### dark mode asset adaptation

```js
// detect light backgrounds in an illustration and invert them for dark mode
const colors = await detectColors(illustrationBlob)
const lightColors = colors.filter(hex => {
  const [r, g, b] = [hex.slice(1,3), hex.slice(3,5), hex.slice(5,7)].map(h => parseInt(h, 16))
  return (r + g + b) / 3 > 200  // luminance threshold
})

const darkModeBlob = await recolorImage(illustrationBlob,
  lightColors.map(hex => ({ from: hex, to: '#1A1A1A' }))
)
```

### replit / ai agent context

`recolor.js` is intentionally designed so an ai agent can call it without needing to build any ui. the agent calls the functions directly, passes the result to an `<img>` tag or download link, and the user sees the output — not the process.

```js
// an agent receives a user instruction like "make the icon green"
const userIntent = '#22C55E'
const output = await recolorImage('/assets/icon.png', [
  { from: await detectColors('/assets/icon.png').then(c => c[0]), to: userIntent }
])
document.getElementById('result').src = URL.createObjectURL(output)
```

### node.js / server-side (with a canvas polyfill)

`recolor.js` uses `OffscreenCanvas`, `createImageBitmap`, and `Blob` — all browser-native apis. for server-side use you'll need a canvas implementation. the logic is self-contained so porting it to `node-canvas` or `sharp` is straightforward:

```js
// pseudocode — replace OffscreenCanvas calls with your server canvas api
// the color math (hexToRgb, colorDist, bucket quantization) is pure js and can be copied as-is
```

### bundler / npm package usage

since it's a plain es module with no imports, it works in vite, webpack, rollup, and parcel without any config. copy `recolor.js` into your `src/` folder and import normally.

---

## running the web app locally

the web app uses es module `import` statements so it needs to be served, not opened as a `file://` url:

```bash
npx serve .
# → http://localhost:3000
```

or any static server works — `python3 -m http.server`, vite, etc.

---

## file reference

| file | what it is |
|---|---|
| `index.html` | self-contained web app — all ui logic inline, imports recolor.js |
| `recolor.js` | the engine — three exported async functions, zero dependencies |

---

## limitations

- operates on raster pixels — vector svg files that haven't been rasterized will need to be exported to png first (the figma plugin handles this automatically via `exportAsync`)
- color matching is rgb euclidean distance, not perceptual (lab/oklab). for photographic images with subtle gradients, results may be imprecise at the edges of matched regions
- `OffscreenCanvas` requires a modern browser (chrome 69+, firefox 105+, safari 16.4+). older environments need a polyfill
- very large images (4k+) will be slower since the full pixel array is walked synchronously on the main thread — consider adding web worker support for production use on large assets
