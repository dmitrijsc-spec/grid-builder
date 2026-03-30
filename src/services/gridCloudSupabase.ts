import { GRID_RUNTIME_PACKAGES_STORAGE_KEY } from '../components/grid/builder/storage'

/** Persisted in builder: shared “channel” id (like a password — anyone with it can read/overwrite). */
export const GRID_CLOUD_ROOM_STORAGE_KEY = 'iki-builder:cloud-room-id'

export function isSupabaseGridCloudConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return Boolean(typeof url === 'string' && url.trim() && typeof key === 'string' && key.trim())
}

/** Room id used when publishing from the builder (localStorage + optional env default). */
export function getGridCloudRoomForPublish(): string | null {
  if (typeof window === 'undefined') {
    return (import.meta.env.VITE_GRID_CLOUD_ROOM as string | undefined)?.trim() || null
  }
  const stored = window.localStorage.getItem(GRID_CLOUD_ROOM_STORAGE_KEY)?.trim()
  if (stored) return stored
  return (import.meta.env.VITE_GRID_CLOUD_ROOM as string | undefined)?.trim() || null
}

/**
 * Room for players: `?room=` in URL, else same env default as publish (optional).
 */
export function getGridCloudRoomForPlay(): string | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search).get('room')?.trim()
  if (q) return q
  return (import.meta.env.VITE_GRID_CLOUD_ROOM as string | undefined)?.trim() || null
}

const TABLE = 'scibo_grid_snapshots'

function restHeaders(): HeadersInit {
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  }
}

export async function supabasePushGridRuntimePayload(roomId: string, encodedPayload: string): Promise<void> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
  const res = await fetch(`${base}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      ...restHeaders(),
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([{ id: roomId, payload: encodedPayload }]),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 240)}`)
  }
}

export async function supabasePullGridRuntimePayload(
  roomId: string,
): Promise<{ payload: string; updatedAt: string } | null> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
  const filter = encodeURIComponent(roomId)
  const res = await fetch(`${base}/rest/v1/${TABLE}?id=eq.${filter}&select=payload,updated_at`, {
    headers: restHeaders(),
  })
  if (!res.ok) return null
  const rows = (await res.json()) as { payload: string; updated_at: string }[]
  const row = rows[0]
  if (!row || typeof row.payload !== 'string') return null
  return { payload: row.payload, updatedAt: row.updated_at }
}

/**
 * Upload last local runtime snapshot row (after Update Game wrote localStorage).
 */
export async function pushRuntimeSnapshotToSupabaseFromBrowser():
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof window === 'undefined' || !isSupabaseGridCloudConfigured()) return { ok: true }
  const room = getGridCloudRoomForPublish()
  if (!room) return { ok: true }
  const encoded = window.localStorage.getItem(GRID_RUNTIME_PACKAGES_STORAGE_KEY)
  if (!encoded?.trim()) return { ok: false, error: 'No runtime snapshot to upload' }
  try {
    await supabasePushGridRuntimePayload(room, encoded)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
