/**
 * SVG packaged as data URLs: normalize for <img> and optional inline DOM rendering.
 * WebKit often rasterizes SVG-in-<img> at wrong resolution; inline <svg> paints at layout DPR.
 */

const _svgImgNormCache = new Map<string, string>()
const _inlineSvgCache = new Map<string, string | null>()

export function decodeDataUrlToSvgText(src: string): string | null {
  if (!src) return null
  if (src.startsWith('data:image/svg+xml;charset=utf-8,')) {
    return decodeURIComponent(src.slice('data:image/svg+xml;charset=utf-8,'.length))
  }
  if (src.startsWith('data:image/svg+xml,')) {
    return decodeURIComponent(src.slice('data:image/svg+xml,'.length))
  }
  if (src.startsWith('data:image/svg+xml;base64,')) {
    try {
      return atob(src.slice('data:image/svg+xml;base64,'.length))
    } catch {
      return null
    }
  }
  return null
}

/** Strip fixed root width/height, ensure viewBox so SVG scales with layout. */
export function normalizeSvgDocumentText(svgText: string): string {
  const tagMatch = svgText.match(/<svg(\s[^>]*)?>/)
  if (!tagMatch) return svgText

  let attrs = tagMatch[1] ?? ''
  const wMatch = attrs.match(/\bwidth\s*=\s*["']([^"']+)["']/)
  const hMatch = attrs.match(/\bheight\s*=\s*["']([^"']+)["']/)
  const hasViewBox = /\bviewBox\s*=/.test(attrs)

  if (!hasViewBox && wMatch && hMatch) {
    const w = parseFloat(wMatch[1])
    const h = parseFloat(hMatch[1])
    if (w > 0 && h > 0) {
      attrs += ` viewBox="0 0 ${w} ${h}"`
    }
  }

  attrs = attrs.replace(/\bwidth\s*=\s*["'][^"']*["']/g, '')
  attrs = attrs.replace(/\bheight\s*=\s*["'][^"']*["']/g, '')

  return svgText.replace(/<svg(\s[^>]*)?>/, `<svg${attrs}>`)
}

/** Data URL for <img src> after fixing intrinsic dimensions (fallback when inline is not used). */
export function normalizeSvgDataUrlForImg(src: string): string {
  if (!src) return src
  const cached = _svgImgNormCache.get(src)
  if (cached) return cached

  const svgText = decodeDataUrlToSvgText(src)
  if (!svgText) {
    _svgImgNormCache.set(src, src)
    return src
  }

  const normalized = normalizeSvgDocumentText(svgText)
  if (!normalized.match(/<svg(\s[^>]*)?>/)) {
    _svgImgNormCache.set(src, src)
    return src
  }

  const result = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`
  _svgImgNormCache.set(src, result)
  return result
}

/**
 * Sanitized root <svg>…</svg> for inline DOM. Scripts/event handlers stripped.
 * Returns null for non-SVG data URLs or parse failures.
 */
export function prepareInlineSvgMarkup(src: string): string | null {
  if (typeof document === 'undefined') return null
  if (!src.startsWith('data:image/svg+xml')) return null
  if (_inlineSvgCache.has(src)) {
    return _inlineSvgCache.get(src) ?? null
  }
  try {
    const raw = decodeDataUrlToSvgText(src)
    if (!raw) {
      _inlineSvgCache.set(src, null)
      return null
    }
    const normalized = normalizeSvgDocumentText(raw)
    const doc = new DOMParser().parseFromString(normalized, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (!svg) {
      _inlineSvgCache.set(src, null)
      return null
    }
    doc.querySelectorAll('script').forEach((el) => el.remove())
    for (const attr of [...svg.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) svg.removeAttribute(attr.name)
    }
    svg.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase()
        if (n.startsWith('on')) el.removeAttribute(attr.name)
        if ((n === 'href' || n === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name)
        }
      }
    })
    const out = svg.outerHTML
    _inlineSvgCache.set(src, out)
    return out
  } catch {
    _inlineSvgCache.set(src, null)
    return null
  }
}
