import { createDefaultGridPackage } from './defaultPackage'
import type { GridPackage, GridProject, GridProjectsState, GridVisualState } from './types'
import { compressToUTF16, decompressFromUTF16 } from 'lz-string'

export const GRID_PACKAGE_STORAGE_KEY = 'iki-builder:grid-package:v1'
export const GRID_PROJECTS_STORAGE_KEY = 'iki-builder:grid-projects:v1'
export const GRID_PROJECTS_SESSION_STORAGE_KEY = 'iki-builder:grid-projects:session:v1'
export const GRID_PACKAGE_SESSION_STORAGE_KEY = 'iki-builder:grid-package:session:v1'
export const GRID_PROJECTS_WINDOW_NAME_KEY = 'iki-builder:grid-projects:window-name:v1'
export const GRID_RUNTIME_PACKAGES_STORAGE_KEY = 'iki-builder:grid-runtime-packages:v1'
export const GRID_RUNTIME_PACKAGES_SESSION_STORAGE_KEY = 'iki-builder:grid-runtime-packages:session:v1'
export const GRID_RUNTIME_PACKAGES_WINDOW_NAME_KEY = 'iki-builder:grid-runtime-packages:window-name:v1'
/** Dev-only: Vite middleware relays POST body; clients poll GET (same LAN as `npm run dev`). */
export const DEV_RUNTIME_PACKAGES_URL = '/__iki/dev-runtime-packages'
export const GRID_PACKAGE_EVENT = 'iki-builder:grid-package:updated'
export const GRID_PACKAGE_BROADCAST_CHANNEL = 'iki-builder:grid-package:channel'

/** Stable title for selectors (admin + builder). Prefer package meta — Grid Settings edits `pkg.meta.name`; `project.name` can lag after multi-device merges. */
export function displayGridProjectName(project: GridProject): string {
  const desk = project.pkg?.meta?.name?.trim() ?? ''
  const top = project.name?.trim() ?? ''
  const mob = project.mobilePkg?.meta?.name?.trim() ?? ''
  if (desk) return desk
  if (top) return top
  if (mob) return mob
  return 'Untitled grid'
}

let inMemoryProjectsState: GridProjectsState | null = null
const COMPRESSED_PREFIX = 'lz16:'
let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersistState: GridProjectsState | null = null
let idlePersistHandle: number | null = null
const IDLE_MIN_BUDGET_MS = 10

function scheduleIdlePersist(state: GridProjectsState): void {
  if (typeof window === 'undefined') return
  if (typeof window.requestIdleCallback === 'function') {
    idlePersistHandle = window.requestIdleCallback((deadline) => {
      idlePersistHandle = null
      // Avoid heavy serialization while user is actively interacting.
      // Requeue until we get enough idle budget or the callback times out.
      if (!deadline.didTimeout && deadline.timeRemaining() < IDLE_MIN_BUDGET_MS) {
        scheduleIdlePersist(state)
        return
      }
      persistNow(state)
    }, { timeout: 8000 })
    return
  }
  if (typeof MessageChannel !== 'undefined') {
    const mc = new MessageChannel()
    mc.port1.onmessage = () => { persistNow(state); mc.port1.close() }
    mc.port2.postMessage(null)
    return
  }
  setTimeout(() => persistNow(state), 0)
}

/** Rough sum of embedded SVG / data-URL chars (desktop + mobile packages). */
export function estimatedProjectsInlineFootprint(state: GridProjectsState): number {
  let n = 0
  for (const p of state.projects) {
    for (const pkg of [p.pkg, p.mobilePkg].filter(Boolean) as GridPackage[]) {
      for (const layer of pkg.layers) {
        n += layer.src?.length ?? 0
        if (layer.stateSvgs) {
          for (const v of Object.values(layer.stateSvgs)) {
            if (typeof v === 'string') n += v.length
          }
        }
      }
      for (const c of pkg.components ?? []) {
        for (const v of c.variants ?? []) {
          n += v.src?.length ?? 0
        }
      }
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// persistNow — fast deferred save.
// Plain JSON for small states; with many inline SVGs go straight to lz16 to fit quota and avoid a failing giant write.
// ---------------------------------------------------------------------------
function persistNow(state: GridProjectsState): void {
  if (typeof window === 'undefined') return
  const rawJson = JSON.stringify(state)
  const useCompressed =
    rawJson.length > 320_000 || estimatedProjectsInlineFootprint(state) > 260_000
  let payload = useCompressed
    ? `${COMPRESSED_PREFIX}${compressToUTF16(rawJson)}`
    : rawJson
  let wroteLocal = false
  if (!useCompressed) {
    try {
      window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, payload)
      wroteLocal = true
    } catch {
      try {
        payload = `${COMPRESSED_PREFIX}${compressToUTF16(rawJson)}`
        window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, payload)
        wroteLocal = true
      } catch {
        // noop: session/window.name fallback below
      }
    }
  } else {
    try {
      window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, payload)
      wroteLocal = true
    } catch {
      // noop
    }
  }
  try {
    window.sessionStorage.setItem(GRID_PROJECTS_SESSION_STORAGE_KEY, payload)
  } catch { /* noop */ }
  if (!wroteLocal) {
    // window.name path remains compressed to keep payload short and durable.
    writeWindowNameState(state)
  }
}

// ---------------------------------------------------------------------------
// persistNowForced — ALWAYS compresses before writing.
// Used by beforeunload where we must guarantee the data fits regardless of size.
// Also writes to ALL available storage targets for maximum durability.
// ---------------------------------------------------------------------------
function persistNowForced(state: GridProjectsState): void {
  if (typeof window === 'undefined') return
  // Compress once — reuse for all targets
  const rawJson = JSON.stringify(state)
  const encoded = `${COMPRESSED_PREFIX}${compressToUTF16(rawJson)}`
  try {
    window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, encoded)
  } catch {
    // If local write fails (quota/private mode), clear stale local copy
    // so loader can pick fresher session/window-name state.
    try { window.localStorage.removeItem(GRID_PROJECTS_STORAGE_KEY) } catch { /* noop */ }
  }
  try { window.sessionStorage.setItem(GRID_PROJECTS_SESSION_STORAGE_KEY, encoded) } catch { /* noop */ }
  // window.name is always written as last-resort — survives page reloads within the same tab
  writeWindowNameState(state)
}

// Flush any pending unsaved state when the user closes or refreshes the page.
// Uses forced compression to guarantee data fits in localStorage even for large grids.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const state = pendingPersistState ?? inMemoryProjectsState
    if (!state) return
    if (persistTimer !== null) clearTimeout(persistTimer)
    if (idlePersistHandle !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idlePersistHandle)
    }
    persistNowForced(state)
  })
}

export function encodeState(state: GridProjectsState): string {
  const raw = JSON.stringify(state)
  return `${COMPRESSED_PREFIX}${compressToUTF16(raw)}`
}

export function decodeState(raw: string): GridProjectsState | null {
  try {
    const json =
      raw.startsWith(COMPRESSED_PREFIX)
        ? (decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length)) ?? '')
        : raw
    if (!json) return null
    return JSON.parse(json) as GridProjectsState
  } catch {
    return null
  }
}

/** Latest `project.updatedAt` in state — compare with server `updated_at` for sync. */
export function getProjectsStateFreshnessScore(state: GridProjectsState): number {
  let maxTs = 0
  for (const project of state.projects) {
    const ts = Date.parse(project.updatedAt ?? '')
    if (Number.isFinite(ts) && ts > maxTs) maxTs = ts
  }
  return maxTs
}

function readWindowNameState(): GridProjectsState | null {
  if (typeof window === 'undefined') return null
  try {
    if (!window.name) return null
    const payload = JSON.parse(window.name) as Record<string, unknown>
    const raw = payload?.[GRID_PROJECTS_WINDOW_NAME_KEY]
    if (typeof raw !== 'string' || !raw) return null
    const parsed = decodeState(raw)
    if (!parsed) return null
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.projects) ||
      parsed.projects.length === 0 ||
      typeof parsed.activeProjectId !== 'string'
    ) {
      return null
    }
    parsed.projects = parsed.projects.map((project) => ({
      ...project,
      pkg: normalizeGridPackage(project.pkg),
      mobilePkg: project.mobilePkg ? normalizeGridPackage(project.mobilePkg) : undefined,
    }))
    return parsed
  } catch {
    return null
  }
}

/** True if this tab/device already has builder state outside React memory (local/session/window.name). */
export function hasPersistedGridProjectsState(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.localStorage.getItem(GRID_PROJECTS_STORAGE_KEY)?.trim()) return true
    if (window.sessionStorage.getItem(GRID_PROJECTS_SESSION_STORAGE_KEY)?.trim()) return true
    return readWindowNameState() !== null
  } catch {
    return false
  }
}

function writeWindowNameState(state: GridProjectsState): void {
  if (typeof window === 'undefined') return
  try {
    let payload: Record<string, unknown> = {}
    if (window.name) {
      const parsed = JSON.parse(window.name) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        payload = parsed
      }
    }
    payload[GRID_PROJECTS_WINDOW_NAME_KEY] = encodeState(state)
    window.name = JSON.stringify(payload)
  } catch {
    try {
      window.name = JSON.stringify({ [GRID_PROJECTS_WINDOW_NAME_KEY]: encodeState(state) })
    } catch {
      // noop
    }
  }
}

type RuntimeDeviceMode = 'desktop' | 'mobile'

type RuntimePackagesSnapshot = {
  version: 1
  updatedAt: string
  desktopPkg: GridPackage | null
  mobilePkg: GridPackage | null
}

export function decodeRuntimePackagesSnapshotRaw(raw: string | null): RuntimePackagesSnapshot | null {
  if (!raw) return null
  try {
    const json = raw.startsWith(COMPRESSED_PREFIX)
      ? (decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length)) ?? '')
      : raw
    if (!json) return null
    const parsed = JSON.parse(json) as RuntimePackagesSnapshot
    if (parsed?.version !== 1) return null
    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      desktopPkg: parsed.desktopPkg ? normalizeGridPackage(parsed.desktopPkg) : null,
      mobilePkg: parsed.mobilePkg ? normalizeGridPackage(parsed.mobilePkg) : null,
    }
  } catch {
    return null
  }
}

function syncRuntimePackagesToTransientStores(encoded: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(GRID_RUNTIME_PACKAGES_SESSION_STORAGE_KEY, encoded)
  } catch {
    // noop
  }
  try {
    let root: Record<string, unknown> = {}
    if (window.name) {
      const parsed = JSON.parse(window.name) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') root = parsed
    }
    root[GRID_RUNTIME_PACKAGES_WINDOW_NAME_KEY] = encoded
    window.name = JSON.stringify(root)
  } catch {
    // noop
  }
}

function mirrorRuntimePackagesPayloadToDevServer(encoded: string): void {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return
  if (!encoded) return
  void fetch(DEV_RUNTIME_PACKAGES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: encoded,
  })
    .then((res) => {
      if (!res.ok) {
        console.warn('[SciBo] Dev grid relay POST failed:', res.status, res.statusText)
      }
    })
    .catch((err) => {
      console.warn('[SciBo] Dev grid relay POST error:', err)
    })
}

/** Re-send the last saved runtime snapshot to the Vite relay (e.g. phone reconnect, fingerprint unchanged). */
export function mirrorExistingRuntimeSnapshotToDevServer(): void {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return
  const encoded = window.localStorage.getItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY)
  if (encoded) mirrorRuntimePackagesPayloadToDevServer(encoded)
}

/**
 * Apply a snapshot fetched from the dev relay (another device’s localStorage payload).
 * Does not re-post to the relay (avoids loops).
 */
export function applyRuntimePackagesPayloadFromDevServer(encoded: string): boolean {
  if (typeof window === 'undefined' || !encoded.trim()) return false
  const snap = decodeRuntimePackagesSnapshotRaw(encoded)
  if (!snap) return false
  try {
    window.localStorage.setItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY, encoded)
  } catch {
    // Huge atlas can exceed mobile quota; still update the live grid via the event below.
  }
  syncRuntimePackagesToTransientStores(encoded)
  const mode = getRuntimeLayoutMode()
  const detail = {
    desktopPkg: snap.desktopPkg,
    mobilePkg: snap.mobilePkg,
    pkg: mode === 'mobile' ? snap.mobilePkg : snap.desktopPkg,
    mode,
  }
  window.dispatchEvent(new CustomEvent(GRID_PACKAGE_EVENT, { detail }))
  broadcastGridPackage(detail)
  return true
}

function broadcastGridPackage(detail: {
  pkg: GridPackage | null
  mode: RuntimeDeviceMode
  desktopPkg: GridPackage | null
  mobilePkg: GridPackage | null
}): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(GRID_PACKAGE_BROADCAST_CHANNEL)
    channel.postMessage(detail)
    channel.close()
  } catch {
    // noop
  }
}

function detectMobileRuntime(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false

  const params = new URLSearchParams(window.location.search)
  if (params.get('forceMobile') === '1') return true
  if (params.get('forceDesktop') === '1') return false

  const ua = window.navigator.userAgent ?? ''
  const uaDataMobile = (window.navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
  if (uaDataMobile === true) return true
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true
  const platform = window.navigator.platform ?? ''
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true

  // UA-only detection misses: in-app browsers, “Request Desktop Website”, some Wi‑Fi test setups.
  if (typeof window.matchMedia === 'function') {
    const touchCapable = maxTouchPoints > 0
    const noHover = window.matchMedia('(hover: none)').matches
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    const narrow = window.matchMedia('(max-width: 1024px)').matches
    // iPhone “Desktop website”: ~980px wide, still touch + no hover; avoids desktop grid there.
    if (touchCapable && narrow && (noHover || coarsePointer)) return true
    if (window.matchMedia('(max-width: 900px)').matches) return true
    // Touch-first device with a not-huge viewport (e.g. iPad split view).
    if (coarsePointer && window.matchMedia('(max-width: 1280px)').matches) return true
  }
  return false
}

/**
 * Drives which package is loaded (`mobilePkg` vs `pkg`) and BettingGrid shell mode (`data-grid-layout`).
 * Includes narrow desktop viewports (e.g. max-width 900px) — not only phones.
 */
export function getRuntimeLayoutMode(): RuntimeDeviceMode {
  return detectMobileRuntime() ? 'mobile' : 'desktop'
}

function pickLayerSourceForAtlas(pkg: GridPackage, layer: GridPackage['layers'][number]): string {
  const stateSvg = layer.stateSvgs?.default
  if (stateSvg) return stateSvg
  if (layer.componentId && layer.variantId) {
    const component = pkg.components.find((item) => item.id === layer.componentId)
    const variant = component?.variants.find((item) => item.id === layer.variantId)
    if (variant?.src) return variant.src
  }
  return layer.src
}

function resolveAtlasBounds(pkg: GridPackage): { originX: number; originY: number; width: number; height: number } {
  const frameWidth = pkg.frame?.width > 0 ? pkg.frame.width : 1
  const frameHeight = pkg.frame?.height > 0 ? pkg.frame.height : 1
  const clipRect = pkg.global?.clipRect ?? { x: 0, y: 0, width: frameWidth, height: frameHeight }
  let minX = Number.isFinite(clipRect.x) ? clipRect.x : 0
  let minY = Number.isFinite(clipRect.y) ? clipRect.y : 0
  let maxX = minX + (Number.isFinite(clipRect.width) ? clipRect.width : frameWidth)
  let maxY = minY + (Number.isFinite(clipRect.height) ? clipRect.height : frameHeight)
  for (const layer of pkg.layers) {
    const rects = [
      { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
      ...(layer.stateRects ? Object.values(layer.stateRects) : []),
    ]
    for (const rect of rects) {
      if (!rect) continue
      const x = Number.isFinite(rect.x) ? rect.x : 0
      const y = Number.isFinite(rect.y) ? rect.y : 0
      const w = Number.isFinite(rect.width) ? rect.width : 0
      const h = Number.isFinite(rect.height) ? rect.height : 0
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    }
  }
  return {
    originX: minX,
    originY: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

const RUNTIME_ATLAS_RESOLUTION_CAP = 4

/**
 * Raster scale for runtime atlas backing store vs logical grid coordinates.
 * Floors at `minScale` so publishing from a 1× display still bakes enough pixels for phones;
 * on Retina builder machines can grow up to `maxScale`.
 */
export function resolveRuntimeAtlasResolutionMultiplier(
  minScale = 2,
  maxScale = RUNTIME_ATLAS_RESOLUTION_CAP,
): number {
  const cap = Math.max(1, maxScale)
  const floor = Math.max(1, minScale)
  if (typeof window === 'undefined') return floor
  const dpr = window.devicePixelRatio || 1
  const device = Math.min(Math.max(dpr, 1), cap)
  return Math.max(floor, device)
}

/** SVG→PNG bake scale for mobile builder: preview uses frame.scale × zoom (up to ~3×), so bitmap must exceed CSS×DPR. */
const MOBILE_BUILDER_RASTER_QUALITY_CAP = 12
/** Upper bound of (frame.scale × previewZoom) in builder — keep in sync with clampPreviewZoom × GRID_SKIN.scale. */
const MOBILE_BUILDER_PREVIEW_SCALE_HINT = 4

export function resolveMobileBuilderRasterQualityScale(): number {
  if (typeof window === 'undefined') return 6
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)
  const atlasFloor = resolveRuntimeAtlasResolutionMultiplier(3)
  const needForZoom = Math.ceil(dpr * MOBILE_BUILDER_PREVIEW_SCALE_HINT)
  return Math.min(MOBILE_BUILDER_RASTER_QUALITY_CAP, Math.max(atlasFloor, needForZoom))
}

export async function buildRuntimeAtlasForPackage(
  pkg: GridPackage | null,
  qualityScale = 6,
  maxTextureWidth = 8192,
  /** Logical→physical atlas scale (see `resolveRuntimeAtlasResolutionMultiplier`); capped by `maxTextureWidth`. */
  resolutionMultiplier = 1,
): Promise<GridPackage | null> {
  if (!pkg) return null
  if (typeof window === 'undefined') return pkg
  const bounds = resolveAtlasBounds(pkg)
  // Clamp both dimensions: old logic only capped width, so tall grids produced
  // huge heights (> browser canvas limits) and Update Game failed silently.
  const rawW = Math.max(1, Math.round(bounds.width * qualityScale))
  const rawH = Math.max(1, Math.round(bounds.height * qualityScale))
  const fit = Math.min(maxTextureWidth / rawW, maxTextureWidth / rawH, 1)
  const targetWidth = Math.max(1, Math.round(rawW * fit))
  const targetHeight = Math.max(1, Math.round(rawH * fit))
  const maxByW = maxTextureWidth / targetWidth
  const maxByH = maxTextureWidth / targetHeight
  let mult = Math.max(1, resolutionMultiplier)
  mult = Math.min(mult, maxByW, maxByH)
  if (!Number.isFinite(mult) || mult < 1) mult = 1

  const layers = pkg.layers.slice().sort((a, b) => a.zIndex - b.zIndex)
  const uniqueSources = Array.from(new Set(layers.map((layer) => pickLayerSourceForAtlas(pkg, layer))))
  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.decoding = 'sync'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`atlas-image-load-failed:${src.slice(0, 64)}`))
      img.src = src
    })
  const imageEntries = await Promise.all(uniqueSources.map(async (src) => [src, await loadImage(src)] as const))
  const imageMap = new Map<string, HTMLImageElement>(imageEntries)

  const canvas = document.createElement('canvas')
  const physW = Math.max(1, Math.round(targetWidth * mult))
  const physH = Math.max(1, Math.round(targetHeight * mult))
  canvas.width = physW
  canvas.height = physH
  const ctx = canvas.getContext('2d')
  if (!ctx) return pkg
  ctx.setTransform(mult, 0, 0, mult, 0, 0)
  ctx.clearRect(0, 0, targetWidth, targetHeight)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const scaleX = targetWidth / bounds.width
  const scaleY = targetHeight / bounds.height

  const renderAtlasState = (closed: boolean): string => {
    ctx.setTransform(mult, 0, 0, mult, 0, 0)
    ctx.clearRect(0, 0, targetWidth, targetHeight)
    for (const layer of layers) {
      const stateStyle = layer.stateStyles?.default ?? { visible: true, opacity: 1 }
      const stateVisible = stateStyle.visible
      const globalVisible = closed
        ? (layer.globalVisibility?.closed ?? true)
        : (layer.globalVisibility?.open ?? true)
      if (!stateVisible || !globalVisible || stateStyle.opacity <= 0) continue
      const src = pickLayerSourceForAtlas(pkg, layer)
      const image = imageMap.get(src)
      if (!image) continue
      ctx.globalAlpha = Math.max(0, Math.min(1, stateStyle.opacity))
      ctx.drawImage(
        image,
        (layer.x - bounds.originX) * scaleX,
        (layer.y - bounds.originY) * scaleY,
        layer.width * scaleX,
        layer.height * scaleY,
      )
    }
    ctx.globalAlpha = 1
    return canvas.toDataURL('image/png')
  }

  const nextPkg = structuredClone(pkg)
  nextPkg.global.runtimeAtlas = {
    updatedAt: new Date().toISOString(),
    states: {
      open: {
        src: renderAtlasState(false),
        width: targetWidth,
        height: targetHeight,
        originX: bounds.originX,
        originY: bounds.originY,
      },
      closed: {
        src: renderAtlasState(true),
        width: targetWidth,
        height: targetHeight,
        originX: bounds.originX,
        originY: bounds.originY,
      },
    },
  }
  return nextPkg
}

export type BuildRuntimeAtlasWithFallbackResult = {
  pkg: GridPackage | null
  error: string | null
}

export async function buildRuntimeAtlasForPackageWithFallback(
  pkg: GridPackage | null,
  qualityScale = 6,
  maxTextureWidth = 8192,
  resolutionMultiplier = 1,
): Promise<BuildRuntimeAtlasWithFallbackResult> {
  if (!pkg) return { pkg: null, error: null }
  try {
    const built = await buildRuntimeAtlasForPackage(pkg, qualityScale, maxTextureWidth, resolutionMultiplier)
    return { pkg: built, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[SciBo] buildRuntimeAtlasForPackage failed:', e)
    const fallback = structuredClone(pkg) as GridPackage
    delete fallback.global.runtimeAtlas
    return { pkg: normalizeGridPackage(fallback), error: msg }
  }
}

export type BuildRuntimePrerenderedWithFallbackResult = {
  pkg: GridPackage | null
  error: string | null
}

/**
 * Rasterise an SVG data URL to PNG (layerCss × qualityScale, capped by maxTextureSize).
 * Used when inserting into the mobile grid package so layers are stored as bitmaps.
 */
export async function rasterizeSvgDataUrlToPngDataUrl(
  svgDataUrl: string,
  layerCssWidth: number,
  layerCssHeight: number,
  qualityScale = 3,
  maxTextureSize = 4096,
): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!svgDataUrl.startsWith('data:image/svg+xml')) return null
  return rasterizeSvgLikeSource(
    svgDataUrl,
    Math.max(1, layerCssWidth),
    Math.max(1, layerCssHeight),
    qualityScale,
    maxTextureSize,
  )
}

async function rasterizeSvgLikeSource(
  src: string,
  targetWidth: number,
  targetHeight: number,
  qualityScale: number,
  maxTextureSize: number,
): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!src) return null
  const looksLikeSvg = src.startsWith('data:image/svg+xml') || src.startsWith('<svg') || src.includes('.svg')
  if (!looksLikeSvg) return src

  const loadImage = (value: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.decoding = 'sync'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`runtime-prerender-image-load-failed:${value.slice(0, 80)}`))
      img.src = value
    })

  const image = await loadImage(src)
  const rawW = Math.max(1, Math.round(targetWidth * qualityScale))
  const rawH = Math.max(1, Math.round(targetHeight * qualityScale))
  const fit = Math.min(maxTextureSize / rawW, maxTextureSize / rawH, 1)
  const outW = Math.max(1, Math.round(rawW * fit))
  const outH = Math.max(1, Math.round(rawH * fit))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, outW, outH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, outW, outH)
  return canvas.toDataURL('image/png')
}

/**
 * Build high-res pre-rendered layer images (PNG) from SVG sources.
 * This keeps runtime visual quality stable on mobile WebView/GPU paths where SVG can blur.
 */
export async function buildRuntimePrerenderedPackageWithFallback(
  pkg: GridPackage | null,
  qualityScale = 3,
  maxTextureSize = 4096,
): Promise<BuildRuntimePrerenderedWithFallbackResult> {
  if (!pkg) return { pkg: null, error: null }
  try {
    const next = structuredClone(pkg)
    const cache = new Map<string, string>()

    const convert = async (src: string, width: number, height: number): Promise<string> => {
      const key = `${src}::${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`
      const cached = cache.get(key)
      if (cached) return cached
      const out = await rasterizeSvgLikeSource(src, width, height, qualityScale, maxTextureSize)
      const finalSrc = out ?? src
      cache.set(key, finalSrc)
      return finalSrc
    }

    for (const layer of next.layers) {
      const baseW = layer.width > 0 ? layer.width : 1
      const baseH = layer.height > 0 ? layer.height : 1
      layer.src = await convert(layer.src, baseW, baseH)

      if (layer.stateSvgs) {
        const entries = Object.entries(layer.stateSvgs) as [GridVisualState, string][]
        for (const [state, source] of entries) {
          if (!source) continue
          const rect = layer.stateRects?.[state]
          const w = rect?.width && rect.width > 0 ? rect.width : baseW
          const h = rect?.height && rect.height > 0 ? rect.height : baseH
          layer.stateSvgs[state] = await convert(source, w, h)
        }
      }
    }

    return { pkg: next, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[SciBo] buildRuntimePrerenderedPackageWithFallback failed:', e)
    return { pkg: normalizeGridPackage(structuredClone(pkg)), error: msg }
  }
}

function detectRuntimeDeviceMode(): RuntimeDeviceMode {
  return getRuntimeLayoutMode()
}

export function selectProjectPackage(project: GridProject | undefined, mode: RuntimeDeviceMode): GridPackage | null {
  if (!project) return null
  if (mode !== 'mobile') {
    const pkg = project.pkg
    if (!pkg) return null
    return normalizeGridPackage(pkg)
  }
  const desktop = project.pkg
  const mobile = project.mobilePkg
  // If a mobile fork exists, always use it — it was intentionally designed for phones.
  // Fall back to desktop only when there is no mobile package at all.
  if (mobile) return normalizeGridPackage(mobile)
  if (!desktop) return null
  return normalizeGridPackage(desktop)
}

function saveRuntimePackagesSnapshot(
  desktopPkg: GridPackage | null,
  mobilePkg: GridPackage | null,
): void {
  if (typeof window === 'undefined') return
  const payload: RuntimePackagesSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    desktopPkg,
    mobilePkg,
  }
  const raw = JSON.stringify(payload)
  let encoded = raw
  let wroteLocal = false
  try {
    window.localStorage.setItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY, encoded)
    wroteLocal = true
  } catch {
    try {
      encoded = `${COMPRESSED_PREFIX}${compressToUTF16(raw)}`
      window.localStorage.setItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY, encoded)
      wroteLocal = true
    } catch {
      // Make room for the runtime snapshot (critical for cross-tab refresh consistency).
      // The full builder projects payload is much larger and can be reconstructed later.
      try { window.localStorage.removeItem(GRID_PROJECTS_STORAGE_KEY) } catch { /* noop */ }
      try {
        window.localStorage.setItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY, encoded)
        wroteLocal = true
      } catch {
        try { window.localStorage.removeItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY) } catch { /* noop */ }
      }
    }
  }
  syncRuntimePackagesToTransientStores(encoded)
  if (!wroteLocal) {
    // no-op; session/window.name may still persist successfully
  }
  mirrorRuntimePackagesPayloadToDevServer(encoded)
}

function loadRuntimePackagesSnapshot(): RuntimePackagesSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const localSnapshot = decodeRuntimePackagesSnapshotRaw(
      window.localStorage.getItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY),
    )
    const sessionSnapshot = decodeRuntimePackagesSnapshotRaw(
      window.sessionStorage.getItem(GRID_RUNTIME_PACKAGES_SESSION_STORAGE_KEY),
    )
    let windowNameSnapshot: RuntimePackagesSnapshot | null = null
    try {
      if (window.name) {
        const parsedRoot = JSON.parse(window.name) as Record<string, unknown>
        const raw = parsedRoot?.[GRID_RUNTIME_PACKAGES_WINDOW_NAME_KEY]
        windowNameSnapshot = decodeRuntimePackagesSnapshotRaw(typeof raw === 'string' ? raw : null)
      }
    } catch {
      // noop
    }
    const candidates = [localSnapshot, sessionSnapshot, windowNameSnapshot].filter(
      (item): item is RuntimePackagesSnapshot => item !== null,
    )
    if (candidates.length === 0) return null
    candidates.sort((a, b) => {
      const ta = Date.parse(a.updatedAt ?? '')
      const tb = Date.parse(b.updatedAt ?? '')
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
    })
    return candidates[0]
  } catch {
    return null
  }
}

export function saveGridPackage(pkg: GridPackage): void {
  const state = loadGridProjectsState()
  const nextProjects = state.projects.map((project) =>
    project.id === state.activeProjectId
      ? {
          ...project,
          updatedAt: new Date().toISOString(),
          pkg,
        }
      : project,
  )
  saveGridProjectsState({
    ...state,
    projects: nextProjects,
  })
}

export function loadGridPackage(deviceMode?: RuntimeDeviceMode): GridPackage | null {
  const runtimeMode = deviceMode ?? detectRuntimeDeviceMode()
  const projectsState = loadGridProjectsState()
  const projectsScore = getProjectsStateFreshnessScore(projectsState)

  // Prefer a published runtime snapshot only when it is at least as fresh as builder projects.
  // Otherwise an older local/room snapshot beats cloud-synced projects on a new device/session.
  const runtimeSnapshot = loadRuntimePackagesSnapshot()
  if (runtimeSnapshot) {
    const snapTs = Date.parse(runtimeSnapshot.updatedAt ?? '')
    const snapshotFresh = Number.isFinite(snapTs) ? snapTs : 0
    const fromSnapshot = runtimeMode === 'mobile'
      ? (runtimeSnapshot.mobilePkg ?? runtimeSnapshot.desktopPkg)
      : runtimeSnapshot.desktopPkg
    if (fromSnapshot && snapshotFresh >= projectsScore) {
      return fromSnapshot
    }
  }

  const active = projectsState.projects.find(
    (project) => project.id === projectsState.activeProjectId,
  )
  if (active) {
    return selectProjectPackage(active, runtimeMode)
  }

  // Legacy fallback
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(GRID_PACKAGE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GridPackage
    if (parsed?.version !== 1) return null
    return normalizeGridPackage(parsed)
  } catch {
    return null
  }
}

export function normalizeGridPackage(pkg: GridPackage): GridPackage {
  // Ensure frame dimensions are valid — a zero width/height makes the grid invisible in the runtime
  if (!pkg.frame) {
    pkg.frame = { width: 665, height: 221, scale: 1.3 }
  } else {
    if (typeof pkg.frame.width !== 'number' || pkg.frame.width <= 0) pkg.frame.width = 665
    if (typeof pkg.frame.height !== 'number' || pkg.frame.height <= 0) pkg.frame.height = 221
    if (typeof pkg.frame.scale !== 'number' || pkg.frame.scale <= 0) pkg.frame.scale = 1.3
  }

  if (!pkg.global) {
    pkg.global = {
      closedMode: 'tilted',
      tiltAngleDeg: 56,
      clipRect: {
        x: 0,
        y: 0,
        width: pkg.frame.width,
        height: pkg.frame.height,
      },
    }
  } else if (typeof pkg.global.tiltAngleDeg !== 'number') {
    pkg.global.tiltAngleDeg = 56
  }
  if (!pkg.global.clipRect) {
    pkg.global.clipRect = {
      x: 0,
      y: 0,
      width: pkg.frame.width,
      height: pkg.frame.height,
    }
  } else {
    // Ensure clip rect has valid positive dimensions
    if (typeof pkg.global.clipRect.width !== 'number' || pkg.global.clipRect.width <= 0) {
      pkg.global.clipRect.width = pkg.frame.width
    }
    if (typeof pkg.global.clipRect.height !== 'number' || pkg.global.clipRect.height <= 0) {
      pkg.global.clipRect.height = pkg.frame.height
    }
  }
  if (Array.isArray(pkg.layers)) {
    pkg.layers = pkg.layers.map((layer) => ({
      ...layer,
      originalWidth:
        typeof layer.originalWidth === 'number' && layer.originalWidth > 0
          ? layer.originalWidth
          : (typeof layer.width === 'number' && layer.width > 0 ? layer.width : 1),
      originalHeight:
        typeof layer.originalHeight === 'number' && layer.originalHeight > 0
          ? layer.originalHeight
          : (typeof layer.height === 'number' && layer.height > 0 ? layer.height : 1),
      // Ensure zoneId — prevents a post-mount useEffect re-render in the builder
      zoneId: layer.zoneId ?? (`zone_${String(layer.id).replace(/[^a-zA-Z0-9_]/g, '_')}` as import('../../../game/types').BetZoneId),
      stateStyles: {
        default: layer.stateStyles?.default ?? { visible: true, opacity: 1 },
        hover: layer.stateStyles?.hover ?? { visible: true, opacity: 1 },
        active: layer.stateStyles?.active ?? { visible: true, opacity: 1 },
        chipPlaced: layer.stateStyles?.chipPlaced ?? { visible: true, opacity: 1 },
        disabled: layer.stateStyles?.disabled ?? { visible: true, opacity: 0.9 },
        locked: layer.stateStyles?.locked ?? { visible: true, opacity: 1 },
      },
      locked: layer.locked ?? false,
      animation: {
        scope: layer.animation?.scope === 'grid-state' ? 'grid-state' : 'element-state',
        preset: layer.animation?.preset ?? 'none',
        trigger: layer.animation?.trigger ?? 'while-active',
        fromState: layer.animation?.fromState ?? 'any',
        toState: layer.animation?.toState ?? 'any',
        fromGridState: layer.animation?.fromGridState ?? 'any',
        toGridState: layer.animation?.toGridState ?? 'any',
        durationMs: layer.animation?.durationMs ?? 220,
        delayMs: layer.animation?.delayMs ?? 0,
        easing: layer.animation?.easing ?? 'ease-out',
        intensity: layer.animation?.intensity ?? 1,
      },
      globalVisibility: {
        open: layer.globalVisibility?.open ?? true,
        closed: layer.globalVisibility?.closed ?? true,
      },
      enabledStates: Array.from(
        new Set(
          (layer.enabledStates ?? ['default']).map((state) => {
            const raw = String(state)
            return raw === 'chip-placed' ? 'chipPlaced' : (state as GridVisualState)
          }),
        ),
      ),
    }))
  }
  return pkg
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function defaultProject(name = 'Default Grid Project'): GridProject {
  return {
    id: uid('project'),
    name,
    updatedAt: new Date().toISOString(),
    pkg: createDefaultGridPackage(),
  }
}

export function loadGridProjectsState(): GridProjectsState {
  if (inMemoryProjectsState) {
    return inMemoryProjectsState
  }
  if (typeof window === 'undefined') {
    const project = defaultProject()
    inMemoryProjectsState = {
      version: 1,
      activeProjectId: project.id,
      projects: [project],
    }
    return inMemoryProjectsState
  }

  try {
    const hydrateFromRaw = (raw: string | null): GridProjectsState | null => {
      if (!raw) return null
      const parsed = decodeState(raw)
      if (!parsed) return null
      if (
        parsed?.version !== 1 ||
        !Array.isArray(parsed.projects) ||
        parsed.projects.length === 0 ||
        typeof parsed.activeProjectId !== 'string'
      ) {
        return null
      }
      parsed.projects = parsed.projects.map((project) => ({
        ...project,
        pkg: normalizeGridPackage(project.pkg),
        mobilePkg: project.mobilePkg ? normalizeGridPackage(project.mobilePkg) : undefined,
      }))
      return parsed
    }

    const stateUpdatedAtScore = (state: GridProjectsState | null): number => {
      if (!state || !Array.isArray(state.projects) || state.projects.length === 0) return 0
      let maxTs = 0
      for (const project of state.projects) {
        const ts = Date.parse(project.updatedAt ?? '')
        if (Number.isFinite(ts) && ts > maxTs) maxTs = ts
      }
      return maxTs
    }

    const localRaw = window.localStorage.getItem(GRID_PROJECTS_STORAGE_KEY)
    const sessionRaw = window.sessionStorage.getItem(GRID_PROJECTS_SESSION_STORAGE_KEY)
    const localState = hydrateFromRaw(localRaw)
    const sessionState = hydrateFromRaw(sessionRaw)
    const windowNameState = readWindowNameState()

    const candidates = [localState, sessionState, windowNameState].filter(
      (state): state is GridProjectsState => state !== null,
    )

    if (candidates.length > 0) {
      candidates.sort((a, b) => stateUpdatedAtScore(b) - stateUpdatedAtScore(a))
      inMemoryProjectsState = candidates[0]
      return candidates[0]
    }
  } catch {
    // noop
  }

  const legacy = loadLegacyGridPackage()
  const initial = defaultProject()
  if (legacy) {
    initial.pkg = legacy
    initial.name = legacy.meta.name || initial.name
  }
  inMemoryProjectsState = {
    version: 1,
    activeProjectId: initial.id,
    projects: [initial],
  }
  return inMemoryProjectsState
}

function loadLegacyGridPackage(): GridPackage | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(GRID_PACKAGE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GridPackage
    if (parsed?.version !== 1) return null
    if (!Array.isArray(parsed.components)) {
      parsed.components = []
    }
    return normalizeGridPackage(parsed)
  } catch {
    return null
  }
}

export function saveGridProjectsState(state: GridProjectsState): void {
  inMemoryProjectsState = state
  if (typeof window === 'undefined') return

  pendingPersistState = state
  if (persistTimer !== null) clearTimeout(persistTimer)
  if (idlePersistHandle !== null && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(idlePersistHandle)
    idlePersistHandle = null
  }

  // Debounce: longer when many inline SVGs so main-thread JSON + lz16 runs less often while dragging.
  // beforeunload (registered above) guarantees data is saved on page refresh/close.
  const debounceMs =
    estimatedProjectsInlineFootprint(state) > 400_000 ? 6500 : 3500
  persistTimer = setTimeout(() => {
    persistTimer = null
    const snapshot = pendingPersistState
    if (!snapshot) return
    pendingPersistState = null

    // Persist only when browser grants enough idle budget,
    // so JSON serialization does not steal interactive frames.
    scheduleIdlePersist(snapshot)
  }, debounceMs)
}

/** Writes pending debounced builder state before navigating away (avoids stale localStorage in the game tab). */
export function flushPendingGridProjectsPersist(): void {
  const state = pendingPersistState ?? inMemoryProjectsState
  if (!state) return
  saveGridProjectsStateNow(state)
}

// Force immediate durable save (used by explicit user actions like "Update Game").
export function saveGridProjectsStateNow(state: GridProjectsState): void {
  inMemoryProjectsState = state
  if (typeof window === 'undefined') return
  pendingPersistState = null
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  if (idlePersistHandle !== null && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(idlePersistHandle)
    idlePersistHandle = null
  }
  persistNowForced(state)
}

// Synchronously update the in-memory state — called from apply()'s setState updater
// so beforeunload always has the absolute latest state even before the useEffect fires.
export function touchInMemoryState(state: GridProjectsState): void {
  inMemoryProjectsState = state
}

export function publishGridProjectsState(state?: GridProjectsState, deviceMode?: RuntimeDeviceMode): void {
  if (typeof window === 'undefined') return
  const runtimeState = state ?? inMemoryProjectsState ?? loadGridProjectsState()
  const active = runtimeState.projects.find((project) => project.id === runtimeState.activeProjectId)
  const mode = deviceMode ?? detectRuntimeDeviceMode()
  const desktopPkg = active ? selectProjectPackage(active, 'desktop') : null
  const mobilePkg = active ? selectProjectPackage(active, 'mobile') : null
  publishRuntimePackages(desktopPkg, mobilePkg, mode)
}

export function publishRuntimePackages(
  desktopPkg: GridPackage | null,
  mobilePkg: GridPackage | null,
  deviceMode?: RuntimeDeviceMode,
): void {
  if (typeof window === 'undefined') return
  const mode = deviceMode ?? detectRuntimeDeviceMode()
  saveRuntimePackagesSnapshot(desktopPkg, mobilePkg)
  const pkg = mode === 'mobile' ? mobilePkg : desktopPkg
  const detail = { pkg, mode, desktopPkg, mobilePkg }
  window.dispatchEvent(new CustomEvent(GRID_PACKAGE_EVENT, { detail }))
  broadcastGridPackage(detail)
}

