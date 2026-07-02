# swatchswap-web

swap hardcoded colors in any image — no figma, no plugins, just a browser.

## what it does

- **standalone web app** (`index.html`) — drop an image, detect its colors, pick replacements, download the result
- **embeddable module** (`recolor.js`) — drop into any app and call it silently, user never sees a picker

## web app

open `index.html` in a browser (needs a local server for es module imports):

```
npx serve .
```

then go to `http://localhost:3000`

## embeddable module

```js
import { detectColors, recolorImage, detectAndRecolor } from './recolor.js'

// detect what colors are in an image
const colors = await detectColors(imageBlob)
// → ['#C23B22', '#3B82F6', '#1A1A1A']

// swap specific colors
const result = await recolorImage(imageBlob, [
  { from: '#C23B22', to: '#7C3AED' },
])
// → Blob (png)

// detect + swap in one call
const result = await detectAndRecolor(imageBlob, (colors) => [
  { from: colors[0], to: '#FF0000' }, // swap most dominant color to red
])
```

## options

```js
await detectColors(source, {
  maxColors: 8,        // how many colors to return
  minAlpha: 30,        // skip near-transparent pixels
  dedupeDistance: 30,  // euclidean rgb distance to treat two colors as the same
})

await recolorImage(source, replacements, {
  threshold: 35,       // how close a pixel needs to be to match (0–441)
  format: 'image/png', // output format
})
```

## for replit agents

drop `recolor.js` into your project. the agent can call it without building any ui — just pass the image url or blob and the color map. the user only ever sees the swapped result.

```js
// example: always replace the brand color based on a user's preference
const userColor = getUserPreference() // your app logic
const output = await recolorImage('/assets/logo.png', [
  { from: '#C23B22', to: userColor },
])
const url = URL.createObjectURL(output)
img.src = url
```

## files

| file | purpose |
|---|---|
| `index.html` | standalone web app |
| `recolor.js` | embeddable es module |
