import type { GameState } from './types'

/**
 * Визуальное состояние подсветки геймфрейма (не путать с GamePhase).
 * - open — ставки открыты (зелёный)
 * - closing — последние секунды до закрытия (оранжевый)
 * - ended — ставки закрыты (красный)
 * - active — активная игра: бросок / результат (золотистый)
 */
export type FrameVisualState = 'open' | 'closing' | 'ended' | 'active'

/** Секунд «оранжевой» фазы перед закрытием. */
export const FRAME_CLOSING_LAST_SEC = 3

export function getFrameVisualState(state: GameState): FrameVisualState {
  if (state.phase === 'rolling' || state.phase === 'result') return 'active'
  if (state.phase === 'bets_closed') return 'ended'
  if (state.phase === 'betting') {
    if (
      state.countdownSec > 0 &&
      state.countdownSec <= FRAME_CLOSING_LAST_SEC
    ) {
      return 'closing'
    }
    return 'open'
  }
  return 'open'
}
