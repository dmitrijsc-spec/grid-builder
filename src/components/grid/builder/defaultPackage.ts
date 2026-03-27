import { GRID_SKIN } from '../config/gridSkin'
import { buildGridZones } from '../config/gridZones'
import type { GridLayer, GridPackage, GridVisualState } from './types'

const DEFAULT_STATE_STYLES: Record<
  GridVisualState,
  { visible: boolean; opacity: number }
> = {
  default: { visible: true, opacity: 1 },
  hover: { visible: true, opacity: 1 },
  active: { visible: true, opacity: 1 },
  chipPlaced: { visible: true, opacity: 1 },
  disabled: { visible: true, opacity: 0.9 },
  locked: { visible: true, opacity: 1 },
}

function makeLayer(partial: Omit<GridLayer, 'stateStyles'>): GridLayer {
  return {
    ...partial,
    stateStyles: {
      default: { ...DEFAULT_STATE_STYLES.default },
      hover: { ...DEFAULT_STATE_STYLES.hover },
      active: { ...DEFAULT_STATE_STYLES.active },
      chipPlaced: { ...DEFAULT_STATE_STYLES.chipPlaced },
      disabled: { ...DEFAULT_STATE_STYLES.disabled },
      locked: { ...DEFAULT_STATE_STYLES.locked },
    },
    animation: partial.animation ?? {
      preset: 'none',
      durationMs: 220,
      delayMs: 0,
      easing: 'ease-out',
      intensity: 1,
    },
  }
}

export function createDefaultGridPackage(): GridPackage {
  return {
    version: 1,
    meta: {
      name: 'SicBo Grid',
      updatedAt: new Date().toISOString(),
    },
    frame: {
      width: GRID_SKIN.baseWidth,
      height: GRID_SKIN.baseHeight,
      scale: GRID_SKIN.scale,
    },
    global: {
      closedMode: 'tilted',
      tiltAngleDeg: 56,
      clipRect: {
        x: 0,
        y: 0,
        width: GRID_SKIN.baseWidth,
        height: GRID_SKIN.baseHeight,
      },
    },
    components: [],
    layers: [
      makeLayer({
        id: 'base-grid',
        name: 'Betting Grid',
        src: GRID_SKIN.baseAsset,
        x: 0,
        y: 0,
        width: GRID_SKIN.baseWidth,
        height: GRID_SKIN.baseHeight,
        zIndex: 1,
      }),
      makeLayer({
        id: 'main-grid',
        name: 'Main Betting Grid',
        src: GRID_SKIN.mainAsset,
        x: (GRID_SKIN.baseWidth - GRID_SKIN.mainWidth) / 2,
        y: GRID_SKIN.mainOffsetY,
        width: GRID_SKIN.mainWidth,
        height: GRID_SKIN.mainHeight,
        zIndex: 2,
      }),
    ],
    zones: buildGridZones(GRID_SKIN.baseWidth, GRID_SKIN.mainOffsetY),
    stateColors: {
      hover: 'rgba(255, 233, 152, 0.20)',
      active: 'rgba(108, 216, 116, 0.24)',
      chipPlaced: 'rgba(88, 210, 120, 0.30)',
      disabled: 'rgba(90, 90, 90, 0.2)',
      locked: 'rgba(240, 94, 94, 0.2)',
    },
  }
}

export function createEmptyGridPackage(): GridPackage {
  return {
    version: 1,
    meta: {
      name: 'New Grid Project',
      updatedAt: new Date().toISOString(),
    },
    frame: {
      width: GRID_SKIN.baseWidth,
      height: GRID_SKIN.baseHeight,
      scale: GRID_SKIN.scale,
    },
    global: {
      closedMode: 'tilted',
      tiltAngleDeg: 56,
      clipRect: {
        x: 0,
        y: 0,
        width: GRID_SKIN.baseWidth,
        height: GRID_SKIN.baseHeight,
      },
    },
    components: [],
    layers: [],
    zones: [],
    stateColors: {
      hover: 'rgba(255, 233, 152, 0.20)',
      active: 'rgba(108, 216, 116, 0.24)',
      chipPlaced: 'rgba(88, 210, 120, 0.30)',
      disabled: 'rgba(90, 90, 90, 0.2)',
      locked: 'rgba(240, 94, 94, 0.2)',
    },
  }
}

