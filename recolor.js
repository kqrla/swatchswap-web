/**
 * recolor.js — embeddable image color-swap module
 * No dependencies. Works in any modern browser or bundler.
 *
 * Usage:
 *   import { detectColors, recolorImage } from './recolor.js'
 *
 *   const colors = await detectColors(imageBlob)
 *   // → ['#FF0000', '#00CC44', '#1A1A1A']
 *
 *   const result = await recolorImage(imageBlob, [
 *     { from: '#FF0000', to: '#0055FF' },
 *   ])
 *   // → Blob (PNG)
 */

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase()).join('')
}

function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

async function loadImageData(source) {
  let blob
  if (source instanceof Blob || source instanceof File) {
    blob = source
  } else if (typeof source === 'string') {
    const res = await fetch(source)
    blob = await res.blob()
  } else {
    throw new Error('recolor.js: source must be a Blob, File, or URL string')
  }

  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  return { canvas, ctx, width: bitmap.width, height: bitmap.height }
}

/**
 * Detect the dominant distinct colors in an image.
 * @param {Blob|File|string} source
 * @param {object} [options]
 * @param {number} [options.maxColors=8]
 * @param {number} [options.minAlpha=30]
 * @param {number} [options.dedupeDistance=30]
 * @returns {Promise<string[]>} hex colors, most frequent first
 */
export async function detectColors(source, { maxColors = 8, minAlpha = 30, dedupeDistance = 30 } = {}) {
  const { ctx, width, height } = await loadImageData(source)

  const scale = Math.min(1, 200 / Math.max(width, height))
  const w = Math.max(1, Math.floor(width * scale))
  const h = Math.max(1, Math.floor(height * scale))
  const thumb = new OffscreenCanvas(w, h)
  const tctx = thumb.getContext('2d')
  const bmp = await createImageBitmap(await ctx.canvas.convertToBlob())
  tctx.drawImage(bmp, 0, 0, w, h)
  const { data } = tctx.getImageData(0, 0, w, h)

  const buckets = new Map()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < minAlpha) continue
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }

  const sorted = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1])
  const kept = []
  outer: for (const [key] of sorted) {
    const r = ((key >> 10) & 0x1f) << 3
    const g = ((key >> 5) & 0x1f) << 3
    const b = (key & 0x1f) << 3
    for (const prev of kept) {
      if (colorDist(r, g, b, prev.r, prev.g, prev.b) < dedupeDistance) continue outer
    }
    kept.push({ r, g, b })
    if (kept.length >= maxColors) break
  }

  return kept.map(c => rgbToHex(c.r, c.g, c.b))
}

/**
 * Recolor an image by swapping specific colors.
 * @param {Blob|File|string} source
 * @param {Array<{from: string, to: string}>} replacements
 * @param {object} [options]
 * @param {number} [options.threshold=35]
 * @param {string} [options.format='image/png']
 * @param {number} [options.quality]
 * @returns {Promise<Blob>}
 */
export async function recolorImage(source, replacements, { threshold = 35, format = 'image/png', quality } = {}) {
  const { canvas, ctx, width, height } = await loadImageData(source)
  const imgData = ctx.getImageData(0, 0, width, height)
  const d = imgData.data

  const reps = replacements
    .filter(r => r.from.toLowerCase() !== r.to.toLowerCase())
    .map(r => ({ from: hexToRgb(r.from), to: hexToRgb(r.to) }))

  if (reps.length === 0) return canvas.convertToBlob({ type: format, quality })

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue
    const pr = d[i], pg = d[i + 1], pb = d[i + 2]
    for (const { from, to } of reps) {
      const dist = colorDist(pr, pg, pb, from.r, from.g, from.b)
      if (dist < threshold) {
        const t = Math.max(0, 1 - dist / threshold)
        d[i] = Math.round(pr * (1 - t) + to.r * t)
        d[i + 1] = Math.round(pg * (1 - t) + to.g * t)
        d[i + 2] = Math.round(pb * (1 - t) + to.b * t)
        break
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas.convertToBlob({ type: format, quality })
}

/**
 * Detect colors and recolor in one call.
 * @param {Blob|File|string} source
 * @param {function(string[]): Array<{from:string,to:string}>} mapFn
 * @param {object} [options]
 * @returns {Promise<Blob>}
 */
export async function detectAndRecolor(source, mapFn, options = {}) {
  const colors = await detectColors(source, options)
  const replacements = mapFn(colors)
  return recolorImage(source, replacements, options)
}
