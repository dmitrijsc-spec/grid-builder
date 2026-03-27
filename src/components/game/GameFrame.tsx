import { getFrameVisualState } from '../../game/frameState'
import { useGameState } from '../../game/GameContext'
import type { ReactNode } from 'react'
import { DropletTimer } from './DropletTimer'
import { PerformanceOverlay } from './PerformanceOverlay'
import { RoundDevController } from './RoundDevController'
import { StreamBackground } from './StreamBackground'

export function GameFrame({ children }: { children: ReactNode }) {
  const state = useGameState()
  const frameState = getFrameVisualState(state)

  return (
    <div
      className="game-frame-shell"
      data-frame-state={frameState}
      role="presentation"
    >
      <div className="game-frame">
        <StreamBackground />
        <DropletTimer />
        <RoundDevController />
        <PerformanceOverlay />
        <div className="game-frame__content">{children}</div>
      </div>
    </div>
  )
}
