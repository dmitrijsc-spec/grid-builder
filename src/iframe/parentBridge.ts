/**
 * Связь с родительским окном (операторский сайт, iframe).
 * Расширяйте типы сообщений по мере интеграции.
 */

export const PARENT_MSG = {
  READY: 'scibo:ready',
  RESIZE: 'scibo:resize',
} as const

export type ParentOutboundMessage =
  | { type: typeof PARENT_MSG.READY; payload: { version: string } }
  | {
      type: typeof PARENT_MSG.RESIZE
      payload: { width: number; height: number }
    }

function safeParent(): Window | null {
  try {
    if (window.parent && window.parent !== window) return window.parent
  } catch {
    return null
  }
  return null
}

export function postToParent(msg: ParentOutboundMessage): void {
  const p = safeParent()
  if (!p) return
  const origin =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_PARENT_ORIGIN
      ? String(import.meta.env.VITE_PARENT_ORIGIN)
      : '*'
  p.postMessage(msg, origin)
}

export function notifyReady(version = '0.0.0'): void {
  postToParent({ type: PARENT_MSG.READY, payload: { version } })
}

export function notifyResize(width: number, height: number): void {
  postToParent({ type: PARENT_MSG.RESIZE, payload: { width, height } })
}

export function initParentBridge(root: HTMLElement): () => void {
  const ro = new ResizeObserver((entries) => {
    const cr = entries[0]?.contentRect
    if (cr) notifyResize(cr.width, cr.height)
  })
  ro.observe(root)
  notifyReady()
  return () => ro.disconnect()
}
