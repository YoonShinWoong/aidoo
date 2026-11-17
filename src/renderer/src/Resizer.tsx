import { useCallback, useRef, useState } from 'react'
import type React from 'react'

export interface PaneWidth {
  ref: React.RefObject<HTMLElement | null>
  style?: React.CSSProperties
  set: (width: number | undefined, persist?: boolean) => void
}

export function usePaneWidth(name: string): PaneWidth {
  const key = `aidoo.width.${name}`
  const ref = useRef<HTMLElement | null>(null)
  const [width, setWidth] = useState<number | undefined>(() => {
    try { const saved = Number(localStorage.getItem(key)); return saved > 0 ? saved : undefined } catch { return undefined }
  })
  const set = useCallback((next: number | undefined, persist = false) => {
    setWidth(next)
    if (!persist) return
    try { next ? localStorage.setItem(key, String(Math.round(next))) : localStorage.removeItem(key) } catch { /* width just won't be remembered */ }
  }, [key])
  return { ref, set, style: width ? { width } : undefined }
}

// Growing a pane takes space from whichever flexible area is on screen, so it may only grow until that area hits its minimum.
function spareRoom() {
  const areas = [...document.querySelectorAll<HTMLElement>('[data-flex-min]')].filter(el => el.getClientRects().length)
  return Math.min(...areas.map(el => el.getBoundingClientRect().width - Number(el.dataset.flexMin)))
}

export function Resizer({ pane, edge, min, max, label }: { pane: PaneWidth; edge: 'start' | 'end'; min: number; max: number; label: string }) {
  const [now, setNow] = useState<number>()
  const direction = edge === 'end' ? 1 : -1
  const current = () => pane.ref.current?.getBoundingClientRect().width ?? min
  const limit = (width: number, start: number) => Math.round(Math.min(Math.max(width, min), Math.max(min, Math.min(max, start + spareRoom()))))

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const startX = event.clientX
    const start = current()
    let width: number | undefined
    handle.setPointerCapture(event.pointerId)
    document.documentElement.classList.add('is-resizing')
    const move = (e: PointerEvent) => {
      width = limit(start + (e.clientX - startX) * direction, start)
      pane.set(width)
      setNow(width)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      document.documentElement.classList.remove('is-resizing')
      if (width !== undefined) pane.set(width, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const start = current()
    const step = (event.shiftKey ? 48 : 16) * (event.key === 'ArrowRight' ? 1 : -1) * direction
    const width = limit(start + step, start)
    pane.set(width, true)
    setNow(width)
  }
  const reset = () => { pane.set(undefined, true); setNow(undefined) }

  return <div className="pane-resizer" role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={now ?? Math.round(current())}
    title="끌어서 너비 조절, 두 번 클릭하면 원래대로" onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={reset}/>
}
