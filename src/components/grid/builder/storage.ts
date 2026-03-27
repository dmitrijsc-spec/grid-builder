import { createDefaultGridPackage } from './defaultPackage'
import type { GridPackage, GridProject, GridProjectsState, GridVisualState } from './types'
import { compressToUTF16, decompressFromUTF16 } from 'lz-string'

export const GRID_PACKAGE_STORAGE_KEY = 'scibo:grid-package:v1'
export const GRID_PROJECTS_STORAGE_KEY = 'scibo:grid-projects:v1'
export const GRID_PROJECTS_SESSION_STORAGE_KEY = 'scibo:grid-projects:session:v1'
export const GRID_PACKAGE_SESSION_STORAGE_KEY = 'scibo:grid-package:session:v1'
export const GRID_PROJECTS_WINDOW_NAME_KEY = 'scibo:grid-projects:window-name:v1'
export const GRID_PACKAGE_EVENT = 'scibo:grid-package:updated'
export const GRID_PACKAGE_BROADCAST_CHANNEL = 'scibo:grid-package:channel'
let inMemoryProjectsState: GridProjectsState | null = null
const COMPRESSED_PREFIX = 'lz16:'
let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersistState: GridProjectsState | null = null
let idlePersistHandle: number | null = null

// ---------------------------------------------------------------------------
// persistNow — fast deferred save (uncompressed first, compressed fallback).
// Used by the debounce path when the browser is idle.
// ---------------------------------------------------------------------------
function persistNow(state: GridProjectsState): void {
  if (typeof window === 'undefined') return
  // Always compress — SVG data URLs compress 5-10x, keeping writes fast and
  // well within localStorage quota even for large grids.
  const rawJson = JSON.stringify(state)
  const encoded = `${COMPRESSED_PREFIX}${compressToUTF16(rawJson)}`
  let wroteLocal = false
  try {
    window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, encoded)
    wroteLocal = true
  } catch {
    console.warn('[grid-builder] localStorage quota exceeded — falling back to session/window.name')
  }
  try {
    window.sessionStorage.setItem(GRID_PROJECTS_SESSION_STORAGE_KEY, encoded)
  } catch { /* noop */ }
  if (!wroteLocal) {
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
  try { window.localStorage.setItem(GRID_PROJECTS_STORAGE_KEY, encoded) } catch { /* noop */ }
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

function encodeState(state: GridProjectsState): string {
  const raw = JSON.stringify(state)
  return `${COMPRESSED_PREFIX}${compressToUTF16(raw)}`
}

function decodeState(raw: string): GridProjectsState | null {
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

function broadcastGridPackage(pkg: GridPackage | null): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(GRID_PACKAGE_BROADCAST_CHANNEL)
    channel.postMessage({ pkg })
    channel.close()
  } catch {
    // noop
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

export function loadGridPackage(): GridPackage | null {
  const projectsState = loadGridProjectsState()
  const active = projectsState.projects.find(
    (project) => project.id === projectsState.activeProjectId,
  )
  if (active) return normalizeGridPackage(active.pkg)

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
      }))
      return parsed
    }

    const localRaw = window.localStorage.getItem(GRID_PROJECTS_STORAGE_KEY)
    const localState = hydrateFromRaw(localRaw)
    if (localState) {
      inMemoryProjectsState = localState
      return localState
    }

    const sessionRaw = window.sessionStorage.getItem(GRID_PROJECTS_SESSION_STORAGE_KEY)
    const sessionState = hydrateFromRaw(sessionRaw)
    if (sessionState) {
      inMemoryProjectsState = sessionState
      return sessionState
    }

    const windowNameState = readWindowNameState()
    if (windowNameState) {
      inMemoryProjectsState = windowNameState
      return windowNameState
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

  // Debounce: wait 800ms of inactivity, then write in the next macrotask.
  // beforeunload (registered above) guarantees data is saved on page refresh/close.
  persistTimer = setTimeout(() => {
    persistTimer = null
    const snapshot = pendingPersistState
    if (!snapshot) return
    pendingPersistState = null

    // Defer actual write to a separate macrotask so it can't block the current frame.
    if (typeof window.requestIdleCallback === 'function') {
      // rIC fires when browser is idle — no forced timeout so it never interrupts interaction
      idlePersistHandle = window.requestIdleCallback(() => {
        idlePersistHandle = null
        persistNow(snapshot)
      })
    } else if (typeof MessageChannel !== 'undefined') {
      const mc = new MessageChannel()
      mc.port1.onmessage = () => { persistNow(snapshot); mc.port1.close() }
      mc.port2.postMessage(null)
    } else {
      setTimeout(() => persistNow(snapshot), 0)
    }
  }, 800)
}

// Synchronously update the in-memory state — called from apply()'s setState updater
// so beforeunload always has the absolute latest state even before the useEffect fires.
export function touchInMemoryState(state: GridProjectsState): void {
  inMemoryProjectsState = state
}

export function publishGridProjectsState(state?: GridProjectsState): void {
  if (typeof window === 'undefined') return
  const runtimeState = state ?? inMemoryProjectsState ?? loadGridProjectsState()
  const active = runtimeState.projects.find((project) => project.id === runtimeState.activeProjectId)
  window.dispatchEvent(new CustomEvent(GRID_PACKAGE_EVENT, { detail: { pkg: active?.pkg ?? null } }))
  broadcastGridPackage(active?.pkg ?? null)
}

