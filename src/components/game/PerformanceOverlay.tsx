import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameState } from '../../game/GameContext'

const GRAPH_SAMPLES = 90
const FRAME_BUFFER_SIZE = 240
const TARGET_FRAME_MS = 16.67
const MAX_GRAPH_FRAME_MS = 50
const UPDATE_INTERVAL_MS = 120

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const idx = clamp(Math.floor(sortedValues.length * p), 0, sortedValues.length - 1)
  return sortedValues[idx]
}

export function PerformanceOverlay() {
  const state = useGameState()
  const [fps, setFps] = useState(0)
  const [frameMs, setFrameMs] = useState(0)
  const [frameP99Ms, setFrameP99Ms] = useState(0)
  const [frameMinMs, setFrameMinMs] = useState(0)
  const [frameMaxMs, setFrameMaxMs] = useState(0)
  const [frameSamples, setFrameSamples] = useState<number[]>([])
  const [memUsedMb, setMemUsedMb] = useState<number | null>(null)
  const [memLimitMb, setMemLimitMb] = useState<number | null>(null)
  const frameBufferRef = useRef<number[]>([])

  useEffect(() => {
    let rafId = 0
    let last = performance.now()
    let updateAccumulator = 0
    let disposed = false

    const tick = (now: number) => {
      if (disposed) return
      const delta = now - last
      last = now
      if (delta <= 0 || !Number.isFinite(delta)) {
        rafId = requestAnimationFrame(tick)
        return
      }
      updateAccumulator += delta

      const buffer = frameBufferRef.current
      buffer.push(delta)
      if (buffer.length > FRAME_BUFFER_SIZE) {
        buffer.splice(0, buffer.length - FRAME_BUFFER_SIZE)
      }

      if (updateAccumulator >= UPDATE_INTERVAL_MS) {
        const sorted = [...buffer].sort((a, b) => a - b)
        const avgFrameMs = buffer.reduce((sum, value) => sum + value, 0) / Math.max(1, buffer.length)
        const p99FrameMs = percentile(sorted, 0.99)
        const minFrameMs = sorted[0] ?? 0
        const maxFrameMs = sorted[sorted.length - 1] ?? 0
        const nextFps = avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : 0

        setFps(nextFps)
        setFrameMs(avgFrameMs)
        setFrameP99Ms(p99FrameMs)
        setFrameMinMs(minFrameMs)
        setFrameMaxMs(maxFrameMs)
        setFrameSamples((current) => {
          const next = [...current, p99FrameMs]
          return next.length > GRAPH_SAMPLES ? next.slice(next.length - GRAPH_SAMPLES) : next
        })

        const maybeMemory = (performance as Performance & {
          memory?: {
            usedJSHeapSize: number
            jsHeapSizeLimit: number
          }
        }).memory
        if (maybeMemory) {
          setMemUsedMb(Math.round((maybeMemory.usedJSHeapSize / (1024 * 1024)) * 10) / 10)
          setMemLimitMb(Math.round((maybeMemory.jsHeapSizeLimit / (1024 * 1024)) * 10) / 10)
        }
        updateAccumulator = 0
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
    }
  }, [])

  const graphPoints = useMemo(() => {
    if (frameSamples.length === 0) return ''
    return frameSamples
      .map((sample, index) => {
        const x = (index / Math.max(1, GRAPH_SAMPLES - 1)) * 100
        const y = 100 - (clamp(sample, TARGET_FRAME_MS, MAX_GRAPH_FRAME_MS) - TARGET_FRAME_MS) / (MAX_GRAPH_FRAME_MS - TARGET_FRAME_MS) * 100
        return `${x},${y}`
      })
      .join(' ')
  }, [frameSamples])

  const onePercentLowFps = frameP99Ms > 0 ? Math.round(1000 / frameP99Ms) : 0

  const activeZones = Object.keys(state.bets).length

  return (
    <aside className="performance-overlay" aria-label="Performance overlay">
      <div className="performance-overlay__header">
        <strong>Perf</strong>
        <span>{fps} FPS avg</span>
      </div>

      <div className="performance-overlay__graph" aria-hidden>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={graphPoints} />
        </svg>
      </div>

      <dl className="performance-overlay__stats">
        <div>
          <dt>Frame avg</dt>
          <dd>{frameMs.toFixed(1)} ms</dd>
        </div>
        <div>
          <dt>1% low</dt>
          <dd>{onePercentLowFps} FPS</dd>
        </div>
        <div>
          <dt>Frame p99</dt>
          <dd>{frameP99Ms.toFixed(1)} ms</dd>
        </div>
        <div>
          <dt>Frame min/max</dt>
          <dd>{frameMinMs.toFixed(1)}/{frameMaxMs.toFixed(1)} ms</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>{state.phase}</dd>
        </div>
        <div>
          <dt>Timer</dt>
          <dd>{state.countdownSec}s</dd>
        </div>
        <div>
          <dt>Total Bet</dt>
          <dd>${state.totalBet.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Bet Zones</dt>
          <dd>{activeZones}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>
            {memUsedMb === null || memLimitMb === null
              ? 'n/a'
              : `${memUsedMb}/${memLimitMb} MB`}
          </dd>
        </div>
      </dl>
    </aside>
  )
}
