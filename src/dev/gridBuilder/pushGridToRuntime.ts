import {
  buildRuntimeAtlasForPackageWithFallback,
  mirrorExistingRuntimeSnapshotToDevServer,
  publishRuntimePackages,
  resolveRuntimeAtlasResolutionMultiplier,
  selectProjectPackage,
} from '../../components/grid/builder/storage'
import type { GridProjectsState } from '../../components/grid/builder/types'
import { pushRuntimeSnapshotToSupabaseFromBrowser } from '../../services/gridCloudSupabase'

/** Both desktop + mobile packages — edits in the inactive builder mode still affect publish fingerprint. */
export function getRuntimePublishFingerprint(state: GridProjectsState): string {
  const active =
    state.projects.find((project) => project.id === state.activeProjectId) ??
    state.projects[0]
  if (!active) return 'none'
  const desktop = active.pkg
  const mobile = active.mobilePkg ?? active.pkg
  return `${active.id}:${JSON.stringify({ desktop, mobile })}`
}

export type PushGridToRuntimeParams = {
  projectsState: GridProjectsState
  lastFingerprint: string | null
  deviceMode: 'desktop' | 'mobile'
  saveGridProjectsStateNow: (state: GridProjectsState) => void
  saveProjectsToCloudNow: (state: GridProjectsState) => Promise<boolean>
}

export type PushGridToRuntimeResult =
  | { ok: true; detailParts: string[]; nextFingerprint: string | null }
  | { ok: false; error: string }

/**
 * Persists projects, bakes optional runtime atlases, publishes local runtime snapshot,
 * mirrors to the Vite dev relay when applicable, and uploads to Supabase grid snapshots when configured.
 */
export async function pushGridToRuntime(params: PushGridToRuntimeParams): Promise<PushGridToRuntimeResult> {
  const {
    projectsState,
    lastFingerprint,
    deviceMode,
    saveGridProjectsStateNow,
    saveProjectsToCloudNow,
  } = params

  const detailParts: string[] = []
  try {
    const runtimeFingerprint = getRuntimePublishFingerprint(projectsState)
    const shouldPublishToRuntime = runtimeFingerprint !== lastFingerprint
    saveGridProjectsStateNow(projectsState)
    const projectsCloudOk = await saveProjectsToCloudNow(projectsState)
    if (!projectsCloudOk) detailParts.push('account projects: sync failed')

    let nextFingerprint: string | null = lastFingerprint
    if (shouldPublishToRuntime) {
      const active = projectsState.projects.find((p) => p.id === projectsState.activeProjectId)
      const desktopBase = selectProjectPackage(active, 'desktop')
      const mobileBase = selectProjectPackage(active, 'mobile')
      const desktopAtlasMult = resolveRuntimeAtlasResolutionMultiplier(2)
      const mobileAtlasMult = resolveRuntimeAtlasResolutionMultiplier(3)
      const { pkg: desktopPkg, error: desktopAtlasErr } = await buildRuntimeAtlasForPackageWithFallback(
        desktopBase,
        4,
        8192,
        desktopAtlasMult,
      )
      const { pkg: mobilePkg, error: mobileAtlasErr } = await buildRuntimeAtlasForPackageWithFallback(
        mobileBase,
        5,
        8192,
        mobileAtlasMult,
      )
      detailParts.push(
        ...(
          [
            desktopAtlasErr && `desktop atlas: ${desktopAtlasErr}`,
            mobileAtlasErr && `mobile atlas: ${mobileAtlasErr}`,
          ].filter(Boolean) as string[]
        ),
      )
      publishRuntimePackages(desktopPkg, mobilePkg, deviceMode)
      nextFingerprint = runtimeFingerprint
    } else {
      mirrorExistingRuntimeSnapshotToDevServer()
    }

    const cloudResult = await pushRuntimeSnapshotToSupabaseFromBrowser()
    if (!cloudResult.ok) detailParts.push(`cloud: ${cloudResult.error}`)

    return { ok: true, detailParts, nextFingerprint }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
