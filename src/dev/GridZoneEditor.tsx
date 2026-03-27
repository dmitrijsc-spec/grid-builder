import { useEffect, useMemo, useState } from 'react'
import { GRID_SKIN } from '../components/grid/config/gridSkin'
import { buildGridZones, type GridZoneConfig } from '../components/grid/config/gridZones'
import {
  GRID_ZONE_STORAGE_KEY,
  loadStoredZones,
  persistZones,
} from '../components/grid/config/gridZoneStorage'

type DragMode = 'move' | 'resize'

interface DragState {
  zoneId: string
  mode: DragMode
  startX: number
  startY: number
  startRect: GridZoneConfig['rect']
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function GridZoneEditor() {
  const [zones, setZones] = useState<GridZoneConfig[]>(() =>
    loadStoredZones(buildGridZones(GRID_SKIN.baseWidth, GRID_SKIN.mainOffsetY)),
  )
  const [selectedId, setSelectedId] = useState<string>(zones[0]?.id ?? '')
  const [scale, setScale] = useState<number>(GRID_SKIN.scale)
  const [drag, setDrag] = useState<DragState | null>(null)

  const boardWidth = GRID_SKIN.baseWidth * scale
  const boardHeight = GRID_SKIN.baseHeight * scale

  const selected = useMemo(
    () => zones.find((z) => z.id === selectedId) ?? null,
    [zones, selectedId],
  )

  useEffect(() => {
    if (!drag) return

    const onMove = (e: MouseEvent) => {
      const dx = (e.clientX - drag.startX) / scale
      const dy = (e.clientY - drag.startY) / scale

      setZones((prev) =>
        prev.map((z) => {
          if (z.id !== drag.zoneId) return z

          if (drag.mode === 'move') {
            const x = clamp(
              drag.startRect.x + dx,
              0,
              GRID_SKIN.baseWidth - drag.startRect.w,
            )
            const y = clamp(
              drag.startRect.y + dy,
              0,
              GRID_SKIN.baseHeight - drag.startRect.h,
            )
            return { ...z, rect: { ...z.rect, x, y } }
          }

          const w = clamp(
            drag.startRect.w + dx,
            8,
            GRID_SKIN.baseWidth - drag.startRect.x,
          )
          const h = clamp(
            drag.startRect.h + dy,
            8,
            GRID_SKIN.baseHeight - drag.startRect.y,
          )
          return { ...z, rect: { ...z.rect, w, h } }
        }),
      )
    }

    const onUp = () => setDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, scale])

  const exportJson = JSON.stringify(
    zones.map((z) => ({
      id: z.id,
      label: z.label,
      sub: z.sub,
      skin: z.skin,
      rect: {
        x: Number(z.rect.x.toFixed(3)),
        y: Number(z.rect.y.toFixed(3)),
        w: Number(z.rect.w.toFixed(3)),
        h: Number(z.rect.h.toFixed(3)),
      },
      hover: z.hover,
    })),
    null,
    2,
  )

  useEffect(() => {
    persistZones(zones)
  }, [zones])

  const setSelectedRect = (
    key: keyof GridZoneConfig['rect'],
    value: number,
  ) => {
    if (!selected) return
    setZones((prev) =>
      prev.map((z) =>
        z.id === selected.id
          ? { ...z, rect: { ...z.rect, [key]: value } }
          : z,
      ),
    )
  }

  const resetToDefaults = () => {
    const defaults = buildGridZones(GRID_SKIN.baseWidth, GRID_SKIN.mainOffsetY)
    setZones(defaults)
    setSelectedId(defaults[0]?.id ?? '')
    try {
      window.localStorage.removeItem(GRID_ZONE_STORAGE_KEY)
    } catch {
      // noop
    }
  }

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(exportJson)
    } catch {
      // noop
    }
  }

  return (
    <div className="grid-editor">
      <div className="grid-editor__left">
        <h2>Grid Zone Editor</h2>
        <div className="grid-editor__actions">
          <button type="button" onClick={copyJson}>
            Copy JSON
          </button>
          <button type="button" onClick={resetToDefaults}>
            Reset
          </button>
        </div>
        <label>
          Scale
          <input
            type="range"
            min={0.8}
            max={2}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
          <span>{scale.toFixed(2)}x</span>
        </label>

        <label>
          Zone
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.id}
              </option>
            ))}
          </select>
        </label>

        {selected ? (
          <div className="grid-editor__panel">
            <div className="grid-editor__row">
              <label>
                X
                <input
                  type="number"
                  value={selected.rect.x}
                  onChange={(e) => setSelectedRect('x', Number(e.target.value))}
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  value={selected.rect.y}
                  onChange={(e) => setSelectedRect('y', Number(e.target.value))}
                />
              </label>
            </div>
            <div className="grid-editor__row">
              <label>
                W
                <input
                  type="number"
                  value={selected.rect.w}
                  onChange={(e) => setSelectedRect('w', Number(e.target.value))}
                />
              </label>
              <label>
                H
                <input
                  type="number"
                  value={selected.rect.h}
                  onChange={(e) => setSelectedRect('h', Number(e.target.value))}
                />
              </label>
            </div>
          </div>
        ) : null}

        <label>
          Export JSON
          <textarea value={exportJson} readOnly rows={14} />
        </label>
      </div>

      <div className="grid-editor__stage">
        <div
          className="grid-editor__board"
          style={{ width: boardWidth, height: boardHeight }}
        >
          <img
            src={GRID_SKIN.baseAsset}
            alt=""
            className="grid-editor__asset grid-editor__asset--base"
          />
          <img
            src={GRID_SKIN.mainAsset}
            alt=""
            className="grid-editor__asset grid-editor__asset--main"
            style={{
              top: GRID_SKIN.mainOffsetY * scale,
              width: GRID_SKIN.mainWidth * scale,
              height: GRID_SKIN.mainHeight * scale,
            }}
          />

          {zones.map((z) => {
            const isSelected = z.id === selectedId
            return (
              <div
                key={z.id}
                className={`grid-editor__zone ${isSelected ? 'is-selected' : ''}`}
                style={{
                  left: z.rect.x * scale,
                  top: z.rect.y * scale,
                  width: z.rect.w * scale,
                  height: z.rect.h * scale,
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  setSelectedId(z.id)
                  setDrag({
                    zoneId: z.id,
                    mode: 'move',
                    startX: e.clientX,
                    startY: e.clientY,
                    startRect: { ...z.rect },
                  })
                }}
              >
                <span>{z.id}</span>
                <button
                  type="button"
                  className="grid-editor__resize"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    if (e.button !== 0) return
                    setSelectedId(z.id)
                    setDrag({
                      zoneId: z.id,
                      mode: 'resize',
                      startX: e.clientX,
                      startY: e.clientY,
                      startRect: { ...z.rect },
                    })
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

