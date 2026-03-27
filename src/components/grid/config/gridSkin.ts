export interface GridSkinConfig {
  baseWidth: number
  baseHeight: number
  scale: number
  baseAsset: string
  mainAsset: string
  mainWidth: number
  mainHeight: number
  mainOffsetY: number
}

export const GRID_SKIN: GridSkinConfig = {
  baseWidth: 665,
  baseHeight: 221,
  scale: 1.3,
  baseAsset: '/Betting%20Grid.svg',
  mainAsset: '/Main%20Betting%20Grid.svg',
  mainWidth: 346,
  mainHeight: 126,
  mainOffsetY: -20,
}

