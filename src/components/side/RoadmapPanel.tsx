import { useGameState } from '../../game/GameContext'

export function RoadmapPanel() {
  const { roadmap } = useGameState()

  return (
    <aside className="side-panel side-panel--left" aria-label="Roadmap">
      <div className="side-panel__head">Roadmap</div>
      <div className="roadmap-beads" role="list">
        {roadmap.map((cell, i) => (
          <span
            key={`${i}-${cell}`}
            className={`roadmap-beads__cell roadmap-beads__cell--${cell}`}
            role="listitem"
          >
            {cell}
          </span>
        ))}
      </div>
    </aside>
  )
}
