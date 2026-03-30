import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { createDefaultGridPackage, createEmptyGridPackage } from '../components/grid/builder/defaultPackage'
import {
  buildRuntimeAtlasForPackageWithFallback,
  loadGridProjectsState,
  mirrorExistingRuntimeSnapshotToDevServer,
  publishRuntimePackages,
  saveGridProjectsState,
  saveGridProjectsStateNow,
  selectProjectPackage,
  touchInMemoryState,
} from '../components/grid/builder/storage'
import { useSupabaseGridSync } from '../hooks/useSupabaseGridSync'
import { isSupabaseAuthEnabled } from '../lib/supabaseClient'
import { pushRuntimeSnapshotToSupabaseFromBrowser } from '../services/gridCloudSupabase'
import type { BetZoneId } from '../game/types'
import type { GridLayer, GridPackage, GridProject, GridProjectsState, GridVisualState } from '../components/grid/builder/types'

const STATES: GridVisualState[] = ['default', 'hover', 'active', 'chipPlaced', 'disabled', 'locked']
type DragMode = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se'
type CanvasInteraction = { layerId: string; mode: DragMode; startClientX: number; startClientY: number; startX: number; startY: number; startW: number; startH: number; stateKey: GridVisualState; liveX: number; liveY: number; liveW: number; liveH: number }
type SplitterInteraction = {
  mode: 'viewer' | 'sidebar'
  startClientX: number
  startWidth: number
}
type PanInteraction = { startClientX: number; startClientY: number; startPanX: number; startPanY: number; currentPanX?: number; currentPanY?: number }
type NewProjectTemplate = 'empty' | 'default'

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function fallbackZoneId(layerId: string): BetZoneId {
  return (`zone_${layerId.replace(/[^a-zA-Z0-9_]/g, '_')}`) as BetZoneId
}

// Stable reference — prevents useEffect re-run every render when no layer is selected
const DEFAULT_ENABLED_STATES: GridVisualState[] = ['default']

/** Both desktop + mobile packages — otherwise edits in the “other” builder mode never publish or hit the LAN relay. */
function getRuntimePublishFingerprint(state: GridProjectsState): string {
  const active =
    state.projects.find((project) => project.id === state.activeProjectId) ??
    state.projects[0]
  if (!active) return 'none'
  const desktop = active.pkg
  const mobile = active.mobilePkg ?? active.pkg
  return `${active.id}:${JSON.stringify({ desktop, mobile })}`
}

function fitRectIntoFrame(
  rect: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const isOutside =
    rect.x >= frame.width ||
    rect.y >= frame.height ||
    rect.x + rect.width <= 0 ||
    rect.y + rect.height <= 0

  if (!isOutside) return rect

  return {
    x: Math.max(0, (frame.width - rect.width) / 2),
    y: Math.max(0, (frame.height - rect.height) / 2),
    width: rect.width,
    height: rect.height,
  }
}

function centerClipRectInFrame(
  width: number,
  height: number,
  frame: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  return {
    x: (frame.width - safeWidth) / 2,
    y: (frame.height - safeHeight) / 2,
    width: safeWidth,
    height: safeHeight,
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function svgTextToDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}

function extractSvgText(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('<svg') && trimmed.includes('</svg>')) return trimmed
  const match = trimmed.match(/<svg[\s\S]*?<\/svg>/i)
  return match ? match[0] : null
}

function parseSvgNaturalSize(svgText: string): { width: number; height: number } | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgText, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (!svg) return null

    const widthAttr = svg.getAttribute('width')
    const heightAttr = svg.getAttribute('height')
    const toNumber = (value: string | null): number | null => {
      if (!value) return null
      const num = Number.parseFloat(value.replace(/[^\d.-]/g, ''))
      return Number.isFinite(num) && num > 0 ? num : null
    }

    const width = toNumber(widthAttr)
    const height = toNumber(heightAttr)
    if (width && height) return { width, height }

    const viewBox = svg.getAttribute('viewBox')
    if (viewBox) {
      const parts = viewBox
        .trim()
        .split(/[\s,]+/)
        .map((p) => Number.parseFloat(p))
      if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
        const vbW = parts[2]
        const vbH = parts[3]
        if (vbW > 0 && vbH > 0) {
          return { width: vbW, height: vbH }
        }
      }
    }
    return null
  } catch {
    return null
  }
}

function parseSvgPlacement(svgText: string): {
  x: number | null
  y: number | null
  width: number | null
  height: number | null
} | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgText, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (!svg) return null
    const toNumber = (value: string | null): number | null => {
      if (!value) return null
      const num = Number.parseFloat(value.replace(/[^\d.-]/g, ''))
      return Number.isFinite(num) ? num : null
    }

    const width = toNumber(svg.getAttribute('width'))
    const height = toNumber(svg.getAttribute('height'))
    const x = toNumber(svg.getAttribute('x'))
    const y = toNumber(svg.getAttribute('y'))
    const viewBox = svg.getAttribute('viewBox')
    if (!viewBox) {
      return { x, y, width, height }
    }
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value))
    if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
      return { x, y, width, height }
    }
    const [vbX, vbY, vbW, vbH] = parts
    return {
      x: x ?? vbX,
      y: y ?? vbY,
      width: width ?? vbW,
      height: height ?? vbH,
    }
  } catch {
    return null
  }
}

function parseSvgContentBounds(svgText: string): { x: number; y: number; width: number; height: number } | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgText, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (!svg) return null

    const ns = 'http://www.w3.org/2000/svg'
    const measuredRoot = document.createElementNS(ns, 'svg')
    measuredRoot.setAttribute('xmlns', ns)
    const rootViewBox = svg.getAttribute('viewBox')
    if (rootViewBox) measuredRoot.setAttribute('viewBox', rootViewBox)
    if (svg.getAttribute('width')) measuredRoot.setAttribute('width', svg.getAttribute('width') as string)
    if (svg.getAttribute('height')) measuredRoot.setAttribute('height', svg.getAttribute('height') as string)
    measuredRoot.style.position = 'absolute'
    measuredRoot.style.left = '-100000px'
    measuredRoot.style.top = '-100000px'
    measuredRoot.style.opacity = '0'
    measuredRoot.style.pointerEvents = 'none'

    const defs = svg.querySelector('defs')
    if (defs) measuredRoot.appendChild(defs.cloneNode(true))
    const group = document.createElementNS(ns, 'g')
    Array.from(svg.children).forEach((node) => {
      const tag = node.tagName.toLowerCase()
      if (tag === 'defs' || tag === 'style' || tag === 'metadata' || tag === 'title' || tag === 'desc') return
      group.appendChild(node.cloneNode(true))
    })
    measuredRoot.appendChild(group)
    document.body.appendChild(measuredRoot)

    try {
      const bbox = group.getBBox()
      if (
        Number.isFinite(bbox.x) &&
        Number.isFinite(bbox.y) &&
        Number.isFinite(bbox.width) &&
        Number.isFinite(bbox.height) &&
        bbox.width > 0 &&
        bbox.height > 0
      ) {
        return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height }
      }
      return null
    } finally {
      measuredRoot.remove()
    }
  } catch {
    return null
  }
}

function computeInteractionRect(
  mode: DragMode,
  startX: number, startY: number, startW: number, startH: number,
  startClientX: number, startClientY: number,
  clientX: number, clientY: number,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  const minSize = 8
  const dx = (clientX - startClientX) / scale
  const dy = (clientY - startClientY) / scale
  if (mode === 'move') return { x: startX + dx, y: startY + dy, width: startW, height: startH }
  if (mode === 'resize-se') return { x: startX, y: startY, width: Math.max(minSize, startW + dx), height: Math.max(minSize, startH + dy) }
  if (mode === 'resize-ne') {
    const w = Math.max(minSize, startW + dx); const h = Math.max(minSize, startH - dy)
    return { x: startX, y: startY + (startH - h), width: w, height: h }
  }
  if (mode === 'resize-sw') {
    const w = Math.max(minSize, startW - dx); const h = Math.max(minSize, startH + dy)
    return { x: startX + (startW - w), y: startY, width: w, height: h }
  }
  const w = Math.max(minSize, startW - dx); const h = Math.max(minSize, startH - dy)
  return { x: startX + (startW - w), y: startY + (startH - h), width: w, height: h }
}

function safeRect(
  rect: { x?: number; y?: number; width?: number; height?: number } | undefined,
  fallback: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const x = Number.isFinite(rect?.x) ? Number(rect?.x) : fallback.x
  const y = Number.isFinite(rect?.y) ? Number(rect?.y) : fallback.y
  const width = Number.isFinite(rect?.width) && Number(rect?.width) > 0 ? Number(rect?.width) : fallback.width
  const height = Number.isFinite(rect?.height) && Number(rect?.height) > 0 ? Number(rect?.height) : fallback.height
  return { x, y, width, height }
}


type CanvasLayerProps = {
  layerId: string
  src: string
  alt: string
  left: number
  top: number
  width: number
  height: number
  opacity: number
  zIndex: number
}
const CanvasLayer = memo(function CanvasLayer({ layerId, src, alt, left, top, width, height, opacity, zIndex }: CanvasLayerProps) {
  return (
    <img
      data-layer-id={layerId}
      className="grid-builder__layer-preview"
      src={src}
      alt={alt}
      style={{ left, top, width, height, opacity, zIndex } as CSSProperties}
    />
  )
})

// ---------------------------------------------------------------------------
// DeferredTextInput — local state, commits to parent only on blur or Enter.
// Prevents global state updates (and full re-renders) on every keystroke.
// ---------------------------------------------------------------------------
type DeferredTextInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onCommit: (value: string) => void
}
const DeferredTextInput = memo(function DeferredTextInput({ value, onCommit, onBlur, onKeyDown, ...rest }: DeferredTextInputProps) {
  const [local, setLocal] = useState(value)
  const committed = useRef(value)

  // Sync when the external value changes (e.g. different layer selected)
  useEffect(() => {
    if (value !== committed.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync from props
      setLocal(value)
      committed.current = value
    }
  }, [value])

  const commit = (next: string) => {
    if (next !== committed.current) {
      committed.current = next
      onCommit(next)
    }
  }

  return (
    <input
      {...rest}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => {
        commit(local)
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(local)
        onKeyDown?.(e)
      }}
    />
  )
})

// DeferredNumberInput — same contract as DeferredTextInput but for numbers.
// Stores the value as a raw string so the user can type freely (e.g. "-", "0.0").
// Commits the parsed number to the parent only on blur, Enter, or Tab.
// Shift+Arrow steps bypass deferral and commit immediately for live preview.
// ---------------------------------------------------------------------------
type DeferredNumberInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onCommit: (value: number) => void
  onStepCommit?: (value: number) => void
}
const DeferredNumberInput = memo(function DeferredNumberInput({
  value,
  onCommit,
  onStepCommit,
  onBlur,
  onKeyDown,
  ...rest
}: DeferredNumberInputProps) {
  const [local, setLocal] = useState(String(value))
  const committedRef = useRef(value)
  const focusedRef = useRef(false)

  // Sync external value → local only when the user is NOT mid-edit.
  // This prevents overwriting what the user is typing when an external update arrives.
  useEffect(() => {
    if (!focusedRef.current && value !== committedRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync from props when not focused
      setLocal(String(value))
      committedRef.current = value
    }
  }, [value])

  const commit = (raw: string) => {
    const parsed = parseFloat(raw)
    const safe = Number.isFinite(parsed) ? parsed : committedRef.current
    if (safe !== committedRef.current) {
      committedRef.current = safe
      onCommit(safe)
    }
  }

  return (
    <input
      {...rest}
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => { focusedRef.current = true }}
      onBlur={(e) => {
        focusedRef.current = false
        commit(local)
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Tab') {
          commit(local)
        }
        // Shift+Arrow: immediate step commit for live preview.
        // Step size: use the `step` prop if provided, otherwise 10 for integers or 0.1 for decimals.
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          const current = parseFloat(local)
          const safe = Number.isFinite(current) ? current : committedRef.current
          const stepSize = rest.step != null ? Number(rest.step) * 10 : 10
          const next = safe + (e.key === 'ArrowUp' ? stepSize : -stepSize)
          const clamped = rest.min != null ? Math.max(Number(rest.min), next) : next
          const clampedFinal = rest.max != null ? Math.min(Number(rest.max), clamped) : clamped
          const rounded = Math.round(clampedFinal / stepSize * 1e10) / 1e10
          setLocal(String(rounded))
          committedRef.current = rounded
          ;(onStepCommit ?? onCommit)(rounded)
          return
        }
        onKeyDown?.(e)
      }}
    />
  )
})

type LayerItemProps = {
  layer: import('../components/grid/builder/types').GridLayer
  isSelected: boolean
  isDragging: boolean
  dropIndicator: 'before' | 'after' | null
  isRenaming: boolean
  renamingValue: string
  editStateKey: import('../components/grid/builder/types').GridVisualState
  onSelect: (id: string) => void
  onDragStart: (id: string) => void
  onDragOverLayer: (id: string, position: 'before' | 'after') => void
  onDropOnLayer: (id: string) => void
  onDragEnd: () => void
  onRenamingChange: (val: string) => void
  onRenamingCommit: () => void
  onRenamingCancel: () => void
  onRenamingStart: (layer: import('../components/grid/builder/types').GridLayer) => void
  onToggleVisible: (id: string, visible: boolean) => void
  onToggleLocked: (id: string, locked: boolean) => void
}
const LayerItem = memo(function LayerItem({
  layer, isSelected, isDragging, dropIndicator, isRenaming, renamingValue, editStateKey,
  onSelect, onDragStart, onDragOverLayer, onDropOnLayer, onDragEnd,
  onRenamingChange, onRenamingCommit, onRenamingCancel, onRenamingStart,
  onToggleVisible, onToggleLocked,
}: LayerItemProps) {
  const visible = layer.stateStyles[editStateKey]?.visible ?? true
  const className = [
    'grid-builder__layer-item',
    isSelected ? 'is-selected' : '',
    isDragging ? 'is-dragging' : '',
    dropIndicator === 'before' ? 'is-drop-before' : '',
    dropIndicator === 'after' ? 'is-drop-after' : '',
  ].filter(Boolean).join(' ')
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className={className}
      onClick={() => startTransition(() => onSelect(layer.id))}
      onDragStart={() => onDragStart(layer.id)}
      onDragOver={(e) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        onDragOverLayer(layer.id, position)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnLayer(layer.id)
      }}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          startTransition(() => onSelect(layer.id))
        }
      }}
    >
      <span className="grid-builder__layer-handle" aria-hidden="true">
        <svg viewBox="0 0 8 14" width="8" height="14" fill="currentColor">
          <circle cx="2" cy="2"  r="1.2" /><circle cx="6" cy="2"  r="1.2" />
          <circle cx="2" cy="7"  r="1.2" /><circle cx="6" cy="7"  r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </span>
      <span className="grid-builder__layer-main">
        <span className="grid-builder__layer-thumb" aria-hidden>
          <img className="grid-builder__layer-thumb-image" src={layer.src} alt="" />
        </span>
        <span className="grid-builder__layer-meta">
          {isRenaming ? (
            <input
              autoFocus
              className="grid-builder__layer-rename"
              value={renamingValue}
              onChange={(e) => onRenamingChange(e.target.value)}
              onBlur={onRenamingCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenamingCommit()
                if (e.key === 'Escape') onRenamingCancel()
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="grid-builder__layer-name"
              onDoubleClick={(e) => {
                e.stopPropagation()
                onRenamingStart(layer)
              }}
            >
              {layer.name}
            </span>
          )}
          <span className="grid-builder__layer-z">z{layer.zIndex}</span>
        </span>
      </span>
      <span className="grid-builder__layer-tools">
        <button
          type="button"
          className={`grid-builder__layer-tool-btn ${visible ? 'is-active' : ''}`}
          title={visible ? 'Hide layer' : 'Show layer'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleVisible(layer.id, !visible)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M2.5 12s3.8-6 9.5-6 9.5 6 9.5 6-3.8 6-9.5 6-9.5-6-9.5-6z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
        <button
          type="button"
          className={`grid-builder__layer-tool-btn ${layer.locked ? 'is-active' : ''}`}
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleLocked(layer.id, !layer.locked)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7.5 10V8a4.5 4.5 0 1 1 9 0v2M6.5 10h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </span>
    </div>
  )
})

export function GridCanvasBuilder() {
  const [projectsState, setProjectsState] = useState<GridProjectsState>(loadGridProjectsState)
  const projectsStateRef = useRef<GridProjectsState>(projectsState)
  const [updateRuntimeStatus, setUpdateRuntimeStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [updateRuntimeDetail, setUpdateRuntimeDetail] = useState<string | null>(null)
  const lastRuntimePublishFingerprintRef = useRef<string | null>(null)

  const { status: cloudSyncStatus, saveNow: saveProjectsToCloudNow } = useSupabaseGridSync(
    projectsState,
    (loaded) => {
      setProjectsState(loaded)
      projectsStateRef.current = loaded
      touchInMemoryState(loaded)
    },
    { autoSync: true },
  )
  const activeProject = useMemo(
    () =>
      projectsState.projects.find(
        (project) => project.id === projectsState.activeProjectId,
      ) ?? projectsState.projects[0],
    [projectsState],
  )
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'mobile'>('desktop')
  const deviceModeRef = useRef<'desktop' | 'mobile'>('desktop')
  const pkg = deviceMode === 'desktop'
    ? activeProject.pkg
    : (activeProject.mobilePkg ?? activeProject.pkg)
  const [selectedLayerId, setSelectedLayerId] = useState<string>(pkg.layers[0]?.id ?? '')
  // Per-layer preview state: each layer independently shows its own state in the canvas.
  // editStateKey is derived from the selected layer's entry — used by the editor panel.
  const [layerEditStates, setLayerEditStates] = useState<Record<string, GridVisualState>>({})
  const editStateKey: GridVisualState = layerEditStates[selectedLayerId] ?? 'default'
  const [gridViewState, setGridViewState] = useState<'open' | 'closed'>('open')
  const [rulersEnabled, setRulersEnabled] = useState(true)
  const preserveSvgCoordinates = true
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  )
  const [viewerWidth, setViewerWidth] = useState<number>(
    typeof window !== 'undefined' ? Math.max(520, Math.floor(window.innerWidth * 0.6)) : 860,
  )
  const [sidebarWidth, setSidebarWidth] = useState<number>(340)
  const [previewZoom, setPreviewZoom] = useState<number>(1)
  const [previewPan, setPreviewPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [spacePressed, setSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null)
  const [dragOverInfo, setDragOverInfo] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const dragOverInfoRef = useRef<{ id: string; position: 'before' | 'after' } | null>(null)
  dragOverInfoRef.current = dragOverInfo
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [layerImportOpen, setLayerImportOpen] = useState(false)
  const [layerDropActive, setLayerDropActive] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectTemplate, setNewProjectTemplate] = useState<NewProjectTemplate>('empty')
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const [projectDropdownRect, setProjectDropdownRect] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [headerMenuRect, setHeaderMenuRect] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const [previewViewportSize, setPreviewViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  })
  const [stateCreateMenuOpen, setStateCreateMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const previewViewportRef = useRef<HTMLDivElement | null>(null)
  const projectDropdownTriggerRef = useRef<HTMLButtonElement | null>(null)
  const projectDropdownMenuRef = useRef<HTMLDivElement | null>(null)
  const headerMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  const stateCreateTriggerRef = useRef<HTMLButtonElement | null>(null)
  const stateCreateMenuRef = useRef<HTMLDivElement | null>(null)
  const layerImportFileInputRef = useRef<HTMLInputElement | null>(null)
  const interactionRef = useRef<CanvasInteraction | null>(null)
  const splitterRef = useRef<SplitterInteraction | null>(null)
  const panRef = useRef<PanInteraction | null>(null)
  const undoStackRef = useRef<GridProjectsState[]>([])
  const redoStackRef = useRef<GridProjectsState[]>([])
  const isUndoingRef = useRef(false)
  const isRedoingRef = useRef(false)
  const undoPendingBaseRef = useRef<GridProjectsState | null>(null)
  const undoPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable refs for zero-overhead event handlers (no stale closures)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const selectionBoxRef = useRef<HTMLDivElement>(null)
  const canvasStageRef = useRef<HTMLDivElement>(null) // for DOM-direct pan
  const previewScaleRef = useRef(1)
  const editStateKeyRef = useRef<GridVisualState>('default')
  // DOM-direct arrow key movement state
  const pendingArrowRef = useRef<{ dx: number; dy: number } | null>(null)
  const arrowBaseRectRef = useRef<{ layerId: string; stateKey: GridVisualState; x: number; y: number; w: number; h: number } | null>(null)
  const arrowCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest stable ref to applyLayerRect (updated every render, read in stable callbacks)
  const applyLayerRectCallbackRef = useRef<(layerId: string, state: GridVisualState, rect: { x: number; y: number; width: number; height: number }) => void>(() => {})
  // Stable refs for cleanup functions that depend on render-time closures
  const stopSplitterInteractionRef = useRef<() => void>(() => {})
  const stopPanInteractionRef = useRef<() => void>(() => {})
  // Hot-path refs: always current, no effect deps needed
  const selectedLayerRef = useRef<import('../components/grid/builder/types').GridLayer | null>(null)
  const selectedRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const removeLayerRef = useRef<(id: string) => void>(() => {})
  const pushActiveGridToRuntimeRef = useRef<() => Promise<void> | void>(() => {})
  // Stable handler refs — registered once, always call the latest closure
  const onPasteHandlerRef = useRef<(event: ClipboardEvent) => void>(() => {})
  const onArrowKeyDownHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const onArrowKeyUpHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  // Keeps the latest layerEditStates for stable callbacks (layerItemOnToggleVisible)
  const layerEditStatesRef = useRef<Record<string, GridVisualState>>({})

  const selectedLayer = useMemo(
    () => pkg.layers.find((layer) => layer.id === selectedLayerId) ?? null,
    [pkg.layers, selectedLayerId],
  )
  // Single sort for both canvas and sidebar
  const sortedLayers = useMemo(
    () => pkg.layers.slice().sort((a, b) => a.zIndex - b.zIndex),
    [pkg.layers],
  )
  // visibleLayers maps sorted layers with src/rect per state — reuses sortedLayers (no double sort)
  const visibleLayers = useMemo(
    () =>
      sortedLayers.map((layer) => {
        // Each layer independently previews its own state — not a global state.
        const stateKey: GridVisualState = layerEditStates[layer.id] ?? 'default'
        const src =
          stateKey === 'default'
            ? layer.src
            : layer.stateSvgs?.[stateKey] ?? layer.src
        const rect =
          stateKey === 'default'
            ? { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
            : layer.stateRects?.[stateKey] ?? { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
        return { layer, src, rect, stateKey }
      }),
    [sortedLayers, layerEditStates],
  )

  const editStateStyle = selectedLayer?.stateStyles[editStateKey]
  const selectedAnimation = selectedLayer?.animation ?? {
    preset: 'none' as const,
    trigger: 'while-active' as const,
    fromState: 'any' as const,
    toState: 'any' as const,
    durationMs: 220,
    delayMs: 0,
    easing: 'ease-out' as const,
    intensity: 1,
  }
  // Use stable constant when no layer selected — prevents useEffect from re-running every render
  const enabledStateKeys = selectedLayer?.enabledStates ?? DEFAULT_ENABLED_STATES
  const availableToCreateStates = STATES.filter((state) => !enabledStateKeys.includes(state))
  const previewScale = pkg.frame.scale * previewZoom

  // Keep hot-path refs in sync on every render (no useEffect overhead)
  projectsStateRef.current = projectsState
  deviceModeRef.current = deviceMode
  previewScaleRef.current = previewScale
  editStateKeyRef.current = editStateKey
  layerEditStatesRef.current = layerEditStates
  // These are updated further down after their values are computed:
  // selectedLayerRef, selectedRectRef, removeLayerRef, pushActiveGridToRuntimeRef

  const minViewerPanelWidth = 360
  const minEditorPanelWidth = 300
  const minSidebarPanelWidth = 280
  const splitterWidth = 1

  const { availableBuilderWidth, isCompactBuilderLayout, clampedViewerWidth, clampedSidebarWidth, builderLayoutStyle } = useMemo(() => {
    const builderHorizontalMargins = 24
    const builderPanelGaps = 48
    const avail = Math.max(320, viewportWidth - builderHorizontalMargins - builderPanelGaps)
    const compact = avail < minViewerPanelWidth + minEditorPanelWidth + minSidebarPanelWidth
    const cViewerW = Math.max(minViewerPanelWidth, Math.min(viewerWidth, avail - minEditorPanelWidth - minSidebarPanelWidth - splitterWidth * 2))
    const cSidebarW = Math.max(minSidebarPanelWidth, Math.min(sidebarWidth, avail - cViewerW - minEditorPanelWidth - splitterWidth * 2))
    const layoutStyle: CSSProperties = compact
      ? { gridTemplateColumns: '1fr' }
      : { gridTemplateColumns: `${cViewerW}px ${splitterWidth}px minmax(${minEditorPanelWidth}px, 1fr) ${splitterWidth}px ${cSidebarW}px` }
    return { availableBuilderWidth: avail, isCompactBuilderLayout: compact, clampedViewerWidth: cViewerW, clampedSidebarWidth: cSidebarW, builderLayoutStyle: layoutStyle }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportWidth, viewerWidth, sidebarWidth])
  const rulerStepPx = 50
  const horizontalRulerMarks = useMemo(
    () =>
      Array.from({
        length: Math.max(2, Math.ceil(previewViewportSize.width / rulerStepPx) + 1),
      }),
    [previewViewportSize.width],
  )
  const verticalRulerMarks = useMemo(
    () =>
      Array.from({
        length: Math.max(2, Math.ceil(previewViewportSize.height / rulerStepPx) + 1),
      }),
    [previewViewportSize.height],
  )

  // Sets the preview state for the currently selected layer only (per-layer, not global).
  const setEditStateKey = useCallback((state: GridVisualState) => {
    setLayerEditStates((prev) => ({ ...prev, [selectedLayerId]: state }))
  }, [selectedLayerId])

  // apply is stable (useCallback with empty deps) — only uses refs and setProjectsState
  const apply = useCallback((updater: (current: GridPackage) => GridPackage) => {
    startTransition(() => {
      setProjectsState((currentState) => {
        if (!isUndoingRef.current && !isRedoingRef.current) {
          // New user action clears the redo stack
          redoStackRef.current = []
          if (!undoPendingBaseRef.current) {
            undoPendingBaseRef.current = currentState
          }
          if (undoPendingTimerRef.current) {
            clearTimeout(undoPendingTimerRef.current)
          }
          undoPendingTimerRef.current = setTimeout(() => {
            if (undoPendingBaseRef.current) {
              undoStackRef.current.push(undoPendingBaseRef.current)
              if (undoStackRef.current.length > 100) {
                undoStackRef.current.shift()
              }
              undoPendingBaseRef.current = null
            }
            undoPendingTimerRef.current = null
          }, 220)
        }
        const mode = deviceModeRef.current
        const nowIso = new Date().toISOString()
        const nextProjects = currentState.projects.map((project) => {
          if (project.id !== currentState.activeProjectId) return project
          const currentPkg = mode === 'desktop' ? project.pkg : (project.mobilePkg ?? project.pkg)
          const nextPkg = updater(currentPkg)
          const nextPkgWithMeta = {
            ...nextPkg,
            meta: {
              ...nextPkg.meta,
              updatedAt: nowIso,
            },
          }
          if (mode === 'mobile') {
            return {
              ...project,
              name: nextPkgWithMeta.meta.name || project.name,
              updatedAt: nowIso,
              mobilePkg: nextPkgWithMeta,
            }
          }
          return {
            ...project,
            name: nextPkgWithMeta.meta.name || project.name,
            updatedAt: nowIso,
            pkg: nextPkgWithMeta,
          }
        })
        const next = { ...currentState, projects: nextProjects }
        // Synchronously keep in-memory state current so beforeunload always has
        // the latest version even if the useEffect hasn't fired yet.
        touchInMemoryState(next)
        return next
      })
    })
  }, [])

  const pushUndoSnapshotNow = () => {
    if (isUndoingRef.current || isRedoingRef.current) return
    // New deliberate action clears redo stack
    redoStackRef.current = []
    if (undoPendingTimerRef.current) {
      clearTimeout(undoPendingTimerRef.current)
      undoPendingTimerRef.current = null
    }
    if (undoPendingBaseRef.current) {
      undoStackRef.current.push(undoPendingBaseRef.current)
      undoPendingBaseRef.current = null
    } else {
      undoStackRef.current.push(projectsState)
    }
    if (undoStackRef.current.length > 100) {
      undoStackRef.current.shift()
    }
  }

  const switchProject = (projectId: string) => {
    const target = projectsState.projects.find((project) => project.id === projectId)
    if (!target) return
    redoStackRef.current = []
    undoStackRef.current.push(projectsState)
    if (undoStackRef.current.length > 100) {
      undoStackRef.current.shift()
    }
    const next: GridProjectsState = { ...projectsState, activeProjectId: projectId }
    touchInMemoryState(next)
    setProjectsState(next)
    const targetPkg = deviceMode === 'desktop' ? target.pkg : (target.mobilePkg ?? target.pkg)
    setSelectedLayerId(targetPkg.layers[0]?.id ?? '')
  }

  const switchDeviceMode = (mode: 'desktop' | 'mobile') => {
    if (mode === deviceMode) return
    if (mode === 'mobile' && !activeProject.mobilePkg) {
      // Initialize mobile package from desktop to avoid blank/broken runtime
      // when users switch to mobile for the first time.
      const freshMobilePkg = structuredClone(activeProject.pkg)
      freshMobilePkg.meta.name = activeProject.name
      freshMobilePkg.meta.updatedAt = new Date().toISOString()
      setProjectsState((current) => {
        const next = {
          ...current,
          projects: current.projects.map((p) =>
            p.id === current.activeProjectId
              ? { ...p, updatedAt: freshMobilePkg.meta.updatedAt, mobilePkg: freshMobilePkg }
              : p,
          ),
        }
        touchInMemoryState(next)
        return next
      })
      setSelectedLayerId(freshMobilePkg.layers[0]?.id ?? '')
    } else {
      const targetPkg = mode === 'desktop' ? activeProject.pkg : (activeProject.mobilePkg ?? activeProject.pkg)
      setSelectedLayerId(targetPkg.layers[0]?.id ?? '')
    }
    setDeviceMode(mode)
  }

  const pushActiveGridToRuntime = async () => {
    setUpdateRuntimeStatus('saving')
    setUpdateRuntimeDetail(null)
    const detailParts: string[] = []
    try {
      const runtimeFingerprint = getRuntimePublishFingerprint(projectsState)
      const shouldPublishToRuntime = runtimeFingerprint !== lastRuntimePublishFingerprintRef.current
      saveGridProjectsStateNow(projectsState)
      const projectsCloudOk = await saveProjectsToCloudNow(projectsState)
      if (!projectsCloudOk) detailParts.push('account projects: sync failed')
      if (shouldPublishToRuntime) {
        const active = projectsState.projects.find((p) => p.id === projectsState.activeProjectId)
        const desktopBase = selectProjectPackage(active, 'desktop')
        const mobileBase = selectProjectPackage(active, 'mobile')
        // Mobile: keep SVG (and other vector) sources — runtime uses an `<img>` stack for sharp zoom/DPR.
        // Atlas bake still rasterizes for optional `?mobileAtlas=1`, at 3× logical resolution.
        const { pkg: desktopPkg, error: desktopAtlasErr } = await buildRuntimeAtlasForPackageWithFallback(
          desktopBase,
          4,
          8192,
          2,
        )
        const { pkg: mobilePkg, error: mobileAtlasErr } = await buildRuntimeAtlasForPackageWithFallback(
          mobileBase,
          5,
          8192,
          3,
        )
        detailParts.push(
          ...(
            [
              desktopAtlasErr && `desktop atlas: ${desktopAtlasErr}`,
              mobileAtlasErr && `mobile atlas: ${mobileAtlasErr}`,
            ].filter(Boolean) as string[]
          ),
        )
        publishRuntimePackages(desktopPkg, mobilePkg, deviceModeRef.current)
        lastRuntimePublishFingerprintRef.current = runtimeFingerprint
      } else {
        // Re-push last snapshot to the dev relay so phones can catch up (relay reset, new tab, etc.)
        mirrorExistingRuntimeSnapshotToDevServer()
      }
      const cloudResult = await pushRuntimeSnapshotToSupabaseFromBrowser()
      if (!cloudResult.ok) detailParts.push(`cloud: ${cloudResult.error}`)
      if (detailParts.length > 0) setUpdateRuntimeDetail(detailParts.join(' · '))
      setUpdateRuntimeStatus('success')
    } catch (e) {
      console.error('[SciBo] pushActiveGridToRuntime failed:', e)
      const msg = e instanceof Error ? e.message : String(e)
      setUpdateRuntimeDetail(msg)
      setUpdateRuntimeStatus('error')
    }
  }
  pushActiveGridToRuntimeRef.current = pushActiveGridToRuntime

  const onUploadLayers = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const startZ = pkg.layers.length + 1
    const built: GridLayer[] = []
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const svgText = await file.text()
      const src = await readAsDataUrl(file)
      const natural = parseSvgNaturalSize(svgText)
      const placement = parseSvgPlacement(svgText)
      const contentBounds = parseSvgContentBounds(svgText)
      const initialRect = fitRectIntoFrame(
        {
          x: preserveSvgCoordinates ? (placement?.x ?? contentBounds?.x ?? 0) : 0,
          y: preserveSvgCoordinates ? (placement?.y ?? contentBounds?.y ?? 0) : 0,
          width: placement?.width ?? natural?.width ?? contentBounds?.width ?? pkg.frame.width,
          height: placement?.height ?? natural?.height ?? contentBounds?.height ?? pkg.frame.height,
        },
        pkg.frame,
      )
      const layer: GridLayer = {
        id: uid('layer'),
        name: file.name.replace(/\.[^.]+$/, ''),
        locked: false,
        zoneId: uid('zone') as BetZoneId,
        src,
        originalWidth: initialRect.width,
        originalHeight: initialRect.height,
        x: initialRect.x,
        y: initialRect.y,
        width: initialRect.width,
        height: initialRect.height,
        zIndex: startZ + i,
        stateStyles: {
          default: { visible: true, opacity: 1 },
          hover: { visible: true, opacity: 1 },
          active: { visible: true, opacity: 1 },
          chipPlaced: { visible: true, opacity: 1 },
          disabled: { visible: true, opacity: 0.8 },
          locked: { visible: true, opacity: 1 },
        },
        animation: {
          preset: 'none',
          trigger: 'while-active',
          fromState: 'any',
          toState: 'any',
          durationMs: 220,
          delayMs: 0,
          easing: 'ease-out',
          intensity: 1,
        },
        globalVisibility: {
          open: true,
          closed: true,
        },
        enabledStates: ['default'],
        stateSvgs: {},
        stateRects: {},
      }
      built.push(layer)
    }
    apply((current) => ({
      ...current,
      layers: [...current.layers, ...built],
    }))
    setSelectedLayerId(built[0]?.id ?? selectedLayerId)
  }

  const createLayerFromSvgText = (svgText: string, name = 'Pasted SVG') => {
    const natural = parseSvgNaturalSize(svgText)
    const placement = parseSvgPlacement(svgText)
    const contentBounds = parseSvgContentBounds(svgText)
    const initialRect = fitRectIntoFrame(
      {
        x: preserveSvgCoordinates ? (placement?.x ?? contentBounds?.x ?? 0) : 0,
        y: preserveSvgCoordinates ? (placement?.y ?? contentBounds?.y ?? 0) : 0,
        width: placement?.width ?? natural?.width ?? contentBounds?.width ?? pkg.frame.width,
        height: placement?.height ?? natural?.height ?? contentBounds?.height ?? pkg.frame.height,
      },
      pkg.frame,
    )
    const layer: GridLayer = {
      id: uid('layer'),
      name,
      locked: false,
      zoneId: uid('zone') as BetZoneId,
      src: svgTextToDataUrl(svgText),
      originalWidth: initialRect.width,
      originalHeight: initialRect.height,
      x: initialRect.x,
      y: initialRect.y,
      width: initialRect.width,
      height: initialRect.height,
      zIndex: pkg.layers.length + 1,
      stateStyles: {
        default: { visible: true, opacity: 1 },
        hover: { visible: true, opacity: 1 },
        active: { visible: true, opacity: 1 },
        chipPlaced: { visible: true, opacity: 1 },
        disabled: { visible: true, opacity: 0.8 },
        locked: { visible: true, opacity: 1 },
      },
      animation: {
        preset: 'none',
        trigger: 'while-active',
        fromState: 'any',
        toState: 'any',
        durationMs: 220,
        delayMs: 0,
        easing: 'ease-out',
        intensity: 1,
      },
      globalVisibility: {
        open: true,
        closed: true,
      },
      enabledStates: ['default'],
      stateSvgs: {},
      stateRects: {},
    }
    apply((current) => ({
      ...current,
      layers: [...current.layers, layer],
    }))
    setSelectedLayerId(layer.id)
  }

  const replaceSelectedLayerFromSvgText = (svgText: string) => {
    if (!selectedLayer) return
    updateLayer(selectedLayer.id, { src: svgTextToDataUrl(svgText) })
  }

  const setStateSvgFromText = (layerId: string, state: GridVisualState, svgText: string) => {
    apply((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              enabledStates: Array.from(new Set([...(layer.enabledStates ?? ['default']), state])),
              stateSvgs: {
                ...layer.stateSvgs,
                [state]: svgTextToDataUrl(svgText),
              },
              stateRects: {
                ...layer.stateRects,
                [state]:
                  layer.stateRects?.[state] ?? {
                    x: layer.x,
                    y: layer.y,
                    width: layer.width,
                    height: layer.height,
                  },
              },
            }
          : layer,
      ),
    }))
  }

  const setLayerSourceByState = (layerId: string, state: GridVisualState, svgText: string) => {
    if (state === 'default') {
      updateLayer(layerId, { src: svgTextToDataUrl(svgText) })
      return
    }
    setStateSvgFromText(layerId, state, svgText)
  }

  const pasteSvgFromClipboard = async (
    mode: 'layer' | 'replace-layer' | 'state' | 'replace-state',
  ): Promise<void> => {
    const raw = await navigator.clipboard.readText()
    const svg = extractSvgText(raw)
    if (!svg) {
      window.alert('Clipboard does not contain SVG markup.')
      return
    }
    if (mode === 'layer') {
      createLayerFromSvgText(svg)
      return
    }
    if (mode === 'state' || mode === 'replace-state') {
      if (!selectedLayer) {
        window.alert('Select a layer first.')
        return
      }
      setLayerSourceByState(selectedLayer.id, editStateKey, svg)
      return
    }
    if (!selectedLayer) {
      window.alert('Select a layer first to replace SVG.')
      return
    }
    replaceSelectedLayerFromSvgText(svg)
  }

  const updateLayer = useCallback((layerId: string, patch: Partial<GridLayer>) => {
    apply((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId ? { ...layer, ...patch } : layer,
      ),
    }))
  }, [apply])

  const startRenameLayer = useCallback((layer: GridLayer) => {
    setRenamingLayerId(layer.id)
    setRenamingValue(layer.name)
  }, [])

  const cancelRenameLayer = useCallback(() => {
    setRenamingLayerId(null)
    setRenamingValue('')
  }, [])

  const commitRenameLayer = useCallback(() => {
    setRenamingLayerId((renId) => {
      if (!renId) return renId
      setRenamingValue((val) => {
        const next = val.trim()
        if (next) updateLayer(renId, { name: next })
        return ''
      })
      return null
    })
  }, [updateLayer])

  const updateLayerState = useCallback((
    layerId: string,
    state: GridVisualState,
    patch: Partial<GridLayer['stateStyles'][GridVisualState]>,
  ) => {
    apply((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              stateStyles: {
                ...layer.stateStyles,
                [state]: { ...layer.stateStyles[state], ...patch },
              },
            }
          : layer,
      ),
    }))
  }, [apply])

  const removeLayer = useCallback((layerId: string) => {
    apply((current) => ({
      ...current,
      layers: current.layers.filter((layer) => layer.id !== layerId),
    }))
    setSelectedLayerId((prev) => (prev === layerId ? '' : prev))
  }, [apply])
  removeLayerRef.current = removeLayer

  const duplicateLayer = (layerId: string) => {
    apply((current) => {
      const source = current.layers.find((layer) => layer.id === layerId)
      if (!source) return current
      const nextId = uid('layer')
      const duplicated: GridLayer = {
        ...structuredClone(source),
        id: nextId,
        zoneId: uid('zone') as BetZoneId,
        name: `${source.name} Copy`,
        zIndex: source.zIndex + 1,
      }

      const layers = current.layers
        .map((layer) =>
          layer.zIndex > source.zIndex
            ? { ...layer, zIndex: layer.zIndex + 1 }
            : layer,
        )
        .concat(duplicated)

      return { ...current, layers }
    })
  }

  const reorderLayers = useCallback((fromLayerId: string, toLayerId: string, position: 'before' | 'after') => {
    if (fromLayerId === toLayerId) return
    apply((current) => {
      const sorted = current.layers.slice().sort((a, b) => a.zIndex - b.zIndex)
      const fromIndex = sorted.findIndex((layer) => layer.id === fromLayerId)
      const toIndex = sorted.findIndex((layer) => layer.id === toLayerId)
      if (fromIndex < 0 || toIndex < 0) return current
      const [moved] = sorted.splice(fromIndex, 1)
      // After removing fromIndex, adjust toIndex if it shifted
      const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex
      const insertAt = position === 'after' ? adjustedTo + 1 : adjustedTo
      sorted.splice(insertAt, 0, moved)
      const normalized = sorted.map((layer, index) => ({
        ...layer,
        zIndex: index + 1,
      }))
      return { ...current, layers: normalized }
    })
  }, [apply])

  // Stable callbacks for LayerItem memo — defined after all dependencies
  const layerItemOnDragEnd = useCallback(() => {
    setDraggingLayerId(null)
    setDragOverInfo(null)
  }, [])
  const layerItemOnDragOverLayer = useCallback((id: string, position: 'before' | 'after') => {
    setDragOverInfo((prev) => {
      if (prev?.id === id && prev?.position === position) return prev
      return { id, position }
    })
  }, [])
  const layerItemOnDropOnLayer = useCallback((targetId: string) => {
    const position = dragOverInfoRef.current?.position ?? 'before'
    setDraggingLayerId((dragging) => {
      if (dragging && dragging !== targetId) reorderLayers(dragging, targetId, position)
      return null
    })
    setDragOverInfo(null)
  }, [reorderLayers])
  const layerItemOnToggleVisible = useCallback((id: string, visible: boolean) => {
    // Use the individual layer's own preview state, not the selected layer's state.
    const stateKey = layerEditStatesRef.current[id] ?? 'default'
    updateLayerState(id, stateKey, { visible })
  }, [updateLayerState])
  const layerItemOnToggleLocked = useCallback((id: string, locked: boolean) => {
    updateLayer(id, { locked })
  }, [updateLayer])

  const setLayerZIndex = (layerId: string, rawValue: number) => {
    apply((current) => {
      const sorted = current.layers.slice().sort((a, b) => a.zIndex - b.zIndex)
      const fromIndex = sorted.findIndex((layer) => layer.id === layerId)
      if (fromIndex < 0) return current
      const safeTarget = Number.isFinite(rawValue) ? Math.round(rawValue) : sorted[fromIndex].zIndex
      const targetIndex = Math.max(0, Math.min(sorted.length - 1, safeTarget - 1))
      const [moved] = sorted.splice(fromIndex, 1)
      sorted.splice(targetIndex, 0, moved)
      return {
        ...current,
        layers: sorted.map((layer, index) => ({
          ...layer,
          zIndex: index + 1,
        })),
      }
    })
  }

  const createProject = (options?: { name?: string; template?: NewProjectTemplate }) => {
    const template = options?.template ?? 'empty'
    const sourcePkg = template === 'default' ? createDefaultGridPackage() : createEmptyGridPackage()
    const generatedName = options?.name?.trim()
    const nextName = generatedName || `Grid Project ${projectsState.projects.length + 1}`
    sourcePkg.meta.name = nextName
    sourcePkg.meta.updatedAt = new Date().toISOString()
    const newProject: GridProject = {
      id: uid('project'),
      name: nextName,
      updatedAt: new Date().toISOString(),
      pkg: sourcePkg,
    }
    const next: GridProjectsState = {
      ...projectsState,
      activeProjectId: newProject.id,
      projects: [...projectsState.projects, newProject],
    }
    redoStackRef.current = []
    undoStackRef.current.push(projectsState)
    if (undoStackRef.current.length > 100) {
      undoStackRef.current.shift()
    }
    touchInMemoryState(next)
    setProjectsState(next)
    setSelectedLayerId(newProject.pkg.layers[0]?.id ?? '')
  }

  const duplicateProject = () => {
    const cloned: GridProject = {
      id: uid('project'),
      name: `${activeProject.name} Copy`,
      updatedAt: new Date().toISOString(),
      pkg: structuredClone(activeProject.pkg),
      mobilePkg: activeProject.mobilePkg ? structuredClone(activeProject.mobilePkg) : undefined,
    }
    cloned.pkg.meta.name = cloned.name
    if (cloned.mobilePkg) cloned.mobilePkg.meta.name = cloned.name
    const next: GridProjectsState = {
      ...projectsState,
      activeProjectId: cloned.id,
      projects: [...projectsState.projects, cloned],
    }
    redoStackRef.current = []
    undoStackRef.current.push(projectsState)
    if (undoStackRef.current.length > 100) {
      undoStackRef.current.shift()
    }
    touchInMemoryState(next)
    setProjectsState(next)
  }

  const removeActiveProject = () => {
    if (projectsState.projects.length <= 1) return
    if (!window.confirm(`Delete project "${activeProject.name}"? This cannot be undone.`)) return
    const filtered = projectsState.projects.filter(
      (project) => project.id !== projectsState.activeProjectId,
    )
    const next: GridProjectsState = {
      ...projectsState,
      projects: filtered,
      activeProjectId: filtered[0].id,
    }
    redoStackRef.current = []
    undoStackRef.current.push(projectsState)
    if (undoStackRef.current.length > 100) {
      undoStackRef.current.shift()
    }
    touchInMemoryState(next)
    setProjectsState(next)
  }

  const openProjectSettings = () => {
    setProjectSettingsOpen(true)
  }

  const openCreateProjectPopup = () => {
    setNewProjectName(`Grid Project ${projectsState.projects.length + 1}`)
    setNewProjectTemplate('empty')
    setCreateProjectOpen(true)
  }

  const openLayerImportPopup = () => {
    setLayerDropActive(false)
    setLayerImportOpen(true)
  }

  const closeLayerImportPopup = () => {
    setLayerDropActive(false)
    setLayerImportOpen(false)
  }

  const updateProjectDropdownRect = () => {
    const trigger = projectDropdownTriggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportPadding = 8
    const maxWidth = Math.max(180, window.innerWidth - viewportPadding * 2)
    const width = Math.min(rect.width, maxWidth)
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    )
    setProjectDropdownRect({
      top: rect.bottom + 8,
      left,
      width,
    })
  }

  const updateHeaderMenuRect = () => {
    const trigger = headerMenuTriggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportPadding = 8
    const desiredWidth = Math.max(220, rect.width)
    const maxWidth = Math.max(180, window.innerWidth - viewportPadding * 2)
    const width = Math.min(desiredWidth, maxWidth)
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    )
    setHeaderMenuRect({
      top: rect.bottom + 8,
      left,
      width,
    })
  }

  useEffect(() => {
    if (!projectDropdownOpen) return
    updateProjectDropdownRect()

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (projectDropdownTriggerRef.current?.contains(target)) return
      if (projectDropdownMenuRef.current?.contains(target)) return
      setProjectDropdownOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setProjectDropdownOpen(false)
      }
    }

    const onViewportChange = () => {
      updateProjectDropdownRect()
    }

    const onScrollCapture = (event: Event) => {
      const target = event.target as Node | null
      if (!target) {
        setProjectDropdownOpen(false)
        return
      }
      if (projectDropdownTriggerRef.current?.contains(target)) return
      if (projectDropdownMenuRef.current?.contains(target)) return
      setProjectDropdownOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onScrollCapture, true)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onScrollCapture, true)
    }
  }, [projectDropdownOpen])

  useEffect(() => {
    if (!headerMenuOpen) return
    updateHeaderMenuRect()

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (headerMenuTriggerRef.current?.contains(target)) return
      if (headerMenuRef.current?.contains(target)) return
      setHeaderMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setHeaderMenuOpen(false)
      }
    }

    const onViewportChange = () => {
      updateHeaderMenuRect()
    }

    const onScrollCapture = (event: Event) => {
      const target = event.target as Node | null
      if (!target) {
        setHeaderMenuOpen(false)
        return
      }
      if (headerMenuTriggerRef.current?.contains(target)) return
      if (headerMenuRef.current?.contains(target)) return
      setHeaderMenuOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onScrollCapture, true)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onScrollCapture, true)
    }
  }, [headerMenuOpen])

  useEffect(() => {
    if (!stateCreateMenuOpen) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (stateCreateTriggerRef.current?.contains(target)) return
      if (stateCreateMenuRef.current?.contains(target)) return
      setStateCreateMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setStateCreateMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [stateCreateMenuOpen])

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Persist state asynchronously — completely outside the React render path.
  // Skip on first mount: state was just loaded from storage, no need to re-save immediately.
  const isFirstMountRef = useRef(true)
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      return
    }
    saveGridProjectsState(projectsState)
  }, [projectsState])

  // Update paste handler every render (reads latest state via closures / refs), but register only once
  onPasteHandlerRef.current = (event: ClipboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    const root = rootRef.current
    if (!root) return
    if (target && !root.contains(target)) return
    const text = event.clipboardData?.getData('text/plain') ?? ''
    const svg = extractSvgText(text)
    if (!svg) return
    event.preventDefault()
    const sl = selectedLayerRef.current
    if (sl) {
      setLayerSourceByState(sl.id, editStateKeyRef.current, svg)
    } else {
      createLayerFromSvgText(svg)
    }
  }
  useEffect(() => {
    const handler = (e: ClipboardEvent) => onPasteHandlerRef.current(e)
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [])

  useEffect(() => {
    const isTypingTarget = (target: HTMLElement | null) =>
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        !!target.closest('[contenteditable="true"]'))

    const applyHistorySnapshot = (
      snapshot: GridProjectsState,
      flagRef: MutableRefObject<boolean>,
    ) => {
      flagRef.current = true
      touchInMemoryState(snapshot)
      setProjectsState(snapshot)
      const active =
        snapshot.projects.find((p) => p.id === snapshot.activeProjectId) ??
        snapshot.projects[0]
      const activePkg = deviceModeRef.current === 'desktop'
        ? active?.pkg
        : (active?.mobilePkg ?? active?.pkg)
      setSelectedLayerId((prevId) => {
        const stillExists = activePkg?.layers.some((l) => l.id === prevId)
        return stillExists ? prevId : (activePkg?.layers[0]?.id ?? '')
      })
      flagRef.current = false
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (isTypingTarget(event.target as HTMLElement | null)) return

      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = key === 'y' || (key === 'z' && event.shiftKey)

      if (isUndo) {
        // Flush any debounced pending snapshot into the undo stack first
        if (undoPendingBaseRef.current) {
          undoStackRef.current.push(undoPendingBaseRef.current)
          if (undoStackRef.current.length > 100) undoStackRef.current.shift()
          undoPendingBaseRef.current = null
        }
        if (undoPendingTimerRef.current) {
          clearTimeout(undoPendingTimerRef.current)
          undoPendingTimerRef.current = null
        }
        if (undoStackRef.current.length === 0) return
        event.preventDefault()
        // Save current live state to redo stack so the user can redo
        const current = projectsStateRef.current
        redoStackRef.current.push(current)
        if (redoStackRef.current.length > 100) redoStackRef.current.shift()
        const snapshot = undoStackRef.current.pop()!
        applyHistorySnapshot(snapshot, isUndoingRef)
        return
      }

      if (isRedo) {
        if (redoStackRef.current.length === 0) return
        event.preventDefault()
        // Save current live state to undo stack so the user can undo the redo
        const current = projectsStateRef.current
        undoStackRef.current.push(current)
        if (undoStackRef.current.length > 100) undoStackRef.current.shift()
        const snapshot = redoStackRef.current.pop()!
        applyHistorySnapshot(snapshot, isRedoingRef)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    return () => {
      if (undoPendingTimerRef.current) {
        clearTimeout(undoPendingTimerRef.current)
      }
      if (arrowCommitTimerRef.current) {
        clearTimeout(arrowCommitTimerRef.current)
        arrowCommitTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 's') return
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          !!target.closest('[contenteditable="true"]'))
      if (isTypingTarget) return
      event.preventDefault()
      void pushActiveGridToRuntimeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Escape closes any open modal
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setProjectSettingsOpen(false)
      setCreateProjectOpen(false)
      setLayerImportOpen(false)
      setLayerDropActive(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const viewport = previewViewportRef.current
    if (!viewport) return

    const updateSize = () => {
      setPreviewViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    window.addEventListener('resize', updateSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  // zoneId is now guaranteed by normalizeGridPackage in storage.ts — no post-mount apply needed

  const createLayerState = (layerId: string, state: GridVisualState) => {
    apply((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (layer.id !== layerId) return layer
        const baseRect = { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
        const nextRects = { ...(layer.stateRects ?? {}) }
        nextRects[state] = safeRect(nextRects[state], baseRect)
        return {
          ...layer,
          enabledStates: Array.from(new Set([...(layer.enabledStates ?? ['default']), state])),
          stateRects: nextRects,
        }
      }),
    }))
  }

  const removeLayerState = (layerId: string, state: GridVisualState) => {
    if (state === 'default') return
    apply((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (layer.id !== layerId) return layer
        const enabledStates = (layer.enabledStates ?? STATES).filter((s) => s !== state)
        const nextSvgs = { ...(layer.stateSvgs ?? {}) }
        const nextRects = { ...(layer.stateRects ?? {}) }
        delete nextSvgs[state]
        delete nextRects[state]
        // Reset stateStyles for the removed state back to default values so the runtime
        // doesn't keep applying custom visible/opacity from a "deleted" state.
        return {
          ...layer,
          enabledStates,
          stateSvgs: nextSvgs,
          stateRects: nextRects,
          stateStyles: {
            ...layer.stateStyles,
            [state]: { ...layer.stateStyles.default },
          },
        }
      }),
    }))
  }

  const resetLayerStateToDefault = (layerId: string, state: GridVisualState) => {
    if (state === 'default') {
      updateLayerState(layerId, 'default', { visible: true, opacity: 1 })
      return
    }
    apply((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (layer.id !== layerId) return layer
        const nextSvgs = { ...(layer.stateSvgs ?? {}) }
        const nextRects = { ...(layer.stateRects ?? {}) }
        delete nextSvgs[state]
        delete nextRects[state]
        return {
          ...layer,
          stateStyles: {
            ...layer.stateStyles,
            [state]: { ...layer.stateStyles.default },
          },
          stateSvgs: nextSvgs,
          stateRects: nextRects,
        }
      }),
    }))
  }

  const applyLayerRect = useCallback((
    layerId: string,
    state: GridVisualState,
    next: { x: number; y: number; width: number; height: number },
  ) => {
    const rounded = {
      x: Math.round(next.x * 1000) / 1000,
      y: Math.round(next.y * 1000) / 1000,
      width: Math.round(next.width * 1000) / 1000,
      height: Math.round(next.height * 1000) / 1000,
    }
    if (state === 'default') {
      updateLayer(layerId, rounded)
      return
    }
    apply((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              enabledStates: Array.from(new Set([...(layer.enabledStates ?? ['default']), state])),
              stateRects: {
                ...layer.stateRects,
                [state]: rounded,
              },
            }
          : layer,
      ),
    }))
  }, [apply, updateLayer])

  // Keep applyLayerRect accessible in stable callbacks
  applyLayerRectCallbackRef.current = applyLayerRect

  // DOM-direct pointer move — ZERO React state updates during drag.
  // Commits the final rect to React state only on pointerup.
  const onWindowPointerMove = useCallback((event: PointerEvent) => {
    const interaction = interactionRef.current
    if (!interaction) return
    const scale = previewScaleRef.current
    const r = computeInteractionRect(
      interaction.mode,
      interaction.startX, interaction.startY, interaction.startW, interaction.startH,
      interaction.startClientX, interaction.startClientY,
      event.clientX, event.clientY,
      scale,
    )
    // Store live position for commit on pointerup
    interaction.liveX = r.x
    interaction.liveY = r.y
    interaction.liveW = r.width
    interaction.liveH = r.height
    // Direct DOM update — bypasses React entirely
    const canvas = canvasAreaRef.current
    if (!canvas) return
    const layerEl = canvas.querySelector(`[data-layer-id="${interaction.layerId}"]`) as HTMLElement | null
    if (layerEl) {
      layerEl.style.left = `${r.x * scale}px`
      layerEl.style.top = `${r.y * scale}px`
      layerEl.style.width = `${r.width * scale}px`
      layerEl.style.height = `${r.height * scale}px`
    }
    const selEl = selectionBoxRef.current
    if (selEl) {
      selEl.style.left = `${r.x * scale}px`
      selEl.style.top = `${r.y * scale}px`
      selEl.style.width = `${r.width * scale}px`
      selEl.style.height = `${r.height * scale}px`
    }
  }, [])

  const stopCanvasInteraction = useCallback(() => {
    const ia = interactionRef.current
    if (ia) {
      const moved = ia.liveX !== ia.startX || ia.liveY !== ia.startY || ia.liveW !== ia.startW || ia.liveH !== ia.startH
      if (moved) {
        // Commit final drag position to React state — single update for entire drag
        applyLayerRectCallbackRef.current(ia.layerId, ia.stateKey, {
          x: ia.liveX, y: ia.liveY, width: ia.liveW, height: ia.liveH,
        })
      }
    }
    interactionRef.current = null
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', stopCanvasInteraction)
  }, [onWindowPointerMove])

  const clampViewerWidth = (value: number) => {
    const maxWidth =
      availableBuilderWidth - minEditorPanelWidth - clampedSidebarWidth - splitterWidth * 2
    return Math.max(minViewerPanelWidth, Math.min(maxWidth, value))
  }

  const clampSidebarWidth = (value: number) => {
    const maxWidth =
      availableBuilderWidth - clampedViewerWidth - minEditorPanelWidth - splitterWidth * 2
    return Math.max(minSidebarPanelWidth, Math.min(maxWidth, value))
  }

  const clampPreviewZoom = (value: number) => Math.max(0.4, Math.min(3, value))

  const stepPreviewZoom = (delta: number) => {
    setPreviewZoom((current) => Math.round(clampPreviewZoom(current + delta) * 100) / 100)
  }

  // Native wheel listener with passive:false is required for ctrl/cmd zoom.
  // React's delegated wheel listener may be passive in modern runtimes.
  useEffect(() => {
    const viewport = previewViewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const delta = event.deltaY > 0 ? -0.08 : 0.08
      stepPreviewZoom(delta)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      viewport.removeEventListener('wheel', onWheel)
    }
  }, [stepPreviewZoom])

  const onWindowSplitterMove = (event: PointerEvent) => {
    const interaction = splitterRef.current
    if (!interaction) return
    const dx = event.clientX - interaction.startClientX
    if (interaction.mode === 'viewer') {
      setViewerWidth(clampViewerWidth(interaction.startWidth + dx))
      return
    }
    setSidebarWidth(clampSidebarWidth(interaction.startWidth - dx))
  }

  const stopSplitterInteraction = () => {
    splitterRef.current = null
    window.removeEventListener('pointermove', onWindowSplitterMove)
    window.removeEventListener('pointerup', stopSplitterInteraction)
  }
  stopSplitterInteractionRef.current = stopSplitterInteraction

  const onWindowPanMove = (event: PointerEvent) => {
    const interaction = panRef.current
    if (!interaction) return
    const dx = event.clientX - interaction.startClientX
    const dy = event.clientY - interaction.startClientY
    const newX = interaction.startPanX + dx
    const newY = interaction.startPanY + dy
    // DOM-direct: zero React renders during panning
    const stage = canvasStageRef.current
    if (stage) {
      stage.style.transform = `translate(${newX}px, ${newY}px)`
    }
    interaction.currentPanX = newX
    interaction.currentPanY = newY
  }

  const stopPanInteraction = () => {
    const interaction = panRef.current
    panRef.current = null
    setIsPanning(false)
    window.removeEventListener('pointermove', onWindowPanMove)
    window.removeEventListener('pointerup', stopPanInteraction)
    // Commit final pan position to React state (single render)
    if (interaction && (interaction.currentPanX !== undefined || interaction.currentPanY !== undefined)) {
      setPreviewPan({
        x: interaction.currentPanX ?? interaction.startPanX,
        y: interaction.currentPanY ?? interaction.startPanY,
      })
    }
  }
  stopPanInteractionRef.current = stopPanInteraction

  const beginPanInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    panRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: previewPan.x,
      startPanY: previewPan.y,
    }
    setIsPanning(true)
    window.addEventListener('pointermove', onWindowPanMove)
    window.addEventListener('pointerup', stopPanInteraction)
  }

  const beginSplitterInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
    mode: 'viewer' | 'sidebar',
  ) => {
    if (isCompactBuilderLayout) return
    event.preventDefault()
    splitterRef.current = {
      mode,
      startClientX: event.clientX,
      startWidth: mode === 'viewer' ? clampedViewerWidth : clampedSidebarWidth,
    }
    window.addEventListener('pointermove', onWindowSplitterMove)
    window.addEventListener('pointerup', stopSplitterInteraction)
  }

  const beginCanvasInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    layer: GridLayer,
    mode: DragMode,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    pushUndoSnapshotNow()
    // Capture stateKey at drag start — used by stopCanvasInteraction to commit
    const stateKey = editStateKeyRef.current
    const startX = stateKey !== 'default' ? (layer.stateRects?.[stateKey]?.x ?? layer.x) : layer.x
    const startY = stateKey !== 'default' ? (layer.stateRects?.[stateKey]?.y ?? layer.y) : layer.y
    const startW = stateKey !== 'default' ? (layer.stateRects?.[stateKey]?.width ?? layer.width) : layer.width
    const startH = stateKey !== 'default' ? (layer.stateRects?.[stateKey]?.height ?? layer.height) : layer.height
    interactionRef.current = {
      layerId: layer.id,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX, startY, startW, startH,
      stateKey,
      liveX: startX, liveY: startY, liveW: startW, liveH: startH,
    }
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', stopCanvasInteraction)
  }

  useEffect(() => {
    return () => {
      stopCanvasInteraction()
      stopSplitterInteractionRef.current()
      stopPanInteractionRef.current()
    }
  }, [stopCanvasInteraction])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.code !== 'Space') return
      event.preventDefault()
      setSpacePressed(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      setSpacePressed(false)
    }
    const onBlur = () => setSpacePressed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const selectedRect = useMemo(() => {
    if (!selectedLayer) return null
    const baseRect = { x: selectedLayer.x, y: selectedLayer.y, width: selectedLayer.width, height: selectedLayer.height }
    if (editStateKey !== 'default') {
      return safeRect(selectedLayer.stateRects?.[editStateKey], baseRect)
    }
    return safeRect(baseRect, baseRect)
  }, [selectedLayer, editStateKey])

  const frameCenter = useMemo(() => ({
    x: pkg.frame.width / 2,
    y: pkg.frame.height / 2,
  }), [pkg.frame.width, pkg.frame.height])

  const selectedCenterCoords = useMemo(() => selectedRect
    ? {
        x: selectedRect.x + selectedRect.width / 2 - frameCenter.x,
        y: selectedRect.y + selectedRect.height / 2 - frameCenter.y,
      }
    : null,
  [selectedRect, frameCenter])
  const clipRect = pkg.global.clipRect ?? {
    x: 0,
    y: 0,
    width: pkg.frame.width,
    height: pkg.frame.height,
  }

  // Derived from selectedRect — no extra render on layer select
  const layerScaleDerived = useMemo(() => {
    if (!selectedLayer || !selectedRect || selectedLayer.originalWidth <= 0) return 1
    const ratio = selectedRect.width / selectedLayer.originalWidth
    if (!Number.isFinite(ratio) || ratio <= 0) return 1
    return Math.round(ratio * 1000) / 1000
  }, [selectedLayer?.id, selectedRect?.width, selectedLayer?.originalWidth])
  const layerScaleValue = Number.isFinite(layerScaleDerived) && layerScaleDerived > 0
    ? layerScaleDerived
    : 1

  // Sync hot-path refs — always current, so event handlers registered once never go stale
  selectedLayerRef.current = selectedLayer
  selectedRectRef.current = selectedRect

  useEffect(() => {
    if (!selectedLayerId) return
    if (!enabledStateKeys.includes(editStateKey)) {
      // Reset only the selected layer's preview state, not all layers
      setLayerEditStates((prev) => ({
        ...prev,
        [selectedLayerId]: enabledStateKeys[0] ?? 'default',
      }))
    }
  }, [editStateKey, enabledStateKeys, selectedLayerId])

  const applyLayerScaleByCenter = (scale: number) => {
    if (!selectedLayer || !selectedRect) return
    const clamped = Math.max(0.05, Math.min(10, Number.isFinite(scale) ? scale : 1))
    const centerX = selectedRect.x + selectedRect.width / 2
    const centerY = selectedRect.y + selectedRect.height / 2
    const nextWidth = selectedLayer.originalWidth * clamped
    const nextHeight = selectedLayer.originalHeight * clamped
    applyLayerRect(selectedLayer.id, editStateKey, {
      x: centerX - nextWidth / 2,
      y: centerY - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
    })
  }

  // Update arrow/delete handlers every render — they read from refs, registered only once
  onArrowKeyDownHandlerRef.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const sl = selectedLayerRef.current
      if (!sl) return
      event.preventDefault()
      removeLayerRef.current(sl.id)
      return
    }
    const sl = selectedLayerRef.current
    const sr = selectedRectRef.current
    if (!sl || !sr) return

    const isArrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown'
    if (!isArrow) return
    event.preventDefault()

    const step = event.shiftKey ? 10 : 1
    const ddx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const ddy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0

    if (!event.repeat) {
      pushUndoSnapshotNow()
      arrowBaseRectRef.current = {
        layerId: sl.id,
        stateKey: editStateKeyRef.current,
        x: sr.x, y: sr.y,
        w: sr.width, h: sr.height,
      }
      pendingArrowRef.current = { dx: 0, dy: 0 }
    }

    const base = arrowBaseRectRef.current
    if (!base) return

    const pending = pendingArrowRef.current ?? { dx: 0, dy: 0 }
    pending.dx += ddx
    pending.dy += ddy
    pendingArrowRef.current = pending

    const scale = previewScaleRef.current
    const newX = base.x + pending.dx
    const newY = base.y + pending.dy
    const canvas = canvasAreaRef.current
    if (canvas) {
      const layerEl = canvas.querySelector(`[data-layer-id="${base.layerId}"]`) as HTMLElement | null
      if (layerEl) {
        layerEl.style.left = `${newX * scale}px`
        layerEl.style.top = `${newY * scale}px`
      }
      const selEl = selectionBoxRef.current
      if (selEl) {
        selEl.style.left = `${newX * scale}px`
        selEl.style.top = `${newY * scale}px`
      }
    }

    if (arrowCommitTimerRef.current) clearTimeout(arrowCommitTimerRef.current)
    arrowCommitTimerRef.current = setTimeout(() => {
      arrowCommitTimerRef.current = null
      const b = arrowBaseRectRef.current
      const p = pendingArrowRef.current
      if (!b || !p) return
      applyLayerRectCallbackRef.current(b.layerId, b.stateKey, {
        x: b.x + p.dx, y: b.y + p.dy, width: b.w, height: b.h,
      })
      arrowBaseRectRef.current = null
      pendingArrowRef.current = null
    }, 120)
  }

  onArrowKeyUpHandlerRef.current = (event: KeyboardEvent) => {
    const isArrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown'
    if (!isArrow) return
    if (arrowCommitTimerRef.current) {
      clearTimeout(arrowCommitTimerRef.current)
      arrowCommitTimerRef.current = null
    }
    const b = arrowBaseRectRef.current
    const p = pendingArrowRef.current
    if (b && p && (p.dx !== 0 || p.dy !== 0)) {
      applyLayerRectCallbackRef.current(b.layerId, b.stateKey, {
        x: b.x + p.dx, y: b.y + p.dy, width: b.w, height: b.h,
      })
    }
    arrowBaseRectRef.current = null
    pendingArrowRef.current = null
  }

  useEffect(() => {
    const kd = (e: KeyboardEvent) => onArrowKeyDownHandlerRef.current(e)
    const ku = (e: KeyboardEvent) => onArrowKeyUpHandlerRef.current(e)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  return (
    <div className="grid-builder-page" ref={rootRef}>
      <header className="grid-builder__header">
        <div className="grid-builder__header-group">
          <div className="grid-builder__project-picker">
            <button
              ref={projectDropdownTriggerRef}
              type="button"
              className={`grid-builder__project-select-trigger ${projectDropdownOpen ? 'is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={projectDropdownOpen}
              onClick={() => {
                if (!projectDropdownOpen) updateProjectDropdownRect()
                setHeaderMenuOpen(false)
                setProjectDropdownOpen((prev) => !prev)
              }}
            >
              <span className="grid-builder__project-select-label">{activeProject.name}</span>
            </button>
          </div>
          <div className="grid-builder__actions">
            <button type="button" className="grid-builder-btn" onClick={openProjectSettings}>Settings</button>
          </div>
        </div>
        <div className="grid-builder__header-group grid-builder__header-group--right">
          <div className="grid-builder__device-toggle" role="group" aria-label="Device mode">
            <button
              type="button"
              className={`grid-builder__device-btn ${deviceMode === 'desktop' ? 'is-active' : ''}`}
              onClick={() => switchDeviceMode('desktop')}
              title="Desktop"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none"/>
                <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              type="button"
              className={`grid-builder__device-btn ${deviceMode === 'mobile' ? 'is-active' : ''}`}
              onClick={() => switchDeviceMode('mobile')}
              title="Mobile"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="6" y="2" width="12" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none"/>
                <line x1="10" y1="19" x2="14" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="grid-builder__view-state-toggle" role="group" aria-label="Grid view state">
            <button
              type="button"
              className={`grid-builder__view-state-btn ${gridViewState === 'open' ? 'is-active' : ''}`}
              onClick={() => setGridViewState('open')}
            >Open</button>
            <button
              type="button"
              className={`grid-builder__view-state-btn ${gridViewState === 'closed' ? 'is-active' : ''}`}
              onClick={() => setGridViewState('closed')}
            >Closed</button>
          </div>
          <div
            className={`grid-builder__cloud-sync grid-builder__cloud-sync--${
              cloudSyncStatus === 'error' ? 'error' : cloudSyncStatus === 'saving' ? 'saving' : 'saved'
            }`}
            title={
              isSupabaseAuthEnabled()
                ? 'Builder projects are stored per login. Other accounts see their own projects.'
                : undefined
            }
          >
            {cloudSyncStatus === 'saving' && (isSupabaseAuthEnabled() ? 'Account: saving…' : 'Saving…')}
            {cloudSyncStatus === 'error' && 'Account: save failed'}
            {cloudSyncStatus === 'saved' &&
              (isSupabaseAuthEnabled() ? 'Projects: Supabase' : 'Local only')}
          </div>
          <div
            className={`grid-builder__cloud-sync grid-builder__cloud-sync--${updateRuntimeStatus === 'success' ? 'saved' : updateRuntimeStatus === 'error' ? 'error' : updateRuntimeStatus}`}
            title={updateRuntimeDetail ?? undefined}
          >
            {updateRuntimeStatus === 'saving' && 'Update Game: Sending...'}
            {updateRuntimeStatus === 'success' &&
              (updateRuntimeDetail ? 'Update Game: Success (no bitmap — hover for reason)' : 'Update Game: Success')}
            {updateRuntimeStatus === 'error' && `Update Game: Failed${updateRuntimeDetail ? ` — ${updateRuntimeDetail.slice(0, 80)}${updateRuntimeDetail.length > 80 ? '…' : ''}` : ''}`}
            {updateRuntimeStatus === 'idle' && 'Update Game: Ready'}
          </div>
          <button
            type="button"
            className="grid-builder-btn"
            onClick={() => { void pushActiveGridToRuntime() }}
            title="Force sync grid to game (Cmd/Ctrl+S)"
            disabled={updateRuntimeStatus === 'saving'}
          >
            {updateRuntimeStatus === 'saving' ? 'Updating...' : 'Update Game'}
          </button>
          <button type="button" className="grid-builder-btn grid-builder-btn--primary" onClick={openCreateProjectPopup}>
            Create Grid
          </button>
        </div>
      </header>

      {projectDropdownOpen && projectDropdownRect
        ? createPortal(
            <div
              ref={projectDropdownMenuRef}
              className="grid-builder-dropdown"
              role="listbox"
              aria-label="Grid project selector"
              style={{
                position: 'fixed',
                top: projectDropdownRect.top,
                left: projectDropdownRect.left,
                width: projectDropdownRect.width,
                zIndex: 10000,
              }}
            >
              <div className="grid-builder-dropdown__list">
                {projectsState.projects.map((project) => {
                  const isSelected = project.id === projectsState.activeProjectId
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`grid-builder-dropdown__option ${isSelected ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        switchProject(project.id)
                        setProjectDropdownOpen(false)
                      }}
                    >
                      <span>{project.name}</span>
                      {isSelected ? <span className="grid-builder-dropdown__selected-dot" aria-hidden /> : null}
                    </button>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}

      {headerMenuOpen && headerMenuRect
        ? createPortal(
            <div
              ref={headerMenuRef}
              className="grid-builder-dropdown"
              role="menu"
              aria-label="Builder actions"
              style={{
                position: 'fixed',
                top: headerMenuRect.top,
                left: headerMenuRect.left,
                width: headerMenuRect.width,
                zIndex: 10000,
              }}
            >
              <div className="grid-builder-dropdown__list">
                <button
                  type="button"
                  className="grid-builder-dropdown__option"
                  role="menuitem"
                  onClick={() => {
                    apply(() => createDefaultGridPackage())
                    setHeaderMenuOpen(false)
                  }}
                >
                  <span>Load default base</span>
                </button>
                <button
                  type="button"
                  className="grid-builder-dropdown__option"
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard.writeText(JSON.stringify(projectsState, null, 2))
                    setHeaderMenuOpen(false)
                  }}
                >
                  <span>Copy project JSON</span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {projectSettingsOpen ? (
        <div className="grid-builder-modal__overlay" role="presentation" onClick={() => setProjectSettingsOpen(false)}>
          <div
            className="grid-builder-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Grid settings"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid-builder-modal__header">
              <h3>Grid Settings</h3>
            </div>
            <div className="grid-builder-modal__body">
              <label className="grid-builder__label">
                Grid name
                <DeferredTextInput
                  value={pkg.meta.name}
                  onCommit={(v) =>
                    apply((current) => ({
                      ...current,
                      meta: { ...current.meta, name: v },
                    }))
                  }
                  placeholder="Enter grid name"
                />
              </label>
              <div className="grid-builder-modal__settings-grid">
                <label className="grid-builder__label">
                  Width
                  <DeferredNumberInput
                    min={1}
                    value={pkg.frame.width}
                    onCommit={(next) => {
                      const safeNext = Math.max(1, next)
                      apply((current) => ({
                        ...current,
                        frame: { ...current.frame, width: safeNext },
                        global: {
                          ...current.global,
                          clipRect: centerClipRectInFrame(
                            current.global.clipRect?.width ?? current.frame.width,
                            current.global.clipRect?.height ?? current.frame.height,
                            { width: safeNext, height: current.frame.height },
                          ),
                        },
                      }))
                    }}
                    onStepCommit={(next) => {
                      const safeNext = Math.max(1, next)
                      apply((current) => ({
                        ...current,
                        frame: { ...current.frame, width: safeNext },
                        global: {
                          ...current.global,
                          clipRect: centerClipRectInFrame(
                            current.global.clipRect?.width ?? current.frame.width,
                            current.global.clipRect?.height ?? current.frame.height,
                            { width: safeNext, height: current.frame.height },
                          ),
                        },
                      }))
                    }}
                  />
                </label>
                <label className="grid-builder__label">
                  Height
                  <DeferredNumberInput
                    min={1}
                    value={pkg.frame.height}
                    onCommit={(next) => {
                      const safeNext = Math.max(1, next)
                      apply((current) => ({
                        ...current,
                        frame: { ...current.frame, height: safeNext },
                        global: {
                          ...current.global,
                          clipRect: centerClipRectInFrame(
                            current.global.clipRect?.width ?? current.frame.width,
                            current.global.clipRect?.height ?? current.frame.height,
                            { width: current.frame.width, height: safeNext },
                          ),
                        },
                      }))
                    }}
                    onStepCommit={(next) => {
                      const safeNext = Math.max(1, next)
                      apply((current) => ({
                        ...current,
                        frame: { ...current.frame, height: safeNext },
                        global: {
                          ...current.global,
                          clipRect: centerClipRectInFrame(
                            current.global.clipRect?.width ?? current.frame.width,
                            current.global.clipRect?.height ?? current.frame.height,
                            { width: current.frame.width, height: safeNext },
                          ),
                        },
                      }))
                    }}
                  />
                </label>
                <label className="grid-builder__label">
                  Clip X
                  <input type="number" value={clipRect.x} readOnly disabled />
                </label>
                <label className="grid-builder__label">
                  Clip Y
                  <input type="number" value={clipRect.y} readOnly disabled />
                </label>
                <label className="grid-builder__label">
                  Clip W
                  <DeferredNumberInput
                    min={1}
                    value={clipRect.width}
                    onCommit={(v) =>
                      apply((current) => ({
                        ...current,
                        global: {
                          ...current.global,
                          clipRect: centerClipRectInFrame(
                            Math.max(1, v),
                            current.global.clipRect?.height ?? current.frame.height,
                            current.frame,
                          ),
                        },
                      }))
                    }
                  />
                </label>
                <label className="grid-builder__label">
                  Clip H
                  <DeferredNumberInput
                    min={1}
                    value={clipRect.height}
                    onCommit={(v) =>
                      apply((current) => ({
                        ...current,
                        global: {
                          ...current.global,
                          clipRect: centerClipRectInFrame(
                            current.global.clipRect?.width ?? current.frame.width,
                            Math.max(1, v),
                            current.frame,
                          ),
                        },
                      }))
                    }
                  />
                </label>
                <label className="grid-builder__label">
                  Tilt (deg)
                  <DeferredNumberInput
                    min={0}
                    max={89}
                    step={1}
                    value={pkg.global?.tiltAngleDeg ?? 56}
                    onCommit={(v) =>
                      apply((current) => ({
                        ...current,
                        global: { ...current.global, tiltAngleDeg: Math.max(0, Math.min(89, v)) },
                      }))
                    }
                    onStepCommit={(v) =>
                      apply((current) => ({
                        ...current,
                        global: { ...current.global, tiltAngleDeg: Math.max(0, Math.min(89, v)) },
                      }))
                    }
                  />
                </label>
                <label className="grid-builder__label">
                  Scale
                  <DeferredNumberInput
                    min={0.1}
                    max={4}
                    step={0.05}
                    value={pkg.frame.scale}
                    onCommit={(v) => {
                      const next = Math.max(0.1, Math.min(4, v || 1))
                      apply((current) => ({ ...current, frame: { ...current.frame, scale: next } }))
                    }}
                    onStepCommit={(v) =>
                      apply((current) => ({
                        ...current,
                        frame: { ...current.frame, scale: Math.max(0.1, Math.min(4, v)) },
                      }))
                    }
                  />
                </label>
                <label className="grid-builder__label">
                  Closed mode
                  <select
                    value={pkg.global?.closedMode ?? 'tilted'}
                    onChange={(e) =>
                      apply((current) => ({
                        ...current,
                        global: {
                          ...current.global,
                          closedMode: e.target.value as 'tilted' | 'flat',
                        },
                      }))
                    }
                  >
                    <option value="tilted">Tilted (3D)</option>
                    <option value="flat">Flat (2D)</option>
                  </select>
                </label>
                <label className="grid-builder__label">
                  Grid state
                  <select
                    value={gridViewState}
                    onChange={(e) => setGridViewState(e.target.value as 'open' | 'closed')}
                  >
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="grid-builder-modal__footer">
              <button type="button" className="grid-builder-btn" onClick={duplicateProject}>Duplicate</button>
              <button
                type="button"
                className="grid-builder-btn grid-builder-btn--danger grid-builder__danger"
                disabled={projectsState.projects.length <= 1}
                onClick={() => {
                  removeActiveProject()
                  setProjectSettingsOpen(false)
                }}
              >
                Delete
              </button>
              <button type="button" className="grid-builder-btn" onClick={() => setProjectSettingsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createProjectOpen ? (
        <div className="grid-builder-modal__overlay" role="presentation" onClick={() => setCreateProjectOpen(false)}>
          <div
            className="grid-builder-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create new grid"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid-builder-modal__header">
              <h3>Create new grid</h3>
            </div>
            <div className="grid-builder-modal__body">
              <label className="grid-builder__label">
                Grid name
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="New grid name"
                />
              </label>
              <label className="grid-builder__label">
                Template
                <select
                  value={newProjectTemplate}
                  onChange={(e) => setNewProjectTemplate(e.target.value as NewProjectTemplate)}
                >
                  <option value="empty">Empty grid</option>
                  <option value="default">Default base grid</option>
                </select>
              </label>
            </div>
            <div className="grid-builder-modal__footer">
              <button type="button" className="grid-builder-btn" onClick={() => setCreateProjectOpen(false)}>Cancel</button>
              <button
                type="button"
                className="grid-builder-btn grid-builder-btn--primary"
                onClick={() => {
                  createProject({ name: newProjectName, template: newProjectTemplate })
                  setCreateProjectOpen(false)
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`grid-builder ${isCompactBuilderLayout ? 'grid-builder--compact' : ''}`}
        style={builderLayoutStyle}
      >
        <main className="grid-builder__viewer grid-builder__panel grid-builder__panel--preview">
          <div
            className="grid-builder__canvas-wrap"
            ref={previewViewportRef}
            data-pan-mode={isPanning ? 'panning' : (spacePressed ? 'ready' : 'off')}
            onPointerDown={(event) => {
              const isMiddleButton = event.button === 1
              const isSpacePan = event.button === 0 && spacePressed
              if (!isMiddleButton && !isSpacePan) return
              beginPanInteraction(event)
            }}
          >
          {rulersEnabled ? (
            <>
              <div className="grid-builder__ruler grid-builder__ruler--top" aria-hidden>
                {horizontalRulerMarks.map((_, i) => {
                  const screenX = i * rulerStepPx
                  const canvasX = Math.round((screenX - previewPan.x) / previewScale)
                  return (
                    <span key={`rx-${i}`} style={{ left: screenX }}>
                      {canvasX}
                    </span>
                  )
                })}
              </div>
              <div className="grid-builder__ruler grid-builder__ruler--left" aria-hidden>
                {verticalRulerMarks.map((_, i) => {
                  const screenY = i * rulerStepPx
                  const canvasY = Math.round((screenY - previewPan.y) / previewScale)
                  return (
                    <span key={`ry-${i}`} style={{ top: screenY }}>
                      {canvasY}
                    </span>
                  )
                })}
              </div>
            </>
          ) : null}
          <div
            className={`grid-builder__canvas-stage ${
              gridViewState === 'closed' ? 'is-closed' : ''
            } ${
              gridViewState === 'closed' && pkg.global.closedMode === 'tilted'
                ? 'is-tilted'
                : ''
            }`}
            ref={canvasStageRef}
            style={
              {
                '--builder-tilt-angle': `${pkg.global?.tiltAngleDeg ?? 56}deg`,
                transform: `translate(${previewPan.x}px, ${previewPan.y}px)`,
              } as CSSProperties
            }
          >
            <div
              ref={canvasAreaRef}
              className="grid-builder__canvas"
              style={{
                width: pkg.frame.width * previewScale,
                height: pkg.frame.height * previewScale,
              }}
            >
              <div
                className="grid-builder__clip-rect"
                style={{
                  left: clipRect.x * previewScale,
                  top: clipRect.y * previewScale,
                  width: clipRect.width * previewScale,
                  height: clipRect.height * previewScale,
                }}
              >
                <span className="grid-builder__clip-rect-label">Clip zone</span>
              </div>
              {visibleLayers.map(({ layer, src, rect, stateKey }) => {
                // stateKey is per-layer — each layer renders its own preview state independently.
                const styleByState = layer.stateStyles[stateKey]
                  const globalVisible =
                    gridViewState === 'open'
                      ? (layer.globalVisibility?.open ?? true)
                      : (layer.globalVisibility?.closed ?? true)
                  if (!styleByState.visible || !globalVisible) return null
                  return (
                    <CanvasLayer
                      key={layer.id}
                      layerId={layer.id}
                      src={src}
                      alt={layer.name}
                      left={rect.x * previewScale}
                      top={rect.y * previewScale}
                      width={rect.width * previewScale}
                      height={rect.height * previewScale}
                      opacity={styleByState.opacity}
                      zIndex={layer.zIndex}
                    />
                  )
                })}
              {selectedLayer && selectedRect ? (
                <div
                  ref={selectionBoxRef}
                  className="grid-builder__selection"
                  style={{
                    left: selectedRect.x * previewScale,
                    top: selectedRect.y * previewScale,
                    width: selectedRect.width * previewScale,
                    height: selectedRect.height * previewScale,
                  }}
                  onPointerDown={(event) => {
                    if (selectedLayer.locked) return
                    beginCanvasInteraction(event, selectedLayer, 'move')
                  }}
                >
                  <button
                    type="button"
                    className="grid-builder__handle grid-builder__handle--nw"
                    onPointerDown={(event) => {
                      if (selectedLayer.locked) return
                      beginCanvasInteraction(event, selectedLayer, 'resize-nw')
                    }}
                  />
                  <button
                    type="button"
                    className="grid-builder__handle grid-builder__handle--ne"
                    onPointerDown={(event) => {
                      if (selectedLayer.locked) return
                      beginCanvasInteraction(event, selectedLayer, 'resize-ne')
                    }}
                  />
                  <button
                    type="button"
                    className="grid-builder__handle grid-builder__handle--sw"
                    onPointerDown={(event) => {
                      if (selectedLayer.locked) return
                      beginCanvasInteraction(event, selectedLayer, 'resize-sw')
                    }}
                  />
                  <button
                    type="button"
                    className="grid-builder__handle grid-builder__handle--se"
                    onPointerDown={(event) => {
                      if (selectedLayer.locked) return
                      beginCanvasInteraction(event, selectedLayer, 'resize-se')
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid-builder__viewer-zoom">
            <div className="grid-builder__zoom-controls">
              <span>Zoom {Math.round(previewZoom * 100)}%</span>
              <div className="grid-builder__zoom-actions">
                <button type="button" onClick={() => stepPreviewZoom(-0.1)} aria-label="Zoom out">-</button>
                <button type="button" onClick={() => setPreviewZoom(1)} aria-label="Reset zoom">100%</button>
                <button type="button" onClick={() => stepPreviewZoom(0.1)} aria-label="Zoom in">+</button>
              </div>
            </div>
          </div>
          <div className="grid-builder__viewer-rulers">
            <label className="grid-builder__toggle">
              <input
                className="grid-builder__toggle-checkbox"
                type="checkbox"
                checked={rulersEnabled}
                onChange={(e) => setRulersEnabled(e.target.checked)}
              />
              <span>Rulers</span>
            </label>
          </div>
        </div>

        </main>

        {!isCompactBuilderLayout ? (
          <div
            className="grid-builder__splitter"
            role="separator"
            aria-label="Resize preview panel"
            aria-orientation="vertical"
            onPointerDown={(event) => beginSplitterInteraction(event, 'viewer')}
          />
        ) : null}

        <aside className="grid-builder__settings grid-builder__panel grid-builder__panel--editor">
        {selectedLayer ? (
          <div className="grid-builder__settings-stack">
          <div className="grid-builder__editor-header">
            <h2 className="grid-builder__block-title">Editor</h2>
          </div>
          <details className="grid-builder__accordion" open>
            <summary className="grid-builder__accordion-summary">Layer</summary>
          <section className="grid-builder__editor grid-builder__tool-block">
            <div className="grid-builder__inputs grid-builder__inputs--editor">
              <label>Name<DeferredTextInput value={selectedLayer.name} onCommit={(v) => updateLayer(selectedLayer.id, { name: v })} /></label>
              <label>Zone ID<DeferredTextInput value={selectedLayer.zoneId ?? ''} onCommit={(v) => updateLayer(selectedLayer.id, { zoneId: (v.trim() || fallbackZoneId(selectedLayer.id)) as BetZoneId })} /></label>
              <label>X (center)
                <DeferredNumberInput
                  value={Math.round((selectedCenterCoords?.x ?? 0) * 1000) / 1000}
                  onCommit={(cx) => {
                    const w = selectedRect?.width ?? 0
                    const h = selectedRect?.height ?? 0
                    const cy = selectedCenterCoords?.y ?? 0
                    applyLayerRect(selectedLayer.id, editStateKey, {
                      x: frameCenter.x + cx - w / 2,
                      y: frameCenter.y + cy - h / 2,
                      width: w,
                      height: h,
                    })
                  }}
                  onStepCommit={(nextCx) => {
                    const w = selectedRect?.width ?? 0
                    const h = selectedRect?.height ?? 0
                    const cy = selectedCenterCoords?.y ?? 0
                    applyLayerRect(selectedLayer.id, editStateKey, {
                      x: frameCenter.x + nextCx - w / 2,
                      y: frameCenter.y + cy - h / 2,
                      width: w,
                      height: h,
                    })
                  }}
                />
              </label>
              <label>Y (center)
                <DeferredNumberInput
                  value={Math.round((selectedCenterCoords?.y ?? 0) * 1000) / 1000}
                  onCommit={(cy) => {
                    const w = selectedRect?.width ?? 0
                    const h = selectedRect?.height ?? 0
                    const cx = selectedCenterCoords?.x ?? 0
                    applyLayerRect(selectedLayer.id, editStateKey, {
                      x: frameCenter.x + cx - w / 2,
                      y: frameCenter.y + cy - h / 2,
                      width: w,
                      height: h,
                    })
                  }}
                  onStepCommit={(nextCy) => {
                    const w = selectedRect?.width ?? 0
                    const h = selectedRect?.height ?? 0
                    const cx = selectedCenterCoords?.x ?? 0
                    applyLayerRect(selectedLayer.id, editStateKey, {
                      x: frameCenter.x + cx - w / 2,
                      y: frameCenter.y + nextCy - h / 2,
                      width: w,
                      height: h,
                    })
                  }}
                />
              </label>
              <label>W
                <DeferredNumberInput
                  value={selectedRect?.width ?? 0}
                  onCommit={(w) => applyLayerRect(selectedLayer.id, editStateKey, { x: selectedRect?.x ?? 0, y: selectedRect?.y ?? 0, width: w, height: selectedRect?.height ?? 0 })}
                  onStepCommit={(w) => applyLayerRect(selectedLayer.id, editStateKey, { x: selectedRect?.x ?? 0, y: selectedRect?.y ?? 0, width: w, height: selectedRect?.height ?? 0 })}
                />
              </label>
              <label>H
                <DeferredNumberInput
                  value={selectedRect?.height ?? 0}
                  onCommit={(h) => applyLayerRect(selectedLayer.id, editStateKey, { x: selectedRect?.x ?? 0, y: selectedRect?.y ?? 0, width: selectedRect?.width ?? 0, height: h })}
                  onStepCommit={(h) => applyLayerRect(selectedLayer.id, editStateKey, { x: selectedRect?.x ?? 0, y: selectedRect?.y ?? 0, width: selectedRect?.width ?? 0, height: h })}
                />
              </label>
              <label>Z
                <DeferredNumberInput
                  value={selectedLayer.zIndex}
                  onCommit={(v) => setLayerZIndex(selectedLayer.id, v)}
                  onStepCommit={(v) => setLayerZIndex(selectedLayer.id, v)}
                />
              </label>
              <label>Scale
                <div className="grid-builder__scale-control">
                  <input
                    type="range"
                    min={0.05}
                    max={10}
                    step={0.01}
                    value={layerScaleValue}
                    onChange={(e) => applyLayerScaleByCenter(Number(e.target.value))}
                    aria-label="Layer scale slider"
                  />
                  <DeferredNumberInput
                    min={0.05}
                    max={10}
                    step={0.01}
                    value={layerScaleValue}
                    onCommit={(v) => applyLayerScaleByCenter(v)}
                    onStepCommit={(v) => applyLayerScaleByCenter(Math.max(0.05, Math.min(10, v)))}
                  />
                </div>
              </label>
            </div>
            <div className="grid-builder__global-visibility">
              <span className="grid-builder__global-visibility-label">Grid state visibility</span>
              <label className="grid-builder__checkbox-label">
                <input
                  type="checkbox"
                  className="grid-builder__checkbox"
                  checked={selectedLayer.globalVisibility?.open ?? true}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      globalVisibility: {
                        open: e.target.checked,
                        closed: selectedLayer.globalVisibility?.closed ?? true,
                      },
                    })
                  }
                />
                Show when Open
              </label>
              <label className="grid-builder__checkbox-label">
                <input
                  type="checkbox"
                  className="grid-builder__checkbox"
                  checked={selectedLayer.globalVisibility?.closed ?? true}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      globalVisibility: {
                        open: selectedLayer.globalVisibility?.open ?? true,
                        closed: e.target.checked,
                      },
                    })
                  }
                />
                Show when Closed
              </label>
            </div>
          </section>
          </details>
          <details className="grid-builder__accordion" open>
            <summary className="grid-builder__accordion-summary">States</summary>
          <section className="grid-builder__editor grid-builder__tool-block">
            <div className="grid-builder__state-layout">
              <div className="grid-builder__state-form">
                <div className="grid-builder__state-switcher" role="tablist" aria-label="State switcher">
                  {enabledStateKeys.map((state) => (
                    <button
                      key={state}
                      type="button"
                      role="tab"
                      aria-selected={editStateKey === state}
                      className={`grid-builder__state-tab ${editStateKey === state ? 'is-active' : ''}`}
                      onClick={() => setEditStateKey(state)}
                    >
                      {state}
                    </button>
                  ))}
                  <div className="grid-builder__state-create-wrap">
                    <button
                      ref={stateCreateTriggerRef}
                      type="button"
                      className="grid-builder__state-tab grid-builder__state-tab--create"
                      onClick={() => setStateCreateMenuOpen((prev) => !prev)}
                      disabled={availableToCreateStates.length === 0}
                      aria-haspopup="listbox"
                      aria-expanded={stateCreateMenuOpen}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M12 6v12M6 12h12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </svg>
                      Create
                    </button>
                    {stateCreateMenuOpen && availableToCreateStates.length > 0 ? (
                      <div ref={stateCreateMenuRef} className="grid-builder__state-create-dropdown" role="listbox">
                        {availableToCreateStates.map((state) => (
                          <button
                            key={state}
                            type="button"
                            className="grid-builder__state-create-option"
                            role="option"
                            onClick={() => {
                              createLayerState(selectedLayer.id, state)
                              setEditStateKey(state)
                              setStateCreateMenuOpen(false)
                            }}
                          >
                            {state}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid-builder__state-row grid-builder__state-row--two">
                  <label className="grid-builder__state-checkbox">
                    <span className="grid-builder__state-field-label">Visible</span>
                    <input
                      className="grid-builder-control-checkbox"
                      type="checkbox"
                      checked={Boolean(editStateStyle?.visible)}
                      onChange={(e) => {
                        updateLayerState(selectedLayer.id, editStateKey, { visible: e.target.checked })
                      }}
                    />
                  </label>
                  <label>
                    <span className="grid-builder__state-field-label">Opacity</span>
                    <DeferredNumberInput
                      className="grid-builder-control-input"
                      min={0}
                      max={1}
                      step={0.05}
                      value={editStateStyle?.opacity ?? 1}
                      onCommit={(v) => updateLayerState(selectedLayer.id, editStateKey, { opacity: Math.max(0, Math.min(1, v)) })}
                      onStepCommit={(v) => updateLayerState(selectedLayer.id, editStateKey, { opacity: Math.max(0, Math.min(1, v)) })}
                    />
                  </label>
                </div>

                <div className="grid-builder__state-row">
                  <span className="grid-builder__state-row-title">SVG</span>
                  <div className="grid-builder__state-inline-buttons grid-builder__state-inline-buttons--full">
                    <button className="grid-builder-control-btn" type="button" onClick={() => void pasteSvgFromClipboard('state')}>
                      Paste SVG
                    </button>
                    <button
                      className="grid-builder-control-btn"
                      type="button"
                      onClick={() => void pasteSvgFromClipboard('replace-state')}
                    >
                      Paste & replace SVG
                    </button>
                  </div>
                </div>
                <div className="grid-builder__state-footer">
                  <button
                    className="grid-builder-control-btn grid-builder-control-btn--danger"
                    type="button"
                    onClick={() => {
                      removeLayerState(selectedLayer.id, editStateKey)
                      setEditStateKey('default')
                    }}
                    disabled={editStateKey === 'default'}
                  >
                    Delete state
                  </button>
                  <button
                    className="grid-builder-control-btn"
                    type="button"
                    onClick={() => resetLayerStateToDefault(selectedLayer.id, editStateKey)}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </section>
          </details>
          <details className="grid-builder__accordion" open>
            <summary className="grid-builder__accordion-summary">Animation</summary>
          <section className="grid-builder__editor-block grid-builder__tool-block">
            <div className="grid-builder__inputs grid-builder__inputs--editor">
              <label>
                Preset
                <select
                  value={selectedAnimation.preset}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      animation: {
                        ...selectedAnimation,
                        preset: e.target.value as typeof selectedAnimation.preset,
                      },
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="zoom-in">Zoom in</option>
                  <option value="zoom-out">Zoom out</option>
                  <option value="from-left">Move from left</option>
                  <option value="from-top">Move from top</option>
                </select>
              </label>
              <label>
                Trigger
                <select
                  value={selectedAnimation.trigger}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      animation: {
                        ...selectedAnimation,
                        trigger: e.target.value as typeof selectedAnimation.trigger,
                      },
                    })
                  }
                >
                  <option value="while-active">While in target state</option>
                  <option value="on-transition">Only on state transition</option>
                </select>
              </label>
              <label>
                From state
                <select
                  value={selectedAnimation.fromState}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      animation: {
                        ...selectedAnimation,
                        fromState: e.target.value as typeof selectedAnimation.fromState,
                      },
                    })
                  }
                >
                  <option value="any">Any</option>
                  {STATES.map((state) => (
                    <option key={`from-${state}`} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                To state
                <select
                  value={selectedAnimation.toState}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      animation: {
                        ...selectedAnimation,
                        toState: e.target.value as typeof selectedAnimation.toState,
                      },
                    })
                  }
                >
                  <option value="any">Any</option>
                  {STATES.map((state) => (
                    <option key={`to-${state}`} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Duration (ms)
                <DeferredNumberInput
                  min={0}
                  step={10}
                  value={selectedAnimation.durationMs}
                  onCommit={(v) => updateLayer(selectedLayer.id, { animation: { ...selectedAnimation, durationMs: Math.max(0, v) } })}
                  onStepCommit={(v) => updateLayer(selectedLayer.id, { animation: { ...selectedAnimation, durationMs: Math.max(0, v) } })}
                />
              </label>
              <label>
                Delay (ms)
                <DeferredNumberInput
                  min={0}
                  step={10}
                  value={selectedAnimation.delayMs}
                  onCommit={(v) => updateLayer(selectedLayer.id, { animation: { ...selectedAnimation, delayMs: Math.max(0, v) } })}
                  onStepCommit={(v) => updateLayer(selectedLayer.id, { animation: { ...selectedAnimation, delayMs: Math.max(0, v) } })}
                />
              </label>
              <label>
                Easing
                <select
                  value={selectedAnimation.easing}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      animation: {
                        ...selectedAnimation,
                        easing: e.target.value as typeof selectedAnimation.easing,
                      },
                    })
                  }
                >
                  <option value="ease">ease</option>
                  <option value="linear">linear</option>
                  <option value="ease-in">ease-in</option>
                  <option value="ease-out">ease-out</option>
                  <option value="ease-in-out">ease-in-out</option>
                </select>
              </label>
              <label>
                Intensity
                <DeferredNumberInput
                  min={0}
                  max={3}
                  step={0.1}
                  value={selectedAnimation.intensity}
                  onCommit={(v) => updateLayer(selectedLayer.id, { animation: { ...selectedAnimation, intensity: Math.max(0, Math.min(3, v)) } })}
                  onStepCommit={(v) => updateLayer(selectedLayer.id, { animation: { ...selectedAnimation, intensity: Math.max(0, Math.min(3, v)) } })}
                />
              </label>
            </div>
          </section>
          </details>
          </div>
        ) : (
          <section className="grid-builder__editor grid-builder__tool-block">
            <h3 className="grid-builder__block-title">Editor</h3>
            <p>Select a layer to edit settings.</p>
          </section>
        )}
        </aside>

        {!isCompactBuilderLayout ? (
          <div
            className="grid-builder__splitter grid-builder__splitter--secondary"
            role="separator"
            aria-label="Resize layers panel"
            aria-orientation="vertical"
            onPointerDown={(event) => beginSplitterInteraction(event, 'sidebar')}
          />
        ) : null}

        <aside className="grid-builder__sidebar grid-builder__panel grid-builder__panel--layers">
          <div className="grid-builder__sidebar-header">
            <h2 className="grid-builder__block-title">Layers</h2>
            <div className="grid-builder__sidebar-header-actions">
              <button
                type="button"
                className="grid-builder-btn grid-builder-btn--primary grid-builder__icon-btn"
                aria-label="Add layer"
                title="Add layer"
                onClick={openLayerImportPopup}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 6v12M6 12h12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                ref={headerMenuTriggerRef}
                type="button"
                className={`grid-builder-btn grid-builder__menu-trigger ${headerMenuOpen ? 'is-open' : ''}`}
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={headerMenuOpen}
                onClick={() => {
                  if (!headerMenuOpen) updateHeaderMenuRect()
                  setProjectDropdownOpen(false)
                  setHeaderMenuOpen((prev) => !prev)
                }}
              >
                <span aria-hidden>
                  <svg viewBox="0 0 24 24">
                    <circle cx="6" cy="12" r="1.8" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                    <circle cx="18" cy="12" r="1.8" fill="currentColor" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        <div
          className="grid-builder__list"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedLayerId('')
            }
          }}
        >
          {sortedLayers.map((layer) => (
              <LayerItem
                key={layer.id}
                layer={layer}
                isSelected={selectedLayerId === layer.id}
                isDragging={draggingLayerId === layer.id}
                dropIndicator={dragOverInfo?.id === layer.id ? dragOverInfo.position : null}
                isRenaming={renamingLayerId === layer.id}
                renamingValue={renamingValue}
                editStateKey={layerEditStates[layer.id] ?? 'default'}
                onSelect={setSelectedLayerId}
                onDragStart={setDraggingLayerId}
                onDragOverLayer={layerItemOnDragOverLayer}
                onDropOnLayer={layerItemOnDropOnLayer}
                onDragEnd={layerItemOnDragEnd}
                onRenamingChange={setRenamingValue}
                onRenamingCommit={commitRenameLayer}
                onRenamingCancel={cancelRenameLayer}
                onRenamingStart={startRenameLayer}
                onToggleVisible={layerItemOnToggleVisible}
                onToggleLocked={layerItemOnToggleLocked}
              />
            ))}
        </div>
        <div className="grid-builder__layers-footer">
          <span className="grid-builder__layers-count">Layers: {pkg.layers.length}</span>
          <div className="grid-builder__layers-actions">
            {selectedLayer ? (
              <>
                <button
                  type="button"
                  className="grid-builder__icon-action"
                  title="Paste SVG as new layer"
                  aria-label="Paste SVG as new layer"
                  onClick={() => void pasteSvgFromClipboard('layer')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M9 4h6m-5 3h4m-7 0h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              <button
                type="button"
                className="grid-builder__icon-action"
                title="Copy layer"
                aria-label="Copy layer"
                onClick={() => duplicateLayer(selectedLayer.id)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 9h10v10H9zM5 5h10v2H7v8H5z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="grid-builder__icon-action"
                title="Rename layer"
                aria-label="Rename layer"
                onClick={() => startRenameLayer(selectedLayer)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 20l4.5-1 9.3-9.3a1.4 1.4 0 0 0 0-2l-1.5-1.5a1.4 1.4 0 0 0-2 0L5 15.5 4 20z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="grid-builder__icon-action grid-builder__icon-action--danger"
                title="Delete layer"
                aria-label="Delete layer"
                onClick={() => removeLayer(selectedLayer.id)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 7h16M9 7V5h6v2m-8 0l1 12h8l1-12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              </>
            ) : null}
          </div>
        </div>
        </aside>
      </div>

      {layerImportOpen ? (
        <div className="grid-builder-modal__overlay" role="presentation" onClick={closeLayerImportPopup}>
          <div
            className="grid-builder-modal grid-builder-modal--small"
            role="dialog"
            aria-modal="true"
            aria-label="Import SVG layer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid-builder-modal__header">
              <h3>Add SVG Layer</h3>
            </div>
            <div className="grid-builder-modal__body">
              <div
                className={`grid-builder-dropzone ${layerDropActive ? 'is-active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label="Drop SVG files or click to choose from computer"
                onDragOver={(event) => {
                  event.preventDefault()
                  setLayerDropActive(true)
                }}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setLayerDropActive(true)
                }}
                onDragLeave={(event) => {
                  event.preventDefault()
                  const nextTarget = event.relatedTarget as Node | null
                  if (nextTarget && event.currentTarget.contains(nextTarget)) return
                  setLayerDropActive(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setLayerDropActive(false)
                  void onUploadLayers(event.dataTransfer.files)
                  closeLayerImportPopup()
                }}
                onClick={() => layerImportFileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    layerImportFileInputRef.current?.click()
                  }
                }}
              >
                <strong>Drag and drop SVG files here</strong>
                <span>or click this area to choose from computer</span>
                <button
                  type="button"
                  className="grid-builder-dropzone__link"
                  onClick={(event) => {
                    event.stopPropagation()
                    void pasteSvgFromClipboard('layer')
                    closeLayerImportPopup()
                  }}
                >
                  Paste SVG from clipboard
                </button>
              </div>
              <input
                ref={layerImportFileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                multiple
                className="grid-builder__visually-hidden"
                onChange={(e) => {
                  void onUploadLayers(e.target.files)
                  e.currentTarget.value = ''
                  closeLayerImportPopup()
                }}
              />
            </div>
            <div className="grid-builder-modal__footer">
              <button type="button" className="grid-builder-btn" onClick={closeLayerImportPopup}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

