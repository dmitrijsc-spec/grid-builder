import { useEffect, useState } from 'react'
import { BettingGrid } from '../components/grid/BettingGrid'
import { loadGridProjectsState, publishGridProjectsState } from '../components/grid/builder/storage'

type RuntimeMode = 'desktop' | 'mobile'

export function GridRuntimeComparePage() {
  const [mode, setMode] = useState<RuntimeMode>('desktop')

  useEffect(() => {
    const state = loadGridProjectsState()
    publishGridProjectsState(state, mode)
    window.dispatchEvent(
      new CustomEvent('iki-runtime:viewport-mode-changed', {
        detail: { mobile: mode === 'mobile' },
      }),
    )
  }, [mode])

  return (
    <div style={{ minHeight: '100vh', background: '#0b111b', color: '#dbe6ff', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <a href="/" style={{ color: '#9fc4ff', textDecoration: 'none', fontWeight: 700 }}>
          ← Back to Game
        </a>
        <span style={{ opacity: 0.6 }}>|</span>
        <strong>Runtime Grid Compare</strong>
        <span style={{ opacity: 0.7 }}>
          (project: {loadGridProjectsState().activeProjectId})
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          type="button"
          onClick={() => setMode('desktop')}
          style={{
            height: '34px',
            borderRadius: '10px',
            border: mode === 'desktop' ? '1px solid #7dd3fc' : '1px solid rgba(255,255,255,0.22)',
            background: mode === 'desktop' ? 'rgba(14, 116, 144, 0.36)' : 'rgba(255,255,255,0.06)',
            color: '#eaf3ff',
            padding: '0 12px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Desktop Runtime
        </button>
        <button
          type="button"
          onClick={() => setMode('mobile')}
          style={{
            height: '34px',
            borderRadius: '10px',
            border: mode === 'mobile' ? '1px solid #86efac' : '1px solid rgba(255,255,255,0.22)',
            background: mode === 'mobile' ? 'rgba(21, 128, 61, 0.34)' : 'rgba(255,255,255,0.06)',
            color: '#eaf3ff',
            padding: '0 12px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Mobile Runtime
        </button>
      </div>

      <div
        className="game-frame-shell"
        data-mobile-preview={mode === 'mobile' ? 'on' : 'off'}
        style={{
          width: '100%',
          minHeight: '78vh',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(8, 14, 24, 0.72)',
        }}
      >
        <div className="game-frame" style={{ borderRadius: 'inherit' }}>
          <div className={`game-frame__viewport ${mode === 'mobile' ? 'is-mobile' : 'is-desktop'}`}>
            <div className="game-frame__content">
              <div className="main-stage">
                <div className="grid-column">
                  <BettingGrid />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
