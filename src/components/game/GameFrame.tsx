import { getFrameVisualState } from '../../game/frameState'
import { useGameState } from '../../game/GameContext'
import { useState, type ReactNode } from 'react'
import { DropletTimer } from './DropletTimer'
import { PerformanceOverlay } from './PerformanceOverlay'
import { RoundDevController } from './RoundDevController'
import { StreamBackground, type StreamMode } from './StreamBackground'

export function GameFrame({ children }: { children: ReactNode }) {
  const state = useGameState()
  const frameState = getFrameVisualState(state)
  const [perfVisible, setPerfVisible] = useState(true)
  const [streamMode, setStreamMode] = useState<StreamMode>('image')

  return (
    <div
      className="game-frame-shell"
      data-frame-state={frameState}
      role="presentation"
    >
      <div className="game-frame">
        <StreamBackground mode={streamMode} />
        <DropletTimer />
        <RoundDevController
          perfVisible={perfVisible}
          onTogglePerfVisible={() => setPerfVisible((prev) => !prev)}
          streamMode={streamMode}
          onChangeStreamMode={setStreamMode}
        />
        <PerformanceOverlay visible={perfVisible} />
        {children}
      </div>
    </div>
  )
}
