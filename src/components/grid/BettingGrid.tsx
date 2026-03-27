import { useBettingOpen, useGame } from '../../game/GameContext'
import type { BetZoneId } from '../../game/types'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { createDefaultGridPackage } from './builder/defaultPackage'
import {
  GRID_PACKAGE_BROADCAST_CHANNEL,
  GRID_PACKAGE_EVENT,
  loadGridPackage,
  normalizeGridPackage,
} from './builder/storage'
import type { GridPackage, GridVisualState } from './builder/types'
import { GRID_SKIN } from './config/gridSkin'
import type { GridZoneConfig } from './config/gridZones'

function BetCell({
  zone,
  className = '',
  style,
  isHovered,
  onHoverChange,
}: {
  zone: GridZoneConfig
  className?: string
  style?: CSSProperties
  isHovered: boolean
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
      <span className="bet-cell__label">{zone.label}</span>
      {zone.sub ? <span className="bet-cell__sub">{zone.sub}</span> : null}
      {amount > 0 ? (
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

function layerAnimationStyle(
  layer: GridPackage['layers'][number],
  prevState: GridVisualState,
  state: GridVisualState,
): CSSProperties {
  const animation = layer.animation ?? {
    preset: 'none',
    trigger: 'while-active',
    fromState: 'any',
    toState: 'any',
    durationMs: 220,
    delayMs: 0,
    easing: 'ease-out',
    intensity: 1,
  }
  if (animation.preset === 'none') return {}

  const fromMatches = animation.fromState === 'any' || animation.fromState === prevState
  const toMatches = animation.toState === 'any' || animation.toState === state
  const transitionChanged = prevState !== state

  if (!toMatches) return {}
  if (animation.trigger === 'on-transition' && (!transitionChanged || !fromMatches)) return {}

  const activeFactor = state === 'default' ? 0 : 1
  const intensity = Math.max(0, Math.min(3, animation.intensity ?? 1))
  let transform = ''
  let extraOpacity: number | undefined

  if (animation.preset === 'fade') {
    extraOpacity = state === 'default' ? 1 : Math.max(0.1, 1 - 0.35 * intensity)
  } else if (animation.preset === 'zoom-in') {
    transform = `scale(${1 + 0.06 * intensity * activeFactor})`
  } else if (animation.preset === 'zoom-out') {
    transform = `scale(${1 - 0.06 * intensity * activeFactor})`
  } else if (animation.preset === 'from-left') {
    transform = `translateX(${8 * intensity * activeFactor}px)`
  } else if (animation.preset === 'from-top') {
    transform = `translateY(${-8 * intensity * activeFactor}px)`
  }

  return {
    transform,
    transition: `transform ${animation.durationMs}ms ${animation.easing} ${animation.delayMs}ms, opacity ${animation.durationMs}ms ${animation.easing} ${animation.delayMs}ms`,
    opacity: extraOpacity,
    transformOrigin: 'center center',
    willChange: 'transform, opacity',
  }
}

export function BettingGrid() {
  const detectViewportMode = (): 'desktop' | 'mobile' => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop'
    return window.matchMedia('(max-width: 600px)').matches ? 'mobile' : 'desktop'
  }

  const { state } = useGame()
  const isClosed = state.phase !== 'betting'
  const globalGridState: 'open' | 'closed' =
    state.gridViewState === 'auto'
      ? (isClosed ? 'closed' : 'open')
      : state.gridViewState
  const [runtimeDeviceMode, setRuntimeDeviceMode] = useState<'desktop' | 'mobile'>(() => detectViewportMode())
  const [hoveredZoneId, setHoveredZoneId] = useState<BetZoneId | null>(null)
  const previousLayerStateRef = useRef<Record<string, GridVisualState>>({})
  const latestPublishedPackagesRef = useRef<{
    desktop: GridPackage | null
    mobile: GridPackage | null
  }>({ desktop: null, mobile: null })
  const hadLocalPackageRef = useRef(false)
  const [gridPackage, setGridPackage] = useState<GridPackage>(() => {
    const local = loadGridPackage(detectViewportMode())
    if (local) hadLocalPackageRef.current = true
    return local ?? createDefaultGridPackage()
  })

  const publishedGridCloud = useQuery(api.grids.getPublishedRuntimeGrid)
  const cloudAppliedRef = useRef(false)
  useEffect(() => {
    if (hadLocalPackageRef.current || cloudAppliedRef.current) return
    if (!publishedGridCloud?.data) return
    try {
      const parsed = JSON.parse(publishedGridCloud.data) as {
        version: number
        desktopPkg: GridPackage | null
        mobilePkg: GridPackage | null
      }
      if (parsed?.version !== 1) return
      if (parsed.desktopPkg) {
        latestPublishedPackagesRef.current.desktop = normalizeGridPackage(parsed.desktopPkg)
      }
      if (parsed.mobilePkg) {
        latestPublishedPackagesRef.current.mobile = normalizeGridPackage(parsed.mobilePkg)
      }
      const selected =
        runtimeDeviceMode === 'mobile'
          ? parsed.mobilePkg
          : parsed.desktopPkg
      if (selected?.version === 1) {
        cloudAppliedRef.current = true
        setGridPackage(normalizeGridPackage(selected))
      }
    } catch { /* cloud data corrupted — stay on default */ }
  }, [publishedGridCloud, runtimeDeviceMode])

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
      const fallbackPkg = mode === 'mobile' ? null : (detail?.pkg ?? null)
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
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 600px)')
    const onViewportModeChange = () => {
      setRuntimeDeviceMode(detectViewportMode())
    }
    media.addEventListener('change', onViewportModeChange)
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
      media.removeEventListener('change', onViewportModeChange)
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
  const isMobileRuntime = runtimeDeviceMode === 'mobile'
  const runtimeFrameWidth = frameWidth
  const runtimeFrameHeight = frameHeight

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
  const renderLayers = useMemo(
    () =>
      gridPackage.layers
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((layer) => {
          // Respect globalVisibility — mirrors the builder's "Show when Open/Closed" checkboxes
          const globalVisible =
            globalGridState === 'open'
              ? (layer.globalVisibility?.open ?? true)
              : (layer.globalVisibility?.closed ?? true)
          if (!globalVisible) return null

          const activeState: GridVisualState = layer.zoneId
            ? (globalGridState === 'open' && hoveredZoneId === layer.zoneId ? 'hover' : 'default')
            : 'default'
          const visual = resolveLayerVisual(
            gridPackage,
            layer,
            activeState,
          )
          const previousState = previousLayerStateRef.current[layer.id] ?? activeState
          const animationStyle = layerAnimationStyle(layer, previousState, activeState)
          const animationOpacity = animationStyle.opacity as number | undefined
          if (!visual.visible) return null
          return {
            id: layer.id,
            name: layer.name,
            activeState,
            src: visual.src,
            style: {
              left: `${(visual.rect.x / runtimeFrameWidth) * 100}%`,
              top: `${(visual.rect.y / runtimeFrameHeight) * 100}%`,
              width: `${(visual.rect.width / runtimeFrameWidth) * 100}%`,
              height: `${(visual.rect.height / runtimeFrameHeight) * 100}%`,
              ...animationStyle,
              opacity:
                animationOpacity === undefined
                  ? visual.opacity
                  : visual.opacity * animationOpacity,
              zIndex: layer.zIndex,
            } as CSSProperties,
          }
        })
        .filter((item): item is { id: string; name: string; activeState: 'default' | 'hover'; src: string; style: CSSProperties } => item !== null),
    [
      gridPackage,
      globalGridState,
      state.bets,
      hoveredZoneId,
      runtimeFrameWidth,
      runtimeFrameHeight,
    ],
  )

  useEffect(() => {
    const next: Record<string, GridVisualState> = {}
    for (const layer of renderLayers) next[layer.id] = layer.activeState
    previousLayerStateRef.current = next
  }, [renderLayers])
  const perspective = isClosed && (gridPackage.global?.closedMode ?? 'tilted') === 'tilted'
  const runtimeScale =
    typeof gridPackage.frame?.scale === 'number' && gridPackage.frame.scale > 0
      ? gridPackage.frame.scale
      : GRID_SKIN.scale
  const runtimeWidthPx = runtimeFrameWidth * runtimeScale
  const runtimeWidthStyle = isMobileRuntime ? '100%' : `min(100%, ${runtimeWidthPx}px)`
  const clipRect = gridPackage.global.clipRect ?? {
    x: 0,
    y: 0,
    width: runtimeFrameWidth,
    height: runtimeFrameHeight,
  }
  const clipTopPct = (clipRect.y / runtimeFrameHeight) * 100
  const clipRightPct = ((runtimeFrameWidth - (clipRect.x + clipRect.width)) / runtimeFrameWidth) * 100
  const clipBottomPct = ((runtimeFrameHeight - (clipRect.y + clipRect.height)) / runtimeFrameHeight) * 100
  const clipLeftPct = (clipRect.x / runtimeFrameWidth) * 100
  const runtimeClipPath = perspective && !isMobileRuntime
    ? `inset(${clipTopPct}% ${clipRightPct}% ${clipBottomPct}% ${clipLeftPct}%)`
    : 'none'

  const baseTiltAngle = gridPackage.global?.tiltAngleDeg ?? 56
  // Mobile keeps the tilt feature, but with a slightly softer angle and no extra downscale.
  // This reduces GPU raster blur while preserving the closed-state perspective effect.
  const tiltAngleDeg = runtimeDeviceMode === 'mobile' ? Math.min(baseTiltAngle, 48) : baseTiltAngle
  const tiltScale = runtimeDeviceMode === 'mobile' ? 1 : 0.97

  return (
    <div
      className="betting-grid-shell"
      data-perspective={perspective ? 'on' : 'off'}
      style={
        {
          '--grid-tilt-angle': `${tiltAngleDeg}deg`,
          '--grid-tilt-scale': `${tiltScale}`,
          width: runtimeWidthStyle,
        } as CSSProperties
      }
    >
      <div
        className="betting-grid"
        style={{
          width: runtimeWidthStyle,
          aspectRatio: `${runtimeFrameWidth} / ${runtimeFrameHeight}`,
          height: 'auto',
          minHeight: 0,
          clipPath: runtimeClipPath,
        }}
      >
        <div className="betting-grid__asset-layer" aria-hidden>
          {renderLayers.map((layer) => (
            <img
              key={layer.id}
              className="betting-grid__asset"
              src={layer.src}
              alt={layer.name}
              style={layer.style}
            />
          ))}
        </div>
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
                    zone.rect.x,
                    zone.rect.y,
                    zone.rect.w,
                    zone.rect.h,
                    runtimeFrameWidth,
                    runtimeFrameHeight,
                  ),
                  background: 'transparent',
                }}
                isHovered={isHovered}
                onHoverChange={(next) => setHoveredZoneId(next ? zone.id : null)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
