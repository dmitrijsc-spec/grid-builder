/* Context + hooks в одном модуле — нормально для игрового состояния. */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { initialGameState } from './defaults'
import { gameReducer, type GameAction } from './gameReducer'
import type { GameState } from './types'

const GameDispatchContext = createContext<(a: GameAction) => void>(() => {})

const GameStateContext = createContext<GameState>(initialGameState)

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState)

  return (
    <GameStateContext.Provider value={state}>
      <GameDispatchContext.Provider value={dispatch}>
        {children}
      </GameDispatchContext.Provider>
    </GameStateContext.Provider>
  )
}

export function useGameState(): GameState {
  return useContext(GameStateContext)
}

export function useGameDispatch(): (a: GameAction) => void {
  return useContext(GameDispatchContext)
}

export function useGame() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  return useMemo(() => ({ state, dispatch }), [state, dispatch])
}

/** Удобные селекторы для фазы и «открыты ли ставки». */
export function useBettingOpen(): boolean {
  const { phase } = useGameState()
  return phase === 'betting'
}

export function useSetPhase() {
  const dispatch = useGameDispatch()
  return useCallback(
    (phase: GameState['phase']) => dispatch({ type: 'SET_PHASE', phase }),
    [dispatch],
  )
}
