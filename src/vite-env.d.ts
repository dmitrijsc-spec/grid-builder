/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARENT_ORIGIN?: string
  /** YouTube URL used as background stream behind static image */
  readonly VITE_STREAM_YOUTUBE_URL?: string
  /** Stream URL (mp4 / HLS, depending on player) for game frame background */
  readonly VITE_STREAM_URL?: string
  /** Static background image for testing (e.g. /stream-test.jpg) */
  readonly VITE_STREAM_IMAGE?: string
  /** Supabase project URL (shared grid snapshots) */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon key (legacy; optional if publishable is set) */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Supabase publishable key (preferred for new projects) */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Default grid “room” id when ?room= is omitted */
  readonly VITE_GRID_CLOUD_ROOM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
