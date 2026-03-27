/** Фазы раунда — дальше сервер/WebSocket будет диктовать переходы. */
export type GamePhase = 'betting' | 'bets_closed' | 'rolling' | 'result'

export type ChipValue = 1 | 2 | 5 | 10 | 25 | 50 | 100 | 250

/** Идентификатор зоны ставки на гриде (расширяем по мере добавления типов ставок). */
export type BetZoneId =
  | 'small'
  | 'big'
  | 'any_triple'
  | 'odd'
  | 'even'
  | `total_${4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17}`
  | `double_${1 | 2 | 3 | 4 | 5 | 6}`
  | `side_double_${1 | 2 | 3 | 4 | 5 | 6}`
  | `single_${1 | 2 | 3 | 4 | 5 | 6}`
  | `triple_${111 | 222 | 333 | 444 | 555 | 666}`

export type BetMap = Partial<Record<BetZoneId, number>>

export interface PlacedBet {
  zoneId: BetZoneId
  amount: number
}

export interface GameState {
  phase: GamePhase
  /** Секунды до закрытия приёма (мок; потом с сервера). */
  countdownSec: number
  balance: number
  totalBet: number
  selectedChip: ChipValue
  bets: BetMap
  /** История для undo (порядок постановки). */
  betStack: PlacedBet[]
  /** Последние исходы для roadmap (мок). */
  roadmap: Array<'S' | 'B' | 'T'>
  gameId: string
  limitsLabel: string
}
