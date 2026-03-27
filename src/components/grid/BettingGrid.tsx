import { useBettingOpen, useGame } from '../../game/GameContext'
import type { BetZoneId } from '../../game/types'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
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

function pxRect(x: number, y: number, w: number, h: number): CSSProperties {
  const gridWidth = GRID_SKIN.baseWidth
  const gridHeight = GRID_SKIN.baseHeight
  return {
    left: `${(x / gridWidth) * 100}%`,
    top: `${(y / gridHeight) * 100}%`,
    width: `${(w / gridWidth) * 100}%`,
    height: `${(h / gridHeight) * 100}%`,
  }
}

function zoneVisualState(
  zoneId: BetZoneId,
  hovered: BetZoneId | null,
  isOpen: boolean,
  hasBet: boolean,
): GridVisualState {
  if (!isOpen) return 'disabled'
  if (hovered === zoneId) return 'hover'
  if (hasBet) return 'chipPlaced'
  return 'default'
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
  state: GridVisualState,
): CSSProperties {
  const animation = layer.animation ?? {
    preset: 'none',
    durationMs: 220,
    delayMs: 0,
    easing: 'ease-out',
    intensity: 1,
  }
  if (animation.preset === 'none') return {}

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
  const { state } = useGame()
  const isClosed = state.phase !== 'betting'
  const globalGridState: 'open' | 'closed' = isClosed ? 'closed' : 'open'
  const bettingOpen = useBettingOpen()
  const [hoveredZoneId, setHoveredZoneId] = useState<BetZoneId | null>(null)
  const [gridPackage, setGridPackage] = useState<GridPackage>(() => {
    return loadGridPackage() ?? createDefaultGridPackage()
  })

  useEffect(() => {
    const reloadPackage = (event?: Event) => {
      const maybeCustom = event as CustomEvent<{ pkg?: GridPackage | null }> | undefined
      const pkgFromEvent = maybeCustom?.detail?.pkg
      if (pkgFromEvent && pkgFromEvent.version === 1) {
        setGridPackage(normalizeGridPackage(structuredClone(pkgFromEvent)))
        return
      }
      setGridPackage(loadGridPackage() ?? createDefaultGridPackage())
    }

    // Only respond to explicit publish events (Update Game button) — NOT storage changes
    window.addEventListener(GRID_PACKAGE_EVENT, reloadPackage as EventListener)
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(GRID_PACKAGE_BROADCAST_CHANNEL)
        : null
    const onChannelMessage = (message: MessageEvent<{ pkg?: GridPackage | null }>) => {
      const pkgFromMessage = message.data?.pkg
      if (pkgFromMessage && pkgFromMessage.version === 1) {
        setGridPackage(normalizeGridPackage(structuredClone(pkgFromMessage)))
      }
    }
    channel?.addEventListener('message', onChannelMessage)
    return () => {
      window.removeEventListener(GRID_PACKAGE_EVENT, reloadPackage as EventListener)
      channel?.removeEventListener('message', onChannelMessage)
      channel?.close()
    }
  }, [])
  const frameWidth = gridPackage.frame.width > 0 ? gridPackage.frame.width : GRID_SKIN.baseWidth
  const frameHeight = gridPackage.frame.height > 0 ? gridPackage.frame.height : GRID_SKIN.baseHeight

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
    [gridPackage.layers, globalGridState],
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

          const hasBet = layer.zoneId ? (state.bets[layer.zoneId] ?? 0) > 0 : false
          const activeState: GridVisualState = layer.zoneId
            ? (globalGridState === 'closed'
                ? (hasBet ? 'chipPlaced' : 'default')
                : zoneVisualState(layer.zoneId, hoveredZoneId, bettingOpen, hasBet))
            : 'default'
          const visual = resolveLayerVisual(
            gridPackage,
            layer,
            activeState,
          )
          const animationStyle = layerAnimationStyle(layer, activeState)
          const animationOpacity = animationStyle.opacity as number | undefined
          if (!visual.visible) return null
          return {
            id: layer.id,
            name: layer.name,
            src: visual.src,
            style: {
              left: `${(visual.rect.x / frameWidth) * 100}%`,
              top: `${(visual.rect.y / frameHeight) * 100}%`,
              width: `${(visual.rect.width / frameWidth) * 100}%`,
              height: `${(visual.rect.height / frameHeight) * 100}%`,
              ...animationStyle,
              opacity:
                animationOpacity === undefined
                  ? visual.opacity
                  : visual.opacity * animationOpacity,
              zIndex: layer.zIndex,
            } as CSSProperties,
          }
        })
        .filter((item): item is { id: string; name: string; src: string; style: CSSProperties } => item !== null),
    [gridPackage, globalGridState, state.bets, hoveredZoneId, bettingOpen],
  )
  const perspective = isClosed && (gridPackage.global?.closedMode ?? 'tilted') === 'tilted'
  const runtimeScale =
    typeof gridPackage.frame?.scale === 'number' && gridPackage.frame.scale > 0
      ? gridPackage.frame.scale
      : GRID_SKIN.scale
  const runtimeWidthPx = frameWidth * runtimeScale
  const clipRect = gridPackage.global.clipRect ?? {
    x: 0,
    y: 0,
    width: frameWidth,
    height: frameHeight,
  }
  const clipTopPct = (clipRect.y / frameHeight) * 100
  const clipRightPct = ((frameWidth - (clipRect.x + clipRect.width)) / frameWidth) * 100
  const clipBottomPct = ((frameHeight - (clipRect.y + clipRect.height)) / frameHeight) * 100
  const clipLeftPct = (clipRect.x / frameWidth) * 100

  return (
    <div
      className="betting-grid-shell"
      data-perspective={perspective ? 'on' : 'off'}
      style={
        {
          '--grid-tilt-angle': `${gridPackage.global?.tiltAngleDeg ?? 56}deg`,
          width: `min(100%, ${runtimeWidthPx}px)`,
        } as CSSProperties
      }
    >
      <div
        className="betting-grid"
        style={{
          width: `min(100%, ${runtimeWidthPx}px)`,
          aspectRatio: `${frameWidth} / ${frameHeight}`,
          height: 'auto',
          minHeight: 0,
          clipPath: `inset(${clipTopPct}% ${clipRightPct}% ${clipBottomPct}% ${clipLeftPct}%)`,
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
            const hasBet = (state.bets[zone.id] ?? 0) > 0
            const visual = zoneVisualState(zone.id, hoveredZoneId, bettingOpen, hasBet)
            const isHovered = hoveredZoneId === zone.id
            return (
              <BetCell
                key={zone.id}
                zone={zone}
                className={`bet-cell--${zone.skin ?? 'default'} bet-cell--state-${visual}`}
                style={{
                  ...pxRect(zone.rect.x, zone.rect.y, zone.rect.w, zone.rect.h),
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
