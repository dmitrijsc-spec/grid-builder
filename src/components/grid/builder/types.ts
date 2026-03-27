import type { BetZoneId } from '../../../game/types'
import type { GridZoneConfig } from '../config/gridZones'

export type GridVisualState = 'default' | 'hover' | 'active' | 'chipPlaced' | 'disabled' | 'locked'
export type GridClosedMode = 'tilted' | 'flat'
export type GridLayerAnimationPreset =
  | 'none'
  | 'fade'
  | 'zoom-in'
  | 'zoom-out'
  | 'from-left'
  | 'from-top'
export type GridLayerAnimationEasing = 'ease' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface GridLayerStateStyle {
  visible: boolean
  opacity: number
}

export interface GridLayerAnimation {
  preset: GridLayerAnimationPreset
  durationMs: number
  delayMs: number
  easing: GridLayerAnimationEasing
  intensity: number
}

export interface GridLayer {
  id: string
  name: string
  locked?: boolean
  src: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  stateStyles: Record<GridVisualState, GridLayerStateStyle>
  animation?: GridLayerAnimation
  globalVisibility?: {
    open: boolean
    closed: boolean
  }
  zoneId?: BetZoneId
  enabledStates?: GridVisualState[]
  stateSvgs?: Partial<Record<GridVisualState, string>>
  stateRects?: Partial<
    Record<
      GridVisualState,
      {
        x: number
        y: number
        width: number
        height: number
      }
    >
  >
  componentId?: string
  variantId?: string
}

export interface GridComponentVariant {
  id: string
  name: string
  src: string
  stateStyles: Record<GridVisualState, GridLayerStateStyle>
}

export interface GridComponent {
  id: string
  name: string
  variants: GridComponentVariant[]
}

export interface GridPackage {
  version: 1
  meta: {
    name: string
    updatedAt: string
  }
  frame: {
    width: number
    height: number
    scale: number
  }
  global: {
    closedMode: GridClosedMode
    tiltAngleDeg: number
    clipRect: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  components: GridComponent[]
  layers: GridLayer[]
  zones: GridZoneConfig[]
  stateColors: Partial<Record<GridVisualState, string>>
}

export interface GridProject {
  id: string
  name: string
  updatedAt: string
  pkg: GridPackage
}

export interface GridProjectsState {
  version: 1
  activeProjectId: string
  projects: GridProject[]
}

export type RuntimeStateByZone = Partial<Record<BetZoneId, GridVisualState>>

