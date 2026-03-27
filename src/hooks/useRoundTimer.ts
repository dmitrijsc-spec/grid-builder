import { useEffect } from 'react'
import { useGameDispatch, useGameState } from '../game/GameContext'

/** Мок: таймер тикает раз в секунду в фазе betting. */
export function useRoundTimer(): void {
  const { phase, countdownSec } = useGameState()
  const dispatch = useGameDispatch()

  useEffect(() => {
    if (phase !== 'betting' || countdownSec <= 0) return
    const id = window.setInterval(() => {
      dispatch({ type: 'TICK' })
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase, countdownSec, dispatch])
}
