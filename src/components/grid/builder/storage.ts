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
export const GRID_PACKAGE_EVENT = 'iki-builder:grid-package:updated'
export const GRID_PACKAGE_BROADCAST_CHANNEL = 'iki-builder:grid-package:channel'
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

// ---------------------------------------------------------------------------
// persistNow — fast deferred save.
// Primary path writes plain JSON (no compression) to avoid CPU spikes while
// editing. Compression is used only as quota fallback.
// ---------------------------------------------------------------------------
function persistNow(state: GridProjectsState): void {
  if (typeof window === 'undefined') return
  const rawJson = JSON.stringify(state)
  let payload = rawJson
  let wroteLocal = false
  try {
    window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, payload)
    wroteLocal = true
  } catch {
    // localStorage may overflow with big SVG payloads. Fallback to compressed write.
    try {
      payload = `${COMPRESSED_PREFIX}${compressToUTF16(rawJson)}`
      window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, payload)
      wroteLocal = true
    } catch {
      // noop: session/window.name fallback below
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

type RuntimeDeviceMode = 'desktop' | 'mobile'

type RuntimePackagesSnapshot = {
  version: 1
  updatedAt: string
  desktopPkg: GridPackage | null
  mobilePkg: GridPackage | null
}

function detectRuntimeDeviceMode(): RuntimeDeviceMode {
  if (typeof window === 'undefined') return 'desktop'
  if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches) {
    return 'mobile'
  }
  return 'desktop'
}

export function selectProjectPackage(project: GridProject | undefined, mode: RuntimeDeviceMode): GridPackage | null {
  if (!project) return null
  // Runtime safety: if mobile package exists but is effectively empty/broken,
  // fallback to desktop package so the game never renders a shifted/blank grid.
  const hasRenderableMobilePkg =
    Boolean(project.mobilePkg) &&
    Array.isArray(project.mobilePkg?.layers) &&
    project.mobilePkg.layers.length > 0
  const pkg = mode === 'mobile'
    ? (hasRenderableMobilePkg ? project.mobilePkg! : project.pkg)
    : project.pkg
  return normalizeGridPackage(pkg)
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
  try {
    window.sessionStorage.setItem(GRID_RUNTIME_PACKAGES_SESSION_STORAGE_KEY, encoded)
  } catch {
    // noop
  }
  // Keep window.name as last durable fallback (same-tab refresh safe).
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
  if (!wroteLocal) {
    // no-op; session/window.name may still persist successfully
  }
}

function loadRuntimePackagesSnapshot(): RuntimePackagesSnapshot | null {
  if (typeof window === 'undefined') return null
  const decodeSnapshotRaw = (raw: string | null): RuntimePackagesSnapshot | null => {
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
  try {
    const localSnapshot = decodeSnapshotRaw(window.localStorage.getItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY))
    const sessionSnapshot = decodeSnapshotRaw(window.sessionStorage.getItem(GRID_RUNTIME_PACKAGES_SESSION_STORAGE_KEY))
    let windowNameSnapshot: RuntimePackagesSnapshot | null = null
    try {
      if (window.name) {
        const parsedRoot = JSON.parse(window.name) as Record<string, unknown>
        const raw = parsedRoot?.[GRID_RUNTIME_PACKAGES_WINDOW_NAME_KEY]
        windowNameSnapshot = decodeSnapshotRaw(typeof raw === 'string' ? raw : null)
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
  // Prefer latest explicitly published runtime snapshot.
  const runtimeSnapshot = loadRuntimePackagesSnapshot()
  if (runtimeSnapshot) {
    const fromSnapshot = runtimeMode === 'mobile' ? runtimeSnapshot.mobilePkg : runtimeSnapshot.desktopPkg
    if (fromSnapshot) return fromSnapshot
  }

  const projectsState = loadGridProjectsState()
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
        preset: layer.animation?.preset ?? 'none',
        trigger: layer.animation?.trigger ?? 'while-active',
        fromState: layer.animation?.fromState ?? 'any',
        toState: layer.animation?.toState ?? 'any',
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

  // Debounce: wait for a longer idle window before serializing large SVG payloads.
  // This keeps typing/dragging smooth while preserving autosave reliability.
  // beforeunload (registered above) guarantees data is saved on page refresh/close.
  persistTimer = setTimeout(() => {
    persistTimer = null
    const snapshot = pendingPersistState
    if (!snapshot) return
    pendingPersistState = null

    // Persist only when browser grants enough idle budget,
    // so JSON serialization does not steal interactive frames.
    scheduleIdlePersist(snapshot)
  }, 3500)
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
  saveRuntimePackagesSnapshot(desktopPkg, mobilePkg)
  const pkg = mode === 'mobile' ? mobilePkg : desktopPkg
  const detail = { pkg, mode, desktopPkg, mobilePkg }
  window.dispatchEvent(new CustomEvent(GRID_PACKAGE_EVENT, { detail }))
  broadcastGridPackage(detail)
}

