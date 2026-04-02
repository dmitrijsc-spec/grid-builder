import { useCallback, useState } from 'react'
import { GRID_CLOUD_ROOM_STORAGE_KEY, getGridCloudRoomForPublish, isSupabaseGridCloudConfigured } from '../../services/gridCloudSupabase'

/**
 * Shows how **Update Game** reaches other tabs/devices: local snapshot, optional Vite LAN relay, optional Supabase room.
 */
export function PublishChannelsBar() {
  const [roomDraft, setRoomDraft] = useState(
    () => (typeof window !== 'undefined' ? window.localStorage.getItem(GRID_CLOUD_ROOM_STORAGE_KEY) ?? '' : ''),
  )

  const persistRoom = useCallback((next: string) => {
    setRoomDraft(next)
    try {
      if (next.trim()) window.localStorage.setItem(GRID_CLOUD_ROOM_STORAGE_KEY, next.trim())
      else window.localStorage.removeItem(GRID_CLOUD_ROOM_STORAGE_KEY)
    } catch {
      /* noop */
    }
  }, [])

  const supabaseOk = isSupabaseGridCloudConfigured()
  const roomEffective = getGridCloudRoomForPublish()
  const devRelay = import.meta.env.DEV

  return (
    <div className="grid-builder__publish-strip-wrap">
      <div className="grid-builder__publish-strip" role="status" aria-label="Publish channels for Update Game">
        <span className="grid-builder__publish-badge" title="Runtime snapshot stored in this browser">
          Local
        </span>
        {devRelay ? (
          <span
            className="grid-builder__publish-badge grid-builder__publish-badge--dev"
            title="Vite dev relay — phones on the same Wi‑Fi can poll the published snapshot"
          >
            LAN relay
          </span>
        ) : null}
        {supabaseOk ? (
          <span
            className={`grid-builder__publish-badge ${roomEffective ? '' : 'grid-builder__publish-badge--warn'}`}
            title={
              roomEffective
                ? 'Snapshots upload for game URLs with ?room= this id'
                : 'Enter a room id so deployed builds can receive snapshots'
            }
          >
            {roomEffective
              ? `Remote: ${roomEffective.length > 14 ? `${roomEffective.slice(0, 12)}…` : roomEffective}`
              : 'Remote: set room'}
          </span>
        ) : (
          <span
            className="grid-builder__publish-badge grid-builder__publish-badge--muted"
            title="Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable remote snapshot sharing"
          >
            Remote: off
          </span>
        )}
        <label className="grid-builder__publish-room">
          <span className="grid-builder__visually-hidden">Share room id</span>
          <input
            type="text"
            className="grid-builder__publish-room-input"
            placeholder="Share room id"
            value={roomDraft}
            onChange={(e) => setRoomDraft(e.target.value)}
            onBlur={() => persistRoom(roomDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
    </div>
  )
}
