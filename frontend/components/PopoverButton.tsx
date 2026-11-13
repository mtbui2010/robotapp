'use client'
import { useEffect, useRef, useState } from 'react'

// A small button that opens a popover under it. The popover is `position: fixed` (placed from the button's rectangle), so no
// overflow-hidden / scrolling parent clips it; it closes on a click outside, Escape, a resize or a scroll.
// `children` is a function so an item can close the popover: children(close).
export default function PopoverButton({ label, title, buttonClass, panelClass, testId, children }: {
  label: React.ReactNode
  title?: string
  buttonClass?: string
  panelClass?: string                       // width etc. of the panel (default w-48)
  testId?: string
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [open])

  const toggle = () => {
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - 260)), top: r.bottom + 4 })
    setOpen(o => !o)
  }

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} title={title} data-testid={testId}
        className={buttonClass ?? 'px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 whitespace-nowrap'}>
        {label}
      </button>
      {open && (
        <div ref={pop} style={{ position: 'fixed', left: pos.left, top: pos.top }} data-testid={testId ? `${testId}-panel` : undefined}
          className={`z-50 bg-white border border-gray-300 rounded shadow-lg p-1.5 text-[11px] text-gray-700 whitespace-normal ${panelClass ?? 'w-48'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </>
  )
}
