import { useAuth } from './auth/AuthContext'
import { LoginPage } from './auth/LoginPage'
import { BettingGrid } from './components/grid/BettingGrid'
import { BottomBar } from './components/bottom/BottomBar'
import { GameFrame } from './components/game/GameFrame'
import { GameShell } from './components/layout/GameShell'
import { TopBar } from './components/top/TopBar'
import { GridCanvasBuilder } from './dev/GridCanvasBuilder'
import { GridZoneEditor } from './dev/GridZoneEditor'
import { GridRuntimeComparePage } from './dev/GridRuntimeComparePage'
import { isSupabaseAuthEnabled } from './lib/supabaseClient'

function App() {
  const { user, loading } = useAuth()

  if (isSupabaseAuthEnabled()) {
    if (loading) {
      return (
        <div className="auth-loading" style={{ display: 'grid', placeItems: 'center', color: '#e8eef8' }}>
          Загрузка…
        </div>
      )
    }
    if (!user) {
      return <LoginPage />
    }
  }

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
