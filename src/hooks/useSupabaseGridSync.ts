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

function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

/** PostgREST / Supabase client often rejects with a plain object, not `instanceof Error`. */
function formatSupabaseSyncError(e: unknown): string {
  if (e == null || e === undefined) return 'Unknown error'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message.trim() || e.name || 'Error'
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>
    const bits: string[] = []
    if (typeof o.code === 'string' && o.code) bits.push(o.code)
    if (typeof o.message === 'string' && o.message) bits.push(o.message)
    if (typeof o.details === 'string' && o.details) bits.push(o.details)
    if (typeof o.hint === 'string' && o.hint) bits.push(o.hint)
    if (bits.length) return bits.join(' — ')
    try {
      const s = JSON.stringify(o)
      if (s && s !== '{}') return s.length > 280 ? `${s.slice(0, 280)}…` : s
    } catch {
      /* noop */
    }
    return errMsg(e)
  }
  try {
    return String(e)
  } catch {
    return 'Unknown error'
  }
}

function isMissingPartsTableError(err: unknown): boolean {
  const m = errMsg(err)
  return (
    m.includes('scibo_user_grid_project_parts')
    || m.includes('Could not find the table')
    || (m.includes('does not exist') && m.toLowerCase().includes('parts'))
  )
}

function isMissingPartsCountColumnError(err: unknown): boolean {
  const m = errMsg(err)
  return m.includes('parts_count')
}

const MIGRATION_HINT =
  'Run SQL migration: supabase/migrations/20260330223000_scibo_user_grid_project_parts.sql (Supabase Dashboard → SQL).'

function splitEncodedPayload(encoded: string): string[] {
  if (encoded.length <= MAX_SINGLE_REQUEST_PAYLOAD_CHARS) return [encoded]
  const out: string[] = []
  for (let i = 0; i < encoded.length; i += PART_CHAR_SLICE) {
    out.push(encoded.slice(i, i + PART_CHAR_SLICE))
  }
  return out
}

/** Row `updated_at` bumps on every cloud save even when only a non-max-stale project was renamed. */
export async function loadRemoteGridProjectsBundle(
  userId: string,
): Promise<{ state: GridProjectsState; serverUpdatedAt: string } | null> {
  const row = await fetchRemote(userId)
  if (!row) return null
  const state = decodeState(row.payload)
  if (!state) return null
  return { state, serverUpdatedAt: row.updatedAt }
}

export async function loadRemoteGridProjectsStateForUser(userId: string): Promise<GridProjectsState | null> {
  const bundle = await loadRemoteGridProjectsBundle(userId)
  return bundle?.state ?? null
}

/** One in-flight cloud write per user — concurrent upserts still hit 23505 on PK under load. */
const gridCloudSaveTailByUser = new Map<string, Promise<void>>()

async function fetchRemote(userId: string): Promise<{ payload: string; updatedAt: string } | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { payload: string | null; parts_count?: number | null; updated_at: string }
  const partsCount = typeof row.parts_count === 'number' ? row.parts_count : 0
  if (partsCount > 0) {
    const { data: parts, error: pErr } = await supabase
      .from(PARTS_TABLE)
      .select('part_index, content')
      .eq('user_id', userId)
      .order('part_index', { ascending: true })
    if (pErr) {
      if (isMissingPartsTableError(pErr)) return null
      return null
    }
    if (!parts?.length || parts.length !== partsCount) return null
    const payload = parts.map((p) => (p as { content: string }).content).join('')
    if (!payload.startsWith('lz16:')) return null
    return { payload, updatedAt: row.updated_at }
  }
  if (typeof row.payload !== 'string' || !row.payload.trim()) return null
  return { payload: row.payload, updatedAt: row.updated_at }
}

async function performUpsertRemote(userId: string, state: GridProjectsState): Promise<void> {
  if (!supabase) return
  const sb = supabase
  const encoded = encodeState(state)
  const parts = splitEncodedPayload(encoded)

  if (parts.length === 1) {
    const { error: delErr } = await sb.from(PARTS_TABLE).delete().eq('user_id', userId)
    if (delErr && !isMissingPartsTableError(delErr)) throw delErr

    const tryUpsert = async (includePartsCount: boolean) => {
      const row: Record<string, unknown> = {
        user_id: userId,
        payload: parts[0],
      }
      if (includePartsCount) row.parts_count = 0
      return sb.from(TABLE).upsert(row as never, { onConflict: 'user_id' })
    }
    let up = await tryUpsert(true)
    if (up.error && isMissingPartsCountColumnError(up.error)) {
      up = await tryUpsert(false)
    }
    if (up.error) throw up.error
    return
  }

  // Chunked path: upsert each slice (one row per request — multi-megabyte batch upserts hit REST limits).
  // Replaces delete-all + insert, which raced with concurrent saves → 23505 on pkey (user_id, part_index).
  for (let i = 0; i < parts.length; i += 1) {
    const { error: rowErr } = await sb.from(PARTS_TABLE).upsert(
      {
        user_id: userId,
        part_index: i,
        content: parts[i],
      },
      { onConflict: 'user_id,part_index' },
    )
    if (rowErr) {
      if (isMissingPartsTableError(rowErr)) {
        throw new Error(
          `Project is too large for a single cloud row (${encoded.length} chars). ${MIGRATION_HINT}`,
        )
      }
      throw rowErr
    }
  }

  const { error: delStaleErr } = await sb
    .from(PARTS_TABLE)
    .delete()
    .eq('user_id', userId)
    .gte('part_index', parts.length)
  if (delStaleErr) {
    if (isMissingPartsTableError(delStaleErr)) {
      throw new Error(
        `Project is too large for a single cloud row (${encoded.length} chars). ${MIGRATION_HINT}`,
      )
    }
    throw delStaleErr
  }

  const tryMain = async (includePartsCount: boolean) => {
    const row: Record<string, unknown> = {
      user_id: userId,
      payload: '',
    }
    if (includePartsCount) row.parts_count = parts.length
    return sb.from(TABLE).upsert(row as never, { onConflict: 'user_id' })
  }
  const main = await tryMain(true)
  if (main.error && isMissingPartsCountColumnError(main.error)) {
    throw new Error(
      `Chunked save requires column parts_count on ${TABLE}. ${MIGRATION_HINT}`,
    )
  }
  if (main.error) throw main.error
}

async function upsertRemote(userId: string, state: GridProjectsState): Promise<void> {
  if (!supabase) return
  const prev = gridCloudSaveTailByUser.get(userId) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(() => performUpsertRemote(userId, state))
  gridCloudSaveTailByUser.set(userId, run)
  try {
    await run
  } finally {
    if (gridCloudSaveTailByUser.get(userId) === run) {
      gridCloudSaveTailByUser.delete(userId)
    }
  }
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
        setLastError(formatSupabaseSyncError(e) || 'merge failed')
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
          setLastError(formatSupabaseSyncError(e))
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
      setLastError(formatSupabaseSyncError(e))
      return false
    }
  }, [session])

  if (!isSupabaseAuthEnabled()) {
    return { status: 'saved' as const, lastError: null as string | null, saveNow: async () => true }
  }

  return { status, lastError, saveNow }
}
