import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
  || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
)

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null

export function isSupabaseAuthEnabled(): boolean {
  return supabase !== null
}

/** Client-safe API key for REST (same as above). */
export function getSupabaseClientApiKey(): string {
  const k = (
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
    || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  )
  return k ?? ''
}
