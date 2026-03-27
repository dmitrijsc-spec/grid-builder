import type { ChipValue, GameState } from './types'

export const CHIP_VALUES = [1, 2, 5, 10, 25, 50, 100, 250] as const satisfies readonly ChipValue[]

export const initialGameState: GameState = {
  phase: 'betting',
  countdownSec: 5,
  balance: 25_492.43,
  totalBet: 0,
  selectedChip: 5,
  bets: {},
  betStack: [],
  roadmap: ['B', 'S', 'B', 'T', 'S', 'B', 'B', 'S'],
  gameId: 'SG-0001',
  limitsLabel: '$0.10 — $500',
}
