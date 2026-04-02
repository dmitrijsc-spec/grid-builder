import { useBettingOpen, useGame } from '../../game/GameContext'
import type { BetZoneId } from '../../game/types'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createDefaultGridPackage } from './builder/defaultPackage'
import {
  applyRuntimePackagesPayloadFromDevServer,
  decodeRuntimePackagesSnapshotRaw,
  DEV_RUNTIME_PACKAGES_URL,
  getRuntimeLayoutMode,
  GRID_PACKAGE_BROADCAST_CHANNEL,
  GRID_PACKAGE_EVENT,
  loadGridPackage,
  normalizeGridPackage,
} from './builder/storage'
import {
  getGridCloudRoomForPlay,
  isSupabaseGridCloudConfigured,
  supabasePullGridRuntimePayload,
} from '../../services/gridCloudSupabase'
import { layerAnimationStyle } from './builder/layerAnimation'
import type { GridGameViewState, GridPackage, GridVisualState } from './builder/types'
import { GRID_SKIN } from './config/gridSkin'
import type { GridZoneConfig } from './config/gridZones'
import { normalizeSvgDataUrlForImg, prepareInlineSvgMarkup } from './svgDataUrl'

/** Mobile WK/Blink often softens SVG-in-<img> when layout width is fractional; snap to device pixel grid. */
function snapCssPx(cssPx: number): number {
  const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1
  return Math.round(cssPx * dpr) / dpr
}

/**
 * SVG grid art: we render `data:image/svg+xml` as inline `<svg>` (see `prepareInlineSvgMarkup`)
 * so WebKit paints vectors at layout DPR. `<img>` fallbacks use `normalizeSvgDataUrlForImg`.
 */
function BetCell({
  zone,
  className = '',
  style,
  isHovered,
  hideOverlayContent = false,
  onHoverChange,
}: {
  zone: GridZoneConfig
  className?: string
  style?: CSSProperties
  isHovered: boolean
  hideOverlayContent?: boolean
  onHoverChange: (next: boolean) => void
}) {
  const { state, dispatch } = useGame()
  const open = useBettingOpen()
  const amount = state.bets[zone.id] ?? 0
  const mergedStyle = {
    ...style,
    '--zone-hover-border': zone.hover?.border ?? 'rgba(255,220,156,0.92)',
    '--zone-hover-bg': zone.hover?.background ?? 'rgba(255,242,209,0.16)',
    '--zone-hover-text': zone.hover?.text ?? '#ffeac6',
  } as CSSProperties

  return (
    <button
      type="button"
      className={`bet-cell bet-cell--hit ${className} ${isHovered ? 'is-hovered' : ''}`.trim()}
      data-skin={zone.skin ?? 'default'}
      aria-label={zone.sub ? `${zone.label} ${zone.sub}` : zone.label}
      style={mergedStyle}
      disabled={!open}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      onClick={() => dispatch({ type: 'PLACE_BET', zoneId: zone.id })}
    >
      {hideOverlayContent ? null : <span className="bet-cell__label">{zone.label}</span>}
      {hideOverlayContent ? null : (zone.sub ? <span className="bet-cell__sub">{zone.sub}</span> : null)}
      {!hideOverlayContent && amount > 0 ? (
        <span className="bet-cell__stake">{amount}</span>
      ) : null}
    </button>
  )
}

function pxRect(
  x: number,
  y: number,
  w: number,
  h: number,
  gridWidth: number,
  gridHeight: number,
): CSSProperties {
  const safeWidth = gridWidth > 0 ? gridWidth : 1
  const safeHeight = gridHeight > 0 ? gridHeight : 1
  return {
    left: `${(x / safeWidth) * 100}%`,
    top: `${(y / safeHeight) * 100}%`,
    width: `${(w / safeWidth) * 100}%`,
    height: `${(h / safeHeight) * 100}%`,
  }
}

function resolveStateSvg(
  layer: GridPackage['layers'][number],
  state: GridVisualState,
): string | undefined {
  const direct = layer.stateSvgs?.[state]
  if (direct) return direct
  // Runtime uses `chipPlaced` for a bet; older packages / builder habits used `active` art for the same moment.
  if (state === 'chipPlaced' && layer.stateSvgs?.active) {
    return layer.stateSvgs.active
  }
  return undefined
}

function resolveLayerVisual(
  gridPackage: GridPackage,
  layer: GridPackage['layers'][number],
  state: GridVisualState,
): {
  src: string
  opacity: number
  visible: boolean
  rect: { x: number; y: number; width: number; height: number }
} {
  const rect = layer.stateRects?.[state] ?? {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  }
  const stateSvg = resolveStateSvg(layer, state)
  if (stateSvg) {
    const style =
      layer.stateStyles?.[state] ?? layer.stateStyles?.default ?? { visible: true, opacity: 1 }
    return {
      src: stateSvg,
      opacity: style.opacity,
      visible: style.visible,
      rect,
    }
  }

  if (layer.componentId && layer.variantId) {
    const component = gridPackage.components.find((item) => item.id === layer.componentId)
    const variant = component?.variants.find((item) => item.id === layer.variantId)
    if (variant) {
      const style =
        variant.stateStyles[state] ?? variant.stateStyles.default ?? { visible: true, opacity: 1 }
      return {
        src: variant.src,
        opacity: style.opacity,
        visible: style.visible,
        rect,
      }
    }
  }
  const fallbackStyle =
    layer.stateStyles?.[state] ?? layer.stateStyles?.default ?? { visible: true, opacity: 1 }
  return {
    src: layer.src,
    opacity: fallbackStyle.opacity,
    visible: fallbackStyle.visible,
    rect,
  }
}

export function BettingGrid() {
  const detectViewportMode = (): 'desktop' | 'mobile' => getRuntimeLayoutMode()

  const { state } = useGame()
  const isClosed = state.phase !== 'betting'
  const globalGridState: 'open' | 'closed' =
    state.gridViewState === 'auto'
      ? (isClosed ? 'closed' : 'open')
      : state.gridViewState
  const [runtimeDeviceMode, setRuntimeDeviceMode] = useState<'desktop' | 'mobile'>(() => detectViewportMode())
  const [hoveredZoneId, setHoveredZoneId] = useState<BetZoneId | null>(null)
  const [imageCacheVersion, setImageCacheVersion] = useState(0)
  const [mobileSnapSize, setMobileSnapSize] = useState<{ w: number; h: number } | null>(null)
  const gridShellRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasImagesRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const previousLayerStateRef = useRef<Record<string, GridVisualState>>({})
  /** Last committed grid open/closed; updated in useLayoutEffect so animation can read a stable "from" state. */
  const prevGridForAnimationRef = useRef<GridGameViewState>(globalGridState)
  /** Bumps only when grid or hover changes so layer useMemo runs twice: transition frame, then settled (fixes stuck on-transition CSS). */
  const [layerAnimationLayoutFlush, setLayerAnimationLayoutFlush] = useState(0)
  const prevAnimationSyncRef = useRef({ grid: globalGridState, hover: hoveredZoneId })
  const latestPublishedPackagesRef = useRef<{
    desktop: GridPackage | null
    mobile: GridPackage | null
  }>({ desktop: null, mobile: null })
  const isMobileRuntime = runtimeDeviceMode === 'mobile'
  const isIOSWebKit =
    typeof navigator !== 'undefined' &&
    (/iP(hone|ad|od)/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1))
  /**
   * Mobile runtime = narrow band / touch UA (`getRuntimeLayoutMode`). Uses the same `closedMode`
   * tilt as desktop when the package is `tilted` (`data-perspective='on'`).
   */
  const [gridPackage, setGridPackage] = useState<GridPackage>(
    () => loadGridPackage(detectViewportMode()) ?? createDefaultGridPackage(),
  )

  useEffect(() => {
    const pickForMode = (
      detail:
        | {
            pkg?: GridPackage | null
            mode?: 'desktop' | 'mobile'
            desktopPkg?: GridPackage | null
            mobilePkg?: GridPackage | null
          }
        | undefined,
      mode: 'desktop' | 'mobile',
    ): GridPackage | null => {
      const desktopPkg = detail?.desktopPkg ?? null
      const mobilePkg = detail?.mobilePkg ?? null
      if (desktopPkg?.version === 1) {
        latestPublishedPackagesRef.current.desktop = normalizeGridPackage(structuredClone(desktopPkg))
      }
      if (mobilePkg?.version === 1) {
        latestPublishedPackagesRef.current.mobile = normalizeGridPackage(structuredClone(mobilePkg))
      }
      const selected =
        mode === 'mobile'
          ? latestPublishedPackagesRef.current.mobile
          : latestPublishedPackagesRef.current.desktop
      if (selected?.version === 1) return normalizeGridPackage(structuredClone(selected))
      // Mobile: fall back to desktop (or legacy single pkg) when mobile slot was never published.
      const fallbackPkg =
        mode === 'mobile'
          ? (detail?.mobilePkg ?? detail?.desktopPkg ?? detail?.pkg ?? null)
          : (detail?.pkg ?? detail?.desktopPkg ?? null)
      if (fallbackPkg?.version === 1) return normalizeGridPackage(structuredClone(fallbackPkg))
      return null
    }

    const reloadPackage = (event?: Event) => {
      const maybeCustom = event as CustomEvent<{
        pkg?: GridPackage | null
        mode?: 'desktop' | 'mobile'
        desktopPkg?: GridPackage | null
        mobilePkg?: GridPackage | null
      }> | undefined
      const pkgFromEvent = pickForMode(maybeCustom?.detail, runtimeDeviceMode)
      if (pkgFromEvent && pkgFromEvent.version === 1) {
        setGridPackage(pkgFromEvent)
        return
      }
      setGridPackage(loadGridPackage(runtimeDeviceMode) ?? createDefaultGridPackage())
    }

    // Only respond to explicit publish events (Update Game button) — NOT storage changes
    window.addEventListener(GRID_PACKAGE_EVENT, reloadPackage as EventListener)
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(GRID_PACKAGE_BROADCAST_CHANNEL)
        : null
    const onChannelMessage = (message: MessageEvent<{
      pkg?: GridPackage | null
      mode?: 'desktop' | 'mobile'
      desktopPkg?: GridPackage | null
      mobilePkg?: GridPackage | null
    }>) => {
      const pkgFromMessage = pickForMode(message.data, runtimeDeviceMode)
      if (pkgFromMessage && pkgFromMessage.version === 1) {
        setGridPackage(pkgFromMessage)
      }
    }
    channel?.addEventListener('message', onChannelMessage)

    return () => {
      window.removeEventListener(GRID_PACKAGE_EVENT, reloadPackage as EventListener)
      channel?.removeEventListener('message', onChannelMessage)
      channel?.close()
    }
  }, [runtimeDeviceMode])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (isSupabaseGridCloudConfigured() && getGridCloudRoomForPlay()) return
    let cancelled = false
    let lastSeenUpdatedAt = ''
    const poll = async () => {
      try {
        const res = await fetch(`${DEV_RUNTIME_PACKAGES_URL}?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const text = await res.text()
        if (!text.trim()) return
        const snap = decodeRuntimePackagesSnapshotRaw(text)
        if (!snap?.updatedAt || snap.updatedAt === lastSeenUpdatedAt) return
        lastSeenUpdatedAt = snap.updatedAt
        applyRuntimePackagesPayloadFromDevServer(text)
      } catch {
        // Relay unavailable (e.g. production preview) — ignore
      }
    }
    void poll()
    const id = window.setInterval(poll, 1500)
    const onBecameVisible = () => {
      if (!document.hidden) void poll()
    }
    document.addEventListener('visibilitychange', onBecameVisible)
    window.addEventListener('focus', onBecameVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onBecameVisible)
      window.removeEventListener('focus', onBecameVisible)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseGridCloudConfigured()) return
    const room = getGridCloudRoomForPlay()
    if (!room) return
    let cancelled = false
    let lastRemoteUpdatedAt = ''
    const poll = async () => {
      try {
        const row = await supabasePullGridRuntimePayload(room)
        if (!row || cancelled) return
        if (row.updatedAt === lastRemoteUpdatedAt) return
        const ok = applyRuntimePackagesPayloadFromDevServer(row.payload)
        if (ok) lastRemoteUpdatedAt = row.updatedAt
      } catch {
        // offline / CORS / quota
      }
    }
    void poll()
    // Faster propagation for QA devices (mobile) without relying on reloads.
    const id = window.setInterval(poll, 1500)
    const onBecameVisible = () => {
      if (!document.hidden) void poll()
    }
    document.addEventListener('visibilitychange', onBecameVisible)
    window.addEventListener('focus', onBecameVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onBecameVisible)
      window.removeEventListener('focus', onBecameVisible)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onViewportModeChange = () => setRuntimeDeviceMode(detectViewportMode())
    window.addEventListener('resize', onViewportModeChange)
    window.addEventListener('orientationchange', onViewportModeChange)
    const onRuntimeViewportModeChange = (event: Event) => {
      const custom = event as CustomEvent<{ mobile?: boolean }>
      const forcedMobile = custom.detail?.mobile
      if (typeof forcedMobile === 'boolean') {
        setRuntimeDeviceMode(forcedMobile ? 'mobile' : 'desktop')
        return
      }
      setRuntimeDeviceMode(detectViewportMode())
    }
    window.addEventListener('iki-runtime:viewport-mode-changed', onRuntimeViewportModeChange as EventListener)
    return () => {
      window.removeEventListener('resize', onViewportModeChange)
      window.removeEventListener('orientationchange', onViewportModeChange)
      window.removeEventListener(
        'iki-runtime:viewport-mode-changed',
        onRuntimeViewportModeChange as EventListener,
      )
    }
  }, [])

  useEffect(() => {
    const published = latestPublishedPackagesRef.current[runtimeDeviceMode]
    if (published?.version === 1) {
      setGridPackage(normalizeGridPackage(structuredClone(published)))
      return
    }
    setGridPackage(loadGridPackage(runtimeDeviceMode) ?? createDefaultGridPackage())
  }, [runtimeDeviceMode])
  const frameWidth = gridPackage.frame.width > 0 ? gridPackage.frame.width : GRID_SKIN.baseWidth
  const frameHeight = gridPackage.frame.height > 0 ? gridPackage.frame.height : GRID_SKIN.baseHeight
  const rawClipRect = gridPackage.global?.clipRect ?? { x: 0, y: 0, width: frameWidth, height: frameHeight }
  const runtimeBounds = useMemo(() => {
    let minX = Number.isFinite(rawClipRect.x) ? rawClipRect.x : 0
    let minY = Number.isFinite(rawClipRect.y) ? rawClipRect.y : 0
    let maxX = minX + (Number.isFinite(rawClipRect.width) ? rawClipRect.width : frameWidth)
    let maxY = minY + (Number.isFinite(rawClipRect.height) ? rawClipRect.height : frameHeight)

    for (const layer of gridPackage.layers) {
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

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return { x: 0, y: 0, width: frameWidth, height: frameHeight }
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  }, [frameHeight, frameWidth, gridPackage.layers, rawClipRect.height, rawClipRect.width, rawClipRect.x, rawClipRect.y])
  const runtimeOriginX = runtimeBounds.x
  const runtimeOriginY = runtimeBounds.y
  const runtimeFrameWidth = runtimeBounds.width
  const runtimeFrameHeight = runtimeBounds.height

  const runtimeZones: GridZoneConfig[] = useMemo(
    () =>
      gridPackage.layers
        .filter(
          (layer) => Boolean(layer.zoneId),
        )
        .map((layer) => {
          const baseRect = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
          }
          const hoverRect = layer.stateRects?.hover ?? baseRect
          // Hit area should include both default and hover geometry.
          // This keeps hover trigger stable even when hover state shifts/scales the layer.
          const hitLeft = Math.min(baseRect.x, hoverRect.x)
          const hitTop = Math.min(baseRect.y, hoverRect.y)
          const hitRight = Math.max(baseRect.x + baseRect.width, hoverRect.x + hoverRect.width)
          const hitBottom = Math.max(baseRect.y + baseRect.height, hoverRect.y + hoverRect.height)
          return {
            id: layer.zoneId as BetZoneId,
            label: layer.name,
            rect: {
              x: hitLeft,
              y: hitTop,
              w: hitRight - hitLeft,
              h: hitBottom - hitTop,
            },
            skin: 'default',
          }
        }),
    [gridPackage.layers],
  )

  const closedMode = gridPackage.global?.closedMode ?? 'tilted'
  const usePerspectiveShell = closedMode === 'tilted'
  const perspective = usePerspectiveShell
  const allowMobileAtlas = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('mobileAtlas') === '1'
    : false
  const iosCanvasParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('iosCanvas')
      : null
  const publishedMobileAtlasSrc =
    gridPackage.global?.runtimeAtlas?.states?.[globalGridState]?.src
    ?? gridPackage.global?.runtimeAtlas?.states?.open?.src
    ?? null
  const useMobileAtlasRendering =
    isMobileRuntime
    && !isIOSWebKit
    && Boolean(publishedMobileAtlasSrc)
    && allowMobileAtlas
  const allowIOSCanvasFallback =
    typeof window !== 'undefined' && iosCanvasParam === '1'
  const useIOSCanvasRendering =
    allowIOSCanvasFallback
    && isIOSWebKit
    && !useMobileAtlasRendering
    && !usePerspectiveShell

  /** Inline SVG for all viewports when we render the stacked layer list (not atlas/canvas). */
  const useInlineSvgLayers = !useMobileAtlasRendering && !useIOSCanvasRendering

  const renderLayers = useMemo(
    () => {
      // Bumps when grid/hover changes so this memo re-runs after layout (animation transition frame).
      void layerAnimationLayoutFlush
      return gridPackage.layers
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((layer) => {
          // Respect globalVisibility — mirrors the builder's "Show when Open/Closed" checkboxes
          const globalVisible =
            globalGridState === 'open'
              ? (layer.globalVisibility?.open ?? true)
              : (layer.globalVisibility?.closed ?? true)

          const activeState: GridVisualState = layer.zoneId
            ? (globalGridState === 'open' && hoveredZoneId === layer.zoneId ? 'hover' : 'default')
            : 'default'
          const visual = resolveLayerVisual(
            gridPackage,
            layer,
            activeState,
          )
          const previousState = previousLayerStateRef.current[layer.id] ?? activeState
          const prevGrid = prevGridForAnimationRef.current
          const animationStyle = layerAnimationStyle(
            layer,
            previousState,
            activeState,
            prevGrid,
            globalGridState,
            isMobileRuntime ? { mobileStrip: true } : undefined,
          )
          const animationOpacity = animationStyle.opacity as number | undefined
          const shiftedRect = {
            x: visual.rect.x - runtimeOriginX,
            y: visual.rect.y - runtimeOriginY,
            width: visual.rect.width,
            height: visual.rect.height,
          }
          const inlineSvgMarkup = useInlineSvgLayers
            ? prepareInlineSvgMarkup(visual.src)
            : null
          const srcForImg = normalizeSvgDataUrlForImg(visual.src)
          const effectivelyHidden = !globalVisible || !visual.visible
          const baseOpacity =
            animationOpacity === undefined ? visual.opacity : visual.opacity * animationOpacity
          return {
            id: layer.id,
            name: layer.name,
            activeState,
            src: srcForImg,
            inlineSvgMarkup,
            rect: shiftedRect,
            style: {
              ...(isMobileRuntime && mobileSnapSize ? {
                left: `${snapCssPx((shiftedRect.x / runtimeFrameWidth) * mobileSnapSize.w)}px`,
                top: `${snapCssPx((shiftedRect.y / runtimeFrameHeight) * mobileSnapSize.h)}px`,
                width: `${snapCssPx((shiftedRect.width / runtimeFrameWidth) * mobileSnapSize.w)}px`,
                height: `${snapCssPx((shiftedRect.height / runtimeFrameHeight) * mobileSnapSize.h)}px`,
              } : {
                left: `${(shiftedRect.x / runtimeFrameWidth) * 100}%`,
                top: `${(shiftedRect.y / runtimeFrameHeight) * 100}%`,
                width: `${(shiftedRect.width / runtimeFrameWidth) * 100}%`,
                height: `${(shiftedRect.height / runtimeFrameHeight) * 100}%`,
              }),
              ...animationStyle,
              opacity: effectivelyHidden ? 0 : baseOpacity,
              ...(effectivelyHidden
                ? { visibility: 'hidden' as const, pointerEvents: 'none' as const }
                : {}),
              zIndex: layer.zIndex,
            } as CSSProperties,
          }
        })
    },
    [
      gridPackage,
      globalGridState,
      hoveredZoneId,
      runtimeFrameWidth,
      runtimeFrameHeight,
      runtimeOriginX,
      runtimeOriginY,
      isMobileRuntime,
      mobileSnapSize,
      layerAnimationLayoutFlush,
      useInlineSvgLayers,
    ],
  )

  useLayoutEffect(() => {
    const sync = prevAnimationSyncRef.current
    const hoverChanged = sync.hover !== hoveredZoneId
    if (prevGridForAnimationRef.current !== globalGridState) {
      prevGridForAnimationRef.current = globalGridState
    }
    sync.grid = globalGridState
    sync.hover = hoveredZoneId
    // Only hover needs an extra layout pass for stuck layer-transition CSS; grid open/closed is
    // already a dependency of `renderLayers`, and flushing here re-ran the memo with prevGrid already
    // updated — which killed in-flight grid-state layer styles mid-tilt.
    if (hoverChanged) {
      setLayerAnimationLayoutFlush((n) => n + 1)
    }
  }, [globalGridState, hoveredZoneId])

  useEffect(() => {
    const next: Record<string, GridVisualState> = {}
    for (const layer of renderLayers) next[layer.id] = layer.activeState
    previousLayerStateRef.current = next
  }, [renderLayers])
  // Match builder default: `previewScale = pkg.frame.scale * previewZoom` (previewZoom 1 in game).
  const runtimeScale =
    typeof gridPackage.frame?.scale === 'number' && gridPackage.frame.scale > 0
      ? gridPackage.frame.scale
      : GRID_SKIN.scale
  const runtimeWidthPx = runtimeFrameWidth * runtimeScale
  const runtimeWidthStyle = `${runtimeWidthPx}px`
  const runtimeClipPath = 'none'

  const baseTiltAngle = gridPackage.global?.tiltAngleDeg ?? 56
  // Match builder: tilt follows the same `open | closed` as layers/globalVisibility (gridViewState + phase),
  // not phase alone — otherwise admin "Grid State: Open" while bets closed still tilted but hid closed-only layers.
  const tiltAngleDeg = usePerspectiveShell ? (globalGridState === 'closed' ? baseTiltAngle : 0) : 0
  const tiltScale = usePerspectiveShell ? (globalGridState === 'closed' ? 0.97 : 1) : 1

  useEffect(() => {
    if (!useIOSCanvasRendering) return
    let cancelled = false
    const imageCache = canvasImagesRef.current
    const pending = renderLayers
      .map((layer) => layer.src)
      .filter((src, index, arr) => arr.indexOf(src) === index)
      .filter((src) => !imageCache.has(src))
    if (pending.length === 0) return

    for (const src of pending) {
      const img = new Image()
      img.decoding = 'sync'
      img.onload = () => {
        if (cancelled) return
        if (!imageCache.has(src)) {
          imageCache.set(src, img)
          setImageCacheVersion((prev) => prev + 1)
        }
      }
      img.src = src
    }
    return () => {
      cancelled = true
    }
  }, [renderLayers, useIOSCanvasRendering])

  /** Percent-based layer layout when 3D tilt is enabled — avoids ResizeObserver/snapped px fighting rotateX (jitter / “double render”). */
  const useMobileLayoutSnap = isMobileRuntime && !usePerspectiveShell
  useLayoutEffect(() => {
    if (!useMobileLayoutSnap) {
      setMobileSnapSize(null)
      return
    }
    const shell = gridShellRef.current
    if (!shell) return

    const measure = () => {
      const rect = shell.getBoundingClientRect()
      const rawW = rect.width
      if (!Number.isFinite(rawW) || rawW < 1) return
      const w = Math.max(1, snapCssPx(rawW))
      const h = Math.max(1, snapCssPx((w * runtimeFrameHeight) / runtimeFrameWidth))
      setMobileSnapSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(shell)
    return () => ro.disconnect()
  }, [useMobileLayoutSnap, runtimeFrameWidth, runtimeFrameHeight])

  useLayoutEffect(() => {
    if (!useIOSCanvasRendering) return
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 4))
      const rect = canvas.getBoundingClientRect()
      const cssWidth = Math.max(1e-6, rect.width)
      const cssHeight = Math.max(1e-6, rect.height)
      const physicalWidth = Math.max(1, Math.ceil(cssWidth * dpr))
      const physicalHeight = Math.max(1, Math.ceil(cssHeight * dpr))
      if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
        canvas.width = physicalWidth
        canvas.height = physicalHeight
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(physicalWidth / cssWidth, 0, 0, physicalHeight / cssHeight, 0, 0)
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'

      const scaleX = cssWidth / runtimeFrameWidth
      const scaleY = cssHeight / runtimeFrameHeight
      for (const layer of renderLayers) {
        const img = canvasImagesRef.current.get(layer.src)
        if (!img) continue
        const opacityValue = Number(layer.style.opacity ?? 1)
        const opacity = Number.isFinite(opacityValue) ? opacityValue : 1
        if (opacity <= 0) continue
        ctx.globalAlpha = opacity
        ctx.drawImage(
          img,
          layer.rect.x * scaleX,
          layer.rect.y * scaleY,
          layer.rect.width * scaleX,
          layer.rect.height * scaleY,
        )
      }
      ctx.globalAlpha = 1
    }

    draw()
    const resizeObserver = new ResizeObserver(draw)
    resizeObserver.observe(canvas)
    return () => resizeObserver.disconnect()
  }, [
    imageCacheVersion,
    renderLayers,
    runtimeFrameHeight,
    runtimeFrameWidth,
    useIOSCanvasRendering,
  ])

  /* Snapped box: dimensions come from CSS vars (see game.css) so they win over width:100%!important on mobile. */
  const tiltCssVars = usePerspectiveShell
    ? ({
        '--grid-tilt-angle': `${tiltAngleDeg}deg`,
        '--grid-tilt-scale': `${tiltScale}`,
      } as CSSProperties)
    : {}

  const gridBoxStyle: CSSProperties = {
    ...tiltCssVars,
    ...(mobileSnapSize && useMobileLayoutSnap
      ? {
          minHeight: 0,
          maxHeight: 'none',
          marginLeft: 'auto',
          marginRight: 'auto',
          clipPath: runtimeClipPath,
        }
      : {
          width: runtimeWidthStyle,
          aspectRatio: `${runtimeFrameWidth} / ${runtimeFrameHeight}`,
          height: 'auto',
          minHeight: 0,
          clipPath: runtimeClipPath,
        }),
  }

  return (
    <div
      ref={gridShellRef}
      className="betting-grid-shell"
      data-grid-layout={isMobileRuntime ? 'mobile' : 'desktop'}
      data-perspective={perspective ? 'on' : 'off'}
      data-mobile-pixel-snap={mobileSnapSize && useMobileLayoutSnap ? 'on' : undefined}
      style={
        {
          ...(mobileSnapSize && useMobileLayoutSnap
            ? ({
                '--betting-grid-snapped-w': `${mobileSnapSize.w}px`,
                '--betting-grid-snapped-h': `${mobileSnapSize.h}px`,
              } as CSSProperties)
            : {}),
          width: runtimeWidthStyle,
        } as CSSProperties
      }
    >
      <div
        className="betting-grid"
        data-render-surface={useMobileAtlasRendering ? 'atlas' : 'live'}
        style={gridBoxStyle}
      >
        {useMobileAtlasRendering ? (
          publishedMobileAtlasSrc ? (
            <>
              <img
                className="betting-grid__atlas"
                src={publishedMobileAtlasSrc}
                alt=""
                draggable={false}
                decoding="async"
                loading="eager"
                aria-hidden
              />
              <span className="betting-grid__mobile-atlas-flag" aria-hidden>ATLAS</span>
            </>
          ) : null
        ) : useIOSCanvasRendering ? (
          <canvas ref={canvasRef} className="betting-grid__canvas" aria-hidden />
        ) : (
          <div className="betting-grid__asset-layer" aria-hidden>
            {renderLayers.map((layer) =>
              layer.inlineSvgMarkup ? (
                <div
                  key={layer.id}
                  className="betting-grid__asset betting-grid__asset--svg-inline"
                  style={layer.style}
                  dangerouslySetInnerHTML={{ __html: layer.inlineSvgMarkup }}
                />
              ) : (
                <img
                  key={layer.id}
                  className="betting-grid__asset"
                  src={layer.src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  loading="eager"
                  style={layer.style}
                />
              ),
            )}
          </div>
        )}
        <div className="betting-grid__zones">
          {runtimeZones.map((zone) => {
            const visual: GridVisualState =
              globalGridState === 'open' && hoveredZoneId === zone.id ? 'hover' : 'default'
            const isHovered = hoveredZoneId === zone.id
            return (
              <BetCell
                key={zone.id}
                zone={zone}
                className={`bet-cell--${zone.skin ?? 'default'} bet-cell--state-${visual}`}
                style={{
                  ...pxRect(
                    zone.rect.x - runtimeOriginX,
                    zone.rect.y - runtimeOriginY,
                    zone.rect.w,
                    zone.rect.h,
                    runtimeFrameWidth,
                    runtimeFrameHeight,
                  ),
                  background: 'transparent',
                }}
                isHovered={isHovered}
                hideOverlayContent={useMobileAtlasRendering}
                onHoverChange={(next) => setHoveredZoneId(next ? zone.id : null)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
