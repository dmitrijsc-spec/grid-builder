import {
  DOUBLE_VALUES,
  SINGLE_VALUES,
  SPECIFIC_TRIPLES,
  TOTAL_VALUES,
  doubleId,
  sideDoubleId,
  mockOddsLabel,
  singleId,
  totalId,
  tripleId,
} from '../../../game/betZones'
import type { BetZoneId } from '../../../game/types'

export interface GridZoneRect {
  x: number
  y: number
  w: number
  h: number
}

export interface GridZoneStateStyle {
  border?: string
  background?: string
  text?: string
  label?: string
}

export interface GridZoneConfig {
  id: BetZoneId
  label: string
  sub?: string
  skin?: string
  rect: GridZoneRect
  hover?: GridZoneStateStyle
}

export function buildGridZones(baseWidth: number, mainOffsetY: number): GridZoneConfig[] {
  const mainX = (baseWidth - 346) / 2

  const base: GridZoneConfig[] = [
    {
      id: 'small',
      label: 'SMALL',
      sub: '4-10 • 1:1',
      skin: 'small',
      rect: { x: mainX + 4, y: mainOffsetY + 14, w: 111, h: 78 },
      hover: {
        border: 'rgba(115, 198, 255, 0.96)',
        background: 'rgba(69, 143, 232, 0.22)',
        text: '#d7ecff',
      },
    },
    {
      id: 'any_triple',
      label: 'ANY TRIPLE',
      sub: '34:1',
      skin: 'triple',
      rect: { x: mainX + 113, y: mainOffsetY + 14, w: 120, h: 78 },
      hover: {
        border: 'rgba(128, 227, 104, 0.96)',
        background: 'rgba(76, 170, 61, 0.22)',
        text: '#e0ffcf',
        label: 'ANY TRIPLE • HOT',
      },
    },
    {
      id: 'big',
      label: 'BIG',
      sub: '11-17 • 1:1',
      skin: 'big',
      rect: { x: mainX + 231, y: mainOffsetY + 14, w: 111, h: 78 },
      hover: {
        border: 'rgba(255, 141, 141, 0.96)',
        background: 'rgba(210, 68, 68, 0.24)',
        text: '#ffe0e0',
      },
    },
    {
      id: 'odd',
      label: 'ODD',
      sub: '1:1',
      skin: 'oddEven',
      rect: { x: mainX + 113, y: mainOffsetY + 92, w: 60, h: 30 },
    },
    {
      id: 'even',
      label: 'EVEN',
      sub: '1:1',
      skin: 'oddEven',
      rect: { x: mainX + 173, y: mainOffsetY + 92, w: 60, h: 30 },
    },
  ]

  const triplesLeft = SPECIFIC_TRIPLES.slice(0, 3).map((v, i) => ({
    id: tripleId(v),
    label: `${v}`,
    sub: '150:1',
    skin: 'specific',
    rect: { x: 10 + i * 46.8, y: 18, w: 42, h: 28 },
  }))

  const triplesRight = SPECIFIC_TRIPLES.slice(3).map((v, i) => ({
    id: tripleId(v),
    label: `${v}`,
    sub: '150:1',
    skin: 'specific',
    rect: { x: 520 + i * 46.8, y: 18, w: 42, h: 28 },
  }))

  const sideDoublesLeft = DOUBLE_VALUES.slice(0, 3).map((n, i) => ({
    id: sideDoubleId(n),
    label: `${n}${n}`,
    sub: '10:1',
    skin: 'specific',
    rect: { x: 10 + i * 46.8, y: 48, w: 42, h: 28 },
    hover: {
      border: 'rgba(255, 190, 102, 0.95)',
      background: 'rgba(218, 153, 54, 0.18)',
      text: '#ffe6bc',
    },
  }))

  const sideDoublesRight = DOUBLE_VALUES.slice(3).map((n, i) => ({
    id: sideDoubleId(n),
    label: `${n}${n}`,
    sub: '10:1',
    skin: 'specific',
    rect: { x: 520 + i * 46.8, y: 48, w: 42, h: 28 },
    hover: {
      border: 'rgba(255, 190, 102, 0.95)',
      background: 'rgba(218, 153, 54, 0.18)',
      text: '#ffe6bc',
    },
  }))

  const totals = TOTAL_VALUES.map((n, i) => ({
    id: totalId(n),
    label: String(n),
    sub: mockOddsLabel(n),
    skin: 'total',
    rect: { x: 5 + i * 46.7857, y: 90, w: 46.7857, h: 40 },
  }))

  const doubles = DOUBLE_VALUES.map((n, i) => ({
    id: doubleId(n),
    label: `${n}${n}`,
    sub: '12:1',
    skin: 'double',
    rect: { x: 18 + i * 108, y: 135, w: 88, h: 40 },
  }))

  const singles = SINGLE_VALUES.map((n, i) => ({
    id: singleId(n),
    label: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'][n - 1],
    skin: 'single',
    rect: { x: 5 + i * 109.167, y: 180, w: 109.167, h: 36 },
  }))

  return [
    ...base,
    ...triplesLeft,
    ...triplesRight,
    ...sideDoublesLeft,
    ...sideDoublesRight,
    ...totals,
    ...doubles,
    ...singles,
  ]
}

