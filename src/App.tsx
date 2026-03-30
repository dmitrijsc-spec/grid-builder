import { BettingGrid } from './components/grid/BettingGrid'
import { BottomBar } from './components/bottom/BottomBar'
import { GameFrame } from './components/game/GameFrame'
import { GameShell } from './components/layout/GameShell'
import { TopBar } from './components/top/TopBar'
import { GridCanvasBuilder } from './dev/GridCanvasBuilder'
import { GridZoneEditor } from './dev/GridZoneEditor'
import { GridRuntimeComparePage } from './dev/GridRuntimeComparePage'

function App() {
  if (typeof window !== 'undefined' && window.location.pathname === '/dev/grid-editor') {
    return <GridZoneEditor />
  }
  if (typeof window !== 'undefined' && window.location.pathname === '/dev/grid-builder') {
    return <GridCanvasBuilder />
  }
  if (typeof window !== 'undefined' && window.location.pathname === '/dev/grid-runtime-compare') {
    return <GridRuntimeComparePage />
  }

  return (
    <GameShell>
      <TopBar />
      <GameFrame>
        <div className="main-stage">
          <div className="grid-column">
            <BettingGrid />
          </div>
        </div>
      </GameFrame>
      <BottomBar />
    </GameShell>
  )
}

export default App
