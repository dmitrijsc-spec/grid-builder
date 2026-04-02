/** Below this inner width, builder auto-opens the mobile grid package (typical phone band). */
export const BUILDER_AUTO_DEVICE_MAX_WIDTH_PX = 960

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}
