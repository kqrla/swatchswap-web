/**
 * pairing.js — color pairing engine for swatchswap
 * defines relational color pairs (contrast, tint/shade, complementary, analogous)
 * and auto-adjusts partner colors when one changes.
 *
 * works in oklch color space for perceptually uniform operations.
 * no dependencies — uses the same hex utilities as recolor.js.
 */

// ---- color space conversions ----

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

function hexToRgbNorm(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
}

function rgbNormToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v * 255)))
  return '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('')
}

function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b)
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  }
}

function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
  return {
    r: linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  }
}

function oklabToOklch(L, a, b) {
  const C = Math.sqrt(a * a + b * b)
  const H = Math.atan2(b, a) * 180 / Math.PI
  return { L, C, H: H < 0 ? H + 360 : H }
}

function oklchToOklab(L, C, H) {
  const rad = H * Math.PI / 180
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) }
}

export function hexToOklch(hex) {
  const { r, g, b } = hexToRgbNorm(hex)
  const lab = rgbToOklab(r, g, b)
  return oklabToOklch(lab.L, lab.a, lab.b)
}

export function oklchToHex(L, C, H) {
  const lab = oklchToOklab(Math.max(0, Math.min(1, L)), Math.max(0, C), H)
  const rgb = oklabToRgb(lab.L, lab.a, lab.b)
  return rgbNormToHex(
    Math.max(0, Math.min(1, rgb.r)),
    Math.max(0, Math.min(1, rgb.g)),
    Math.max(0, Math.min(1, rgb.b)),
  )
}

// ---- wcag luminance + contrast ----

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgbNorm(hex)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

export function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA)
  const lB = relativeLuminance(hexB)
  const lighter = Math.max(lA, lB)
  const darker = Math.min(lA, lB)
  return (lighter + 0.05) / (darker + 0.05)
}

export function meetsWcagAA(hexFg, hexBg, largeText = false) {
  const ratio = contrastRatio(hexFg, hexBg)
  return largeText ? ratio >= 3 : ratio >= 4.5
}

export function meetsWcagAAA(hexFg, hexBg, largeText = false) {
  const ratio = contrastRatio(hexFg, hexBg)
  return largeText ? ratio >= 4.5 : ratio >= 7
}

// ---- pairing algorithms ----

/**
 * adjust a partner color to meet a target contrast ratio against a reference color.
 * preserves the partner's hue and chroma, only adjusts lightness.
 */
export function adjustForContrast(referenceHex, partnerHex, targetRatio = 4.5) {
  const refLum = relativeLuminance(referenceHex)
  const partnerLch = hexToOklch(partnerHex)

  // determine if partner should be lighter or darker than reference
  const refIsLight = refLum > 0.18

  let requiredLum
  if (refIsLight) {
    // partner should be dark: (refLum + 0.05) / (partnerLum + 0.05) >= targetRatio
    requiredLum = (refLum + 0.05) / targetRatio - 0.05
  } else {
    // partner should be light: (partnerLum + 0.05) / (refLum + 0.05) >= targetRatio
    requiredLum = targetRatio * (refLum + 0.05) - 0.05
  }

  requiredLum = Math.max(0, Math.min(1, requiredLum))

  // binary search over oklch L to find the value that produces the required luminance
  let lo = 0, hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    const testHex = oklchToHex(mid, partnerLch.C, partnerLch.H)
    const testLum = relativeLuminance(testHex)
    if (testLum < requiredLum) lo = mid
    else hi = mid
  }

  return oklchToHex((lo + hi) / 2, partnerLch.C, partnerLch.H)
}

/**
 * apply a tint/shade follow: when the base color shifts in oklch,
 * apply the same delta to each variant.
 */
export function applyTintShadeFollow(originalBase, newBase, variants) {
  const origLch = hexToOklch(originalBase)
  const newLch = hexToOklch(newBase)
  const dL = newLch.L - origLch.L
  const dC = newLch.C - origLch.C
  const dH = newLch.H - origLch.H

  return variants.map(hex => {
    const lch = hexToOklch(hex)
    return oklchToHex(
      Math.max(0, Math.min(1, lch.L + dL)),
      Math.max(0, lch.C + dC),
      ((lch.H + dH) % 360 + 360) % 360,
    )
  })
}

/**
 * apply a hue-follow: rotate partner hues by the same delta as the anchor.
 * preserves the angular offset each partner had from the original anchor.
 */
export function applyHueFollow(originalAnchor, newAnchor, partners) {
  const origLch = hexToOklch(originalAnchor)
  const newLch = hexToOklch(newAnchor)
  const dH = newLch.H - origLch.H

  return partners.map(hex => {
    const lch = hexToOklch(hex)
    return oklchToHex(lch.L, lch.C, ((lch.H + dH) % 360 + 360) % 360)
  })
}

// ---- pairing data model ----

/**
 * create a pairing definition.
 * @param {object} opts
 * @param {string} opts.label - human-readable name
 * @param {string} opts.type - 'contrast' | 'tint-shade' | 'complementary' | 'analogous'
 * @param {Array<{role: string, hex: string}>} opts.colors - the paired colors
 * @param {number} [opts.targetContrastRatio] - for contrast pairings (default 4.5)
 * @returns {object} pairing definition
 */
export function createPairing({ label, type, colors, targetContrastRatio = 4.5 }) {
  return {
    id: 'pair-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    label,
    type,
    targetContrastRatio: type === 'contrast' ? targetContrastRatio : undefined,
    colors: colors.map(c => ({ ...c, hex: c.hex.toUpperCase() })),
    originalColors: colors.map(c => ({ ...c, hex: c.hex.toUpperCase() })),
  }
}

/**
 * given a pairing and the index of the color that changed + its new hex,
 * compute the adjusted values for all other colors in the pairing.
 * returns a new colors array with all adjustments applied.
 */
export function applyPairing(pairing, changedIndex, newHex) {
  const colors = pairing.colors.map(c => ({ ...c }))
  colors[changedIndex].hex = newHex.toUpperCase()

  if (pairing.type === 'contrast') {
    for (let i = 0; i < colors.length; i++) {
      if (i === changedIndex) continue
      colors[i].hex = adjustForContrast(newHex, colors[i].hex, pairing.targetContrastRatio || 4.5)
    }
  } else if (pairing.type === 'tint-shade') {
    const baseIndex = changedIndex
    const origBase = pairing.originalColors[baseIndex].hex
    const others = colors.filter((_, i) => i !== baseIndex).map(c => c.hex)
    const adjusted = applyTintShadeFollow(origBase, newHex, others)
    let j = 0
    for (let i = 0; i < colors.length; i++) {
      if (i === baseIndex) continue
      colors[i].hex = adjusted[j++]
    }
  } else if (pairing.type === 'complementary' || pairing.type === 'analogous') {
    const anchorIndex = changedIndex
    const origAnchor = pairing.originalColors[anchorIndex].hex
    const others = colors.filter((_, i) => i !== anchorIndex).map(c => pairing.originalColors[colors.indexOf(c)]?.hex || c.hex)
    const origOthers = []
    for (let i = 0; i < colors.length; i++) {
      if (i === anchorIndex) continue
      origOthers.push(pairing.originalColors[i].hex)
    }
    const adjusted = applyHueFollow(origAnchor, newHex, origOthers)
    let j = 0
    for (let i = 0; i < colors.length; i++) {
      if (i === anchorIndex) continue
      colors[i].hex = adjusted[j++]
    }
  }

  return colors
}

/**
 * export pairings to a portable json string.
 */
export function exportPairings(pairings) {
  return JSON.stringify({ version: 1, pairings: pairings.map(p => ({
    id: p.id, label: p.label, type: p.type,
    targetContrastRatio: p.targetContrastRatio,
    colors: p.colors,
  }))}, null, 2)
}

/**
 * import pairings from a json string. returns array of pairing objects.
 */
export function importPairings(jsonStr) {
  const data = JSON.parse(jsonStr)
  if (!data || !Array.isArray(data.pairings)) throw new Error('invalid pairings format')
  return data.pairings.map(p => ({
    ...p,
    originalColors: p.colors.map(c => ({ ...c })),
  }))
}
