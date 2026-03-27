import { useEffect, useRef, type ReactNode } from 'react'
import { initParentBridge } from '../../iframe/parentBridge'
import { useRoundTimer } from '../../hooks/useRoundTimer'

export function GameShell({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  useRoundTimer()

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    return initParentBridge(el)
  }, [])

  return (
    <div ref={rootRef} className="game-shell">
      {children}
    </div>
  )
}
