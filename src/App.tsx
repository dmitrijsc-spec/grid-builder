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
  const authEnabled = isSupabaseAuthEnabled()

  // In production we should never silently bypass auth due to missing env.
  if (import.meta.env.PROD && !authEnabled) {
    return (
      <div className="auth-loading" style={{ display: 'grid', placeItems: 'center', color: '#ffc2c2', padding: 20 }}>
        Supabase auth is not configured on this deployment. Add
        {' '}
        <code>VITE_SUPABASE_URL</code>
        {' '}
        and
        {' '}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
        {' '}
        in Vercel Environment Variables, then redeploy.
      </div>
    )
  }

  if (authEnabled) {
    if (loading) {
      return (
        <div className="auth-loading" style={{ display: 'grid', placeItems: 'center', color: '#e8eef8' }}>
          Loading…
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
