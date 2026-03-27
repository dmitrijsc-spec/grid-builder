import { initialGameState } from './defaults'
import type { BetZoneId, ChipValue, GamePhase, GameState } from './types'

export type GameAction =
  | { type: 'SET_PHASE'; phase: GamePhase }
  | { type: 'SET_COUNTDOWN'; sec: number }
  | { type: 'TICK' }
  | { type: 'SET_SELECTED_CHIP'; value: ChipValue }
  | { type: 'PLACE_BET'; zoneId: BetZoneId }
  | { type: 'CLEAR_BETS' }
  | { type: 'UNDO_LAST' }
  | { type: 'RESET_ROUND' }

function recomputeTotal(bets: GameState['bets']): number {
  return Object.values(bets).reduce((a, v) => a + (v ?? 0), 0)
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, phase: action.phase }
    case 'SET_COUNTDOWN':
      return { ...state, countdownSec: Math.max(0, action.sec) }
    case 'TICK': {
      if (state.phase !== 'betting' || state.countdownSec <= 0) return state
      const next = Math.max(0, state.countdownSec - 1)
      if (next === 0) {
        return { ...state, countdownSec: 0, phase: 'bets_closed' }
      }
      return { ...state, countdownSec: next }
    }
    case 'SET_SELECTED_CHIP':
      return { ...state, selectedChip: action.value }
    case 'PLACE_BET': {
      if (state.phase !== 'betting') return state
      const add = state.selectedChip
      const prev = state.bets[action.zoneId] ?? 0
      const nextBets = { ...state.bets, [action.zoneId]: prev + add }
      const total = recomputeTotal(nextBets)
      if (total > state.balance) return state
      const betStack = [...state.betStack, { zoneId: action.zoneId, amount: add }]
      return {
        ...state,
        bets: nextBets,
        totalBet: total,
        betStack,
      }
    }
    case 'CLEAR_BETS': {
      return { ...state, bets: {}, totalBet: 0, betStack: [] }
    }
    case 'UNDO_LAST': {
      const last = state.betStack[state.betStack.length - 1]
      if (!last) return state
      const betStack = state.betStack.slice(0, -1)
      const prev = state.bets[last.zoneId] ?? 0
      const nextVal = prev - last.amount
      const nextBets = { ...state.bets }
      if (nextVal <= 0) delete nextBets[last.zoneId]
      else nextBets[last.zoneId] = nextVal
      return {
        ...state,
        bets: nextBets,
        totalBet: recomputeTotal(nextBets),
        betStack,
      }
    }
    case 'RESET_ROUND':
      return {
        ...initialGameState,
        balance: state.balance,
        gameId: state.gameId,
        limitsLabel: state.limitsLabel,
      }
    default:
      return state
  }
}
