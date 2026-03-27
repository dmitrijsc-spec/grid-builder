import { useGame } from '../../game/GameContext'
import type { GamePhase } from '../../game/types'
import { useEffect, useState } from 'react'
import {
  GRID_PACKAGE_EVENT,
  loadGridProjectsState,
  publishGridProjectsState,
  saveGridProjectsState,
} from '../grid/builder/storage'
import type { GridProjectsState } from '../grid/builder/types'

const PHASE_OPTIONS: Array<{ value: GamePhase; label: string }> = [
  { value: 'betting', label: 'Betting' },
  { value: 'bets_closed', label: 'Bets Closed' },
  { value: 'rolling', label: 'Rolling' },
  { value: 'result', label: 'Result' },
]

export function RoundDevController() {
  const { state, dispatch } = useGame()
  const [gridProjectsState, setGridProjectsState] = useState<GridProjectsState>(() =>
    loadGridProjectsState(),
  )

  useEffect(() => {
    // Only sync on explicit publish — NOT on every localStorage save
    const sync = () => setGridProjectsState(loadGridProjectsState())
    window.addEventListener(GRID_PACKAGE_EVENT, sync as EventListener)
    return () => {
      window.removeEventListener(GRID_PACKAGE_EVENT, sync as EventListener)
    }
  }, [])

  const switchGridProject = (projectId: string) => {
    const current = loadGridProjectsState()
    if (!current.projects.some((project) => project.id === projectId)) return
    const next = { ...current, activeProjectId: projectId }
    saveGridProjectsState(next)
    publishGridProjectsState(next)
    setGridProjectsState((prev) => ({
      ...prev,
      activeProjectId: projectId,
    }))
  }

  return (
    <div className="round-dev-controller" role="group" aria-label="Round controls">
      <label className="round-dev-controller__label" htmlFor="grid-project-select">
        Grid
      </label>
      <select
        id="grid-project-select"
        className="round-dev-controller__select"
        value={gridProjectsState.activeProjectId}
        onChange={(e) => switchGridProject(e.target.value)}
      >
        {gridProjectsState.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <label className="round-dev-controller__label" htmlFor="round-phase-select">
        State
      </label>
      <select
        id="round-phase-select"
        className="round-dev-controller__select"
        value={state.phase}
        onChange={(e) =>
          dispatch({
            type: 'SET_PHASE',
            phase: e.target.value as GamePhase,
          })
        }
      >
        {PHASE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="round-dev-controller__button"
        onClick={() => dispatch({ type: 'RESET_ROUND' })}
      >
        Обновить раунд
      </button>
    </div>
  )
}
