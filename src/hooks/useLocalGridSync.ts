import type { GridProjectsState } from '../components/grid/builder/types'

type LocalGridSyncStatus = 'saved'

/**
 * Local-only grid persistence (no cloud). Matches the shape of the former Convex sync hook.
 */
export function useLocalGridSync(
  state: GridProjectsState,
  onLoad: (state: GridProjectsState) => void,
  options?: { autoSync?: boolean },
) {
  void state
  void onLoad
  void options
  return {
    status: 'saved' as LocalGridSyncStatus,
    saveNow: async () => true,
  }
}
