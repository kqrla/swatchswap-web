# swatchswap — info

a closer look at what swatchswap is for, who it's built for, and where it's going.

---

## use cases

### designers working in figma

the most immediate use case is inside figma. you have an image or svg asset on the canvas — a stock illustration, an icon set, a wallpaper, a ui mockup screenshot — and you want to change one or more of its colors without leaving figma or digging up the original source file. the plugin detects what colors are in the asset and lets you swap them in place. no export, no image editor, no re-import.

this is especially useful for:
- **illustration libraries** where you bought or licensed a set and need to match your brand palette
- **icon sets** that came as pngs or flattened svgs and can't be easily recolored via vector fills
- **mockup templates** where you want to quickly show a client what their brand color looks like in context
- **dark mode exploration** — swap the light backgrounds in an asset to dark equivalents and compare side by side

### developers building ui with dynamic theming

`recolor.js` drops into any web project as a zero-dependency es module. if your app has a theming system — per-user preferences, multi-tenant branding, a/b testing different brand colors — you can use it to recolor image assets at runtime rather than maintaining separate copies for each variant.

example: a saas dashboard that white-labels for clients. the logo and illustration assets are stored once. when a client logs in, `recolorImage` swaps the default brand color to theirs. no server-side image processing needed.

### ai agents and no-code builders

the api is designed to be called silently — no ui, no user interaction. an agent that receives a user instruction like "make the hero image match our brand color" can call `detectColors` to find the dominant color, then `recolorImage` to swap it, and show the result directly. the user never sees a color picker or an intermediate step.

this makes it a good fit for:
- replit agents building mini design tools
- figma make / code layer apps that need dynamic image recoloring
- no-code platforms that want to offer color customization on image assets without building a full image editor

### design system teams doing rebrand work

when a company rebrands, the color problem isn't just in code — it's in every image, every slide deck asset, every illustration that has the old brand color baked in. swatchswap gives you a programmable way to run through a batch of assets and update them systematically, rather than manually.

### content creators and social media teams

drop in a template image, swap the accent color to match the campaign, download. no photoshop, no figma pro subscription required. the standalone web app (`index.html`) is the right tool here — just a browser.

---

## developer integration

`recolor.js` is a single file with no dependencies. the full integration is:

```js
import { detectColors, recolorImage, detectAndRecolor } from './recolor.js'
```

all three exported functions are async and work with `Blob`, `File`, or a url string as input.

### the three functions

**`detectColors(source, options?)`**
analyzes an image and returns an array of hex strings for the dominant colors, most frequent first. useful when you don't know what colors are in an asset and want to offer the user a picker pre-populated with the image's actual colors.

**`recolorImage(source, replacements, options?)`**
swaps specific colors in an image. replacements is an array of `{ from, to }` hex pairs. returns a png blob. uses euclidean rgb distance with a soft blend at the edges of the threshold — anti-aliasing is preserved.

**`detectAndRecolor(source, mapFn, options?)`**
combines both in one call. pass a function that receives the detected colors and returns the replacement pairs. useful when the swap logic depends on what colors are actually in the image.

### quick example: runtime brand theming

```js
import { recolorImage } from './recolor.js'

// call this when the user changes their brand color in settings
async function updateBrandAssets(newColor) {
  const assets = document.querySelectorAll('[data-brand-image]')
  for (const img of assets) {
    const res = await fetch(img.src)
    const blob = await res.blob()
    const recolored = await recolorImage(blob, [
      { from: '#C23B22', to: newColor } // your default brand color → user's color
    ])
    img.src = URL.createObjectURL(recolored)
  }
}
```

### quick example: auto-detect and remap the dominant color

```js
import { detectAndRecolor } from './recolor.js'

const blob = await fetch('/assets/hero.png').then(r => r.blob())
const result = await detectAndRecolor(blob, (colors) => [
  { from: colors[0], to: userPreference.brandColor }
])
```

### tuning the threshold

the `threshold` option (default 35) controls how strict the color match is. lower values mean only pixels very close to the `from` color get changed — good for assets with lots of distinct colors where you don't want bleed. higher values cast a wider net — good for assets where the target color appears across a gradient or with slight lighting variation.

```js
await recolorImage(blob, [{ from: '#C23B22', to: '#7C3AED' }], { threshold: 60 })
```

### output formats

defaults to `image/png`. for smaller file sizes on photographic images:

```js
await recolorImage(blob, replacements, { format: 'image/jpeg', quality: 0.92 })
```

### bundler / framework compatibility

`recolor.js` is a standard es module. it works without any config in:
- vite
- webpack 5+
- rollup
- parcel
- deno
- bun

for older bundlers that don't support es modules natively, wrap the imports with a dynamic `import()` or use the module in a `<script type="module">` tag directly.

### browser requirements

requires `OffscreenCanvas` and `createImageBitmap`. supported in:
- chrome 69+
- firefox 105+
- safari 16.4+
- edge 79+

for older targets, a polyfill or a server-side port using `node-canvas` is needed.

---

## what's coming

### bulk asset processing

the current tool handles one image at a time. the next major addition is a bulk mode — drop a folder (or zip) of assets, define a color mapping once, and process everything in a single pass. the output is a downloadable zip of the recolored assets with the original filenames preserved.

the primary use case is company asset libraries: your marketing team has 200 icons and illustrations in the old brand blue. you define the swap (`#0055CC → #7C3AED`) and run the whole folder through in one shot. currently this requires writing a script against `recolor.js` yourself — bulk mode will make it a ui operation.

### brand palette system

a saved palette layer on top of the color picker. you define your brand's color system once (primary, secondary, neutrals, etc.) and swatchswap stores it locally. when you open a new image, instead of typing hex values into the replacement pickers, you select from your saved palette.

for teams, palettes will be shareable as a small json file — import/export so everyone on the design or dev team is working from the same source of truth. the palette format will also be compatible with standard design token formats so it can be exported to css variables or figma variables directly.

### api access and offline/local processing

a local rest-style api (running as a lightweight server you spin up with `npx swatchswap serve`) so that other tools, scripts, and ci pipelines can call swatchswap programmatically without importing the js module directly. designed for:
- offline/air-gapped environments where you can't use a cloud image api
- ci pipelines that need to recolor assets at build time
- scripting from languages other than javascript (python, ruby, shell) via http

the api surface will be minimal: `POST /detect` and `POST /recolor`, both accepting multipart form data or base64 json, returning hex arrays or image blobs respectively.
