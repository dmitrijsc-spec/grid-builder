import type { CSSProperties } from 'react'
import type { GridGameViewState, GridLayerAnimation, GridPackage, GridVisualState } from './types'
export function animationStyleFromPreset(
  animation: GridLayerAnimation,
  activeFactor: number,
  options?: { withTransition?: boolean },
): CSSProperties {
  if (animation.preset === 'none') return {}
  const intensity = Math.max(0, Math.min(3, animation.intensity ?? 1))
  let transform = ''
  let extraOpacity: number | undefined

  if (animation.preset === 'fade') {
    extraOpacity = activeFactor === 0 ? 1 : Math.max(0.1, 1 - 0.35 * intensity)
  } else if (animation.preset === 'zoom-in') {
    transform = `scale(${1 + 0.06 * intensity * activeFactor})`
  } else if (animation.preset === 'zoom-out') {
    transform = `scale(${1 - 0.06 * intensity * activeFactor})`
  } else if (animation.preset === 'from-left') {
    transform = `translateX(${8 * intensity * activeFactor}px)`
  } else if (animation.preset === 'from-top') {
    transform = `translateY(${-8 * intensity * activeFactor}px)`
  }

  const useTransition = options?.withTransition !== false
  return {
    transform,
    ...(useTransition
      ? {
          transition: `transform ${animation.durationMs}ms ${animation.easing} ${animation.delayMs}ms, opacity ${animation.durationMs}ms ${animation.easing} ${animation.delayMs}ms`,
        }
      : { transition: 'none' }),
    opacity: extraOpacity,
    transformOrigin: 'center center',
    willChange: 'transform, opacity',
  }
}

export function gridScopeActiveFactor(
  gridState: GridGameViewState,
  toGridState: GridGameViewState | 'any' | undefined,
): number {
  const to = toGridState ?? 'any'
  if (to === 'any') {
    return gridState === 'closed' ? 1 : 0
  }
  return gridState === to ? 1 : 0
}

export function layerAnimationStyle(
  layer: GridPackage['layers'][number],
  prevElementState: GridVisualState,
  elementState: GridVisualState,
  prevGridState: GridGameViewState,
  gridState: GridGameViewState,
): CSSProperties {
  const animation = layer.animation ?? {
    scope: 'element-state',
    preset: 'none',
    trigger: 'while-active',
    fromState: 'any',
    toState: 'any',
    fromGridState: 'any',
    toGridState: 'any',
    durationMs: 220,
    delayMs: 0,
    easing: 'ease-out',
    intensity: 1,
  }
  if (animation.preset === 'none') return {}

  const scope = animation.scope === 'grid-state' ? 'grid-state' : 'element-state'

  if (scope === 'grid-state') {
    const fromG = animation.fromGridState ?? 'any'
    const toG = animation.toGridState ?? 'any'
    const fromMatches = fromG === 'any' || fromG === prevGridState
    const toMatches = toG === 'any' || toG === gridState
    const transitionChanged = prevGridState !== gridState
    if (!toMatches) return {}
    if (animation.trigger === 'on-transition' && (!transitionChanged || !fromMatches)) return {}

    const activeFactor = gridScopeActiveFactor(gridState, toG)
    return animationStyleFromPreset(animation, activeFactor)
  }

  const fromMatches = animation.fromState === 'any' || animation.fromState === prevElementState
  const toMatches = animation.toState === 'any' || animation.toState === elementState
  const transitionChanged = prevElementState !== elementState

  if (!toMatches) return {}
  if (animation.trigger === 'on-transition' && (!transitionChanged || !fromMatches)) return {}

  const activeFactor = elementState === 'default' ? 0 : 1
  return animationStyleFromPreset(animation, activeFactor)
}

/** Builder preview: concrete endpoints when From/To are "any". */
export function resolvePreviewElementEndpoints(anim: GridLayerAnimation): {
  from: GridVisualState
  to: GridVisualState
} {
  const from = anim.fromState === 'any' ? 'default' : anim.fromState
  let to = anim.toState === 'any' ? 'hover' : anim.toState
  if (from === to) {
    to = from === 'default' ? 'hover' : 'default'
  }
  return { from, to }
}

export function resolvePreviewGridEndpoints(anim: GridLayerAnimation): {
  from: GridGameViewState
  to: GridGameViewState
} {
  const rawFrom = anim.fromGridState ?? 'any'
  const rawTo = anim.toGridState ?? 'any'
  const from: GridGameViewState = rawFrom === 'any' ? 'open' : rawFrom
  let to: GridGameViewState = rawTo === 'any' ? 'closed' : rawTo
  if (from === to) {
    to = from === 'open' ? 'closed' : 'open'
  }
  return { from, to }
}

/** Single preview frame: element + grid context for scoped animation. */
export function builderPreviewFrameStyle(
  anim: GridLayerAnimation,
  scope: 'element-state' | 'grid-state',
  elementState: GridVisualState,
  gridState: GridGameViewState,
  snap: boolean,
): CSSProperties {
  if (anim.preset === 'none') return {}
  if (scope === 'grid-state') {
    const factor = gridScopeActiveFactor(gridState, anim.toGridState)
    return animationStyleFromPreset(anim, factor, { withTransition: !snap })
  }
  const factor = elementState === 'default' ? 0 : 1
  return animationStyleFromPreset(anim, factor, { withTransition: !snap })
}
