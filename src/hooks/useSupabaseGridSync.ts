import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import type { GridProjectsState } from '../components/grid/builder/types'
import {
  decodeState,
  encodeState,
  getProjectsStateFreshnessScore,
  touchInMemoryState,
} from '../components/grid/builder/storage'
import { isSupabaseAuthEnabled, supabase } from '../lib/supabaseClient'

const TABLE = 'scibo_user_grid_projects'

export type GridCloudSyncStatus = 'saved' | 'saving' | 'error'

async function fetchRemote(userId: string): Promise<{ payload: string; updatedAt: string } | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from(TABLE)
    .select('payload, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { payload: string; updated_at: string }
  if (typeof row.payload !== 'string') return null
  return { payload: row.payload, updatedAt: row.updated_at }
}

async function upsertRemote(userId: string, state: GridProjectsState): Promise<void> {
  if (!supabase) return
  const payload = encodeState(state)
  const { error } = await supabase.from(TABLE).upsert(
    { user_id: userId, payload },
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
        const rScore = getProjectsStateFreshnessScore(remoteState)
        const lScore = getProjectsStateFreshnessScore(local)
        if (rScore > lScore) {
          onLoadRef.current(remoteState)
          touchInMemoryState(remoteState)
        } else if (lScore > rScore) {
          await upsertRemote(uid, local)
        }
      } catch {
        mergedSessionRef.current = undefined
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
    const t = window.setTimeout(() => {
      setStatus('saving')
      void upsertRemote(uid, state)
        .then(() => setStatus('saved'))
        .catch(() => setStatus('error'))
    }, 3200)
    return () => window.clearTimeout(t)
  }, [state, session?.user?.id, autoSync])

  const saveNow = useCallback(async () => {
    if (!isSupabaseAuthEnabled() || !session?.user?.id) return true
    setStatus('saving')
    try {
      await upsertRemote(session.user.id, stateRef.current)
      setStatus('saved')
      return true
    } catch {
      setStatus('error')
      return false
    }
  }, [session])

  if (!isSupabaseAuthEnabled()) {
    return { status: 'saved' as const, saveNow: async () => true }
  }

  return { status, saveNow }
}
