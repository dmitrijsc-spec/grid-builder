import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import type { GridProjectsState } from '../components/grid/builder/types'
import {
  decodeState,
  encodeState,
  estimatedProjectsInlineFootprint,
  getProjectsStateFreshnessScore,
  hasPersistedGridProjectsState,
  touchInMemoryState,
} from '../components/grid/builder/storage'
import { isSupabaseAuthEnabled, supabase } from '../lib/supabaseClient'

const TABLE = 'scibo_user_grid_projects'
const PARTS_TABLE = 'scibo_user_grid_project_parts'
/** Stay under typical ~1MB Supabase REST body limits (UTF-8 JSON wrapping). */
const MAX_SINGLE_REQUEST_PAYLOAD_CHARS = 520_000
const PART_CHAR_SLICE = 420_000

export type GridCloudSyncStatus = 'saved' | 'saving' | 'error'

function splitEncodedPayload(encoded: string): string[] {
  if (encoded.length <= MAX_SINGLE_REQUEST_PAYLOAD_CHARS) return [encoded]
  const out: string[] = []
  for (let i = 0; i < encoded.length; i += PART_CHAR_SLICE) {
    out.push(encoded.slice(i, i + PART_CHAR_SLICE))
  }
  return out
}

async function fetchRemote(userId: string): Promise<{ payload: string; updatedAt: string } | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from(TABLE)
    .select('payload, parts_count, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { payload: string | null; parts_count: number | null; updated_at: string }
  const partsCount = typeof row.parts_count === 'number' ? row.parts_count : 0
  if (partsCount > 0) {
    const { data: parts, error: pErr } = await supabase
      .from(PARTS_TABLE)
      .select('part_index, content')
      .eq('user_id', userId)
      .order('part_index', { ascending: true })
    if (pErr || !parts?.length) return null
    if (parts.length !== partsCount) return null
    const payload = parts.map((p) => (p as { content: string }).content).join('')
    if (!payload.startsWith('lz16:')) return null
    return { payload, updatedAt: row.updated_at }
  }
  if (typeof row.payload !== 'string' || !row.payload.trim()) return null
  return { payload: row.payload, updatedAt: row.updated_at }
}

async function upsertRemote(userId: string, state: GridProjectsState): Promise<void> {
  if (!supabase) return
  const encoded = encodeState(state)
  const parts = splitEncodedPayload(encoded)

  const { error: delPartsErr } = await supabase.from(PARTS_TABLE).delete().eq('user_id', userId)
  if (delPartsErr) throw delPartsErr

  if (parts.length === 1) {
    const { error } = await supabase.from(TABLE).upsert(
      { user_id: userId, payload: parts[0], parts_count: 0 },
      { onConflict: 'user_id' },
    )
    if (error) throw error
    return
  }

  for (let i = 0; i < parts.length; i += 1) {
    const { error: insErr } = await supabase.from(PARTS_TABLE).insert({
      user_id: userId,
      part_index: i,
      content: parts[i],
    })
    if (insErr) throw insErr
  }

  const { error } = await supabase.from(TABLE).upsert(
    { user_id: userId, payload: '', parts_count: parts.length },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

/**
 * Loads builder state from Supabase after login, merges by project timestamps;
 * debounced upload when `autoSync` is true.
 */
export function useSupabaseGridSync(
  state: GridProjectsState,
  onLoad: (next: GridProjectsState) => void,
  options?: { autoSync?: boolean },
) {
  const { session } = useAuth()
  const autoSync = options?.autoSync ?? true
  const [status, setStatus] = useState<GridCloudSyncStatus>('saved')
  const [lastError, setLastError] = useState<string | null>(null)
  const stateRef = useRef(state)
  const onLoadRef = useRef(onLoad)
  useEffect(() => {
    stateRef.current = state
    onLoadRef.current = onLoad
  }, [state, onLoad])
  /** Cleared on effect cleanup so React StrictMode runs merge twice safely. */
  const mergedSessionRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!isSupabaseAuthEnabled() || !session?.user?.id) {
      mergedSessionRef.current = undefined
      return
    }
    const uid = session.user.id
    if (mergedSessionRef.current === uid) return
    mergedSessionRef.current = uid
    let cancelled = false
    ;(async () => {
      try {
        const row = await fetchRemote(uid)
        const local = stateRef.current
        if (cancelled) return
        if (!row) {
          await upsertRemote(uid, local)
          return
        }
        const remoteState = decodeState(row.payload)
        if (!remoteState) return
        // Fresh device: in-memory state is a default project with "now" timestamps, which wrongly
        // beats older cloud data and can even overwrite the server. Prefer cloud when nothing was saved locally.
        if (!hasPersistedGridProjectsState()) {
          onLoadRef.current(remoteState)
          touchInMemoryState(remoteState)
          return
        }
        const rScore = getProjectsStateFreshnessScore(remoteState)
        const lScore = getProjectsStateFreshnessScore(local)
        if (rScore > lScore) {
          onLoadRef.current(remoteState)
          touchInMemoryState(remoteState)
        } else if (lScore > rScore) {
          await upsertRemote(uid, local)
        } else {
          // Same freshness: if payloads differ, push local so edits are not stuck only in the browser.
          const localEncoded = encodeState(local)
          if (localEncoded !== row.payload) {
            await upsertRemote(uid, local)
          }
        }
      } catch (e) {
        mergedSessionRef.current = undefined
        const msg = e && typeof (e as { message?: string }).message === 'string' ? (e as Error).message : 'merge failed'
        setLastError(msg)
      }
    })()
    return () => {
      cancelled = true
      if (mergedSessionRef.current === uid) mergedSessionRef.current = undefined
    }
  }, [session?.user?.id])

  useEffect(() => {
    if (!isSupabaseAuthEnabled() || !session?.user?.id || !autoSync) return
    const uid = session.user.id
    const autosyncMs =
      estimatedProjectsInlineFootprint(state) > 400_000 ? 3200 : 1400
    const t = window.setTimeout(() => {
      setStatus('saving')
      setLastError(null)
      void upsertRemote(uid, state)
        .then(() => {
          setStatus('saved')
          setLastError(null)
        })
        .catch((e) => {
          setStatus('error')
          setLastError(e instanceof Error ? e.message : String(e))
        })
    }, autosyncMs)
    return () => window.clearTimeout(t)
  }, [state, session?.user?.id, autoSync])

  useEffect(() => {
    if (!isSupabaseAuthEnabled() || !session?.user?.id || !autoSync) return
    const uid = session.user.id
    const flush = () => {
      void upsertRemote(uid, stateRef.current).catch(() => {})
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [session?.user?.id, autoSync])

  const saveNow = useCallback(async (overrideState?: GridProjectsState) => {
    if (!isSupabaseAuthEnabled() || !session?.user?.id) return true
    setStatus('saving')
    setLastError(null)
    try {
      await upsertRemote(session.user.id, overrideState ?? stateRef.current)
      setStatus('saved')
      setLastError(null)
      return true
    } catch (e) {
      setStatus('error')
      setLastError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [session])

  if (!isSupabaseAuthEnabled()) {
    return { status: 'saved' as const, lastError: null as string | null, saveNow: async () => true }
  }

  return { status, lastError, saveNow }
}
