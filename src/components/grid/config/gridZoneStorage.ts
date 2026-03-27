import type { GridZoneConfig } from './gridZones'

export const GRID_ZONE_STORAGE_KEY = 'scibo:grid-zones:v1'
export const GRID_ZONE_STORAGE_EVENT = 'scibo:grid-zones:updated'

type StoredZone = Pick<
  GridZoneConfig,
  'id' | 'rect' | 'label' | 'sub' | 'skin' | 'hover'
>

export function mergeZonesWithStored(
  defaults: GridZoneConfig[],
  stored: StoredZone[],
): GridZoneConfig[] {
  const byId = new Map(stored.map((z) => [z.id, z]))
  return defaults.map((d) => {
    const s = byId.get(d.id)
    if (!s?.rect) return d
    return {
      ...d,
      label: s.label ?? d.label,
      sub: s.sub ?? d.sub,
      skin: s.skin ?? d.skin,
      hover: s.hover ?? d.hover,
      rect: {
        x: Number(s.rect.x),
        y: Number(s.rect.y),
        w: Number(s.rect.w),
        h: Number(s.rect.h),
      },
    }
  })
}

export function loadStoredZones(defaults: GridZoneConfig[]): GridZoneConfig[] {
  if (typeof window === 'undefined') return defaults
  try {
    const raw = window.localStorage.getItem(GRID_ZONE_STORAGE_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as StoredZone[]
    if (!Array.isArray(saved) || saved.length === 0) return defaults
    return mergeZonesWithStored(defaults, saved)
  } catch {
    return defaults
  }
}

export function persistZones(zones: GridZoneConfig[]): void {
  if (typeof window === 'undefined') return
  const payload = zones.map((z) => ({
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
  }))
  try {
    window.localStorage.setItem(GRID_ZONE_STORAGE_KEY, JSON.stringify(payload))
    window.dispatchEvent(new CustomEvent(GRID_ZONE_STORAGE_EVENT))
  } catch {
    // ignore storage failures
  }
}

