import { BettingGrid } from './components/grid/BettingGrid'
import { BottomBar } from './components/bottom/BottomBar'
import { GameFrame } from './components/game/GameFrame'
import { GameShell } from './components/layout/GameShell'
import { TopBar } from './components/top/TopBar'
import { GridCanvasBuilder } from './dev/GridCanvasBuilder'
import { GridZoneEditor } from './dev/GridZoneEditor'

function App() {
  if (typeof window !== 'undefined' && window.location.pathname === '/dev/grid-editor') {
    return <GridZoneEditor />
  }
  if (typeof window !== 'undefined' && window.location.pathname === '/dev/grid-builder') {
    return <GridCanvasBuilder />
  }

  return (
    <GameShell>
      <TopBar />
      <GameFrame>
        <div className="main-stage">
          <div className="main-columns">
            <aside className="stage-side-block stage-side-block--left" aria-label="Left block" />
            <div className="grid-column">
              <BettingGrid />
            </div>
            <aside className="stage-side-block stage-side-block--right" aria-label="Right block" />
          </div>
        </div>
      </GameFrame>
      <BottomBar />
    </GameShell>
  )
}

export default App
