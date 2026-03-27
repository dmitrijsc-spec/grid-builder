import { useGameState } from '../../game/GameContext'

export function DropletTimer() {
  const { phase, countdownSec } = useGameState()

  const showCountdown = phase === 'betting' && countdownSec > 0

  return (
    <div className="frame-timer" aria-live="polite">
      <div className="frame-timer__shape">
        {showCountdown ? (
          <span className="frame-timer__value">{countdownSec}</span>
        ) : (
          <span className="frame-timer__nm">NO MORE BETS</span>
        )}
      </div>
    </div>
  )
}
