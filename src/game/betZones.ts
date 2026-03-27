import type { BetZoneId } from './types'

export const TOTAL_VALUES = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
] as const

export function totalId(n: (typeof TOTAL_VALUES)[number]): BetZoneId {
  return `total_${n}`
}

export const SINGLE_VALUES = [1, 2, 3, 4, 5, 6] as const

export function singleId(n: (typeof SINGLE_VALUES)[number]): BetZoneId {
  return `single_${n}`
}

export const DOUBLE_VALUES = [1, 2, 3, 4, 5, 6] as const

export function doubleId(n: (typeof DOUBLE_VALUES)[number]): BetZoneId {
  return `double_${n}`
}

export function sideDoubleId(n: (typeof DOUBLE_VALUES)[number]): BetZoneId {
  return `side_double_${n}`
}

export const SPECIFIC_TRIPLES = [111, 222, 333, 444, 555, 666] as const

export function tripleId(n: (typeof SPECIFIC_TRIPLES)[number]): BetZoneId {
  return `triple_${n}`
}

/** Мок коэффициентов для отображения (не финансовая логика). */
export function mockOddsLabel(total: number): string {
  const map: Record<number, string> = {
    4: '50:1',
    5: '25:1',
    6: '12:1',
    7: '8:1',
    8: '6:1',
    9: '5:1',
    10: '5:1',
    11: '5:1',
    12: '6:1',
    13: '8:1',
    14: '12:1',
    15: '25:1',
    16: '25:1',
    17: '50:1',
  }
  return map[total] ?? ''
}
