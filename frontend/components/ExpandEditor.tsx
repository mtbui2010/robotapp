'use client'
import { useEffect, useRef, useState } from 'react'

// A small ⤢ button that opens a large modal editor with a line-number gutter,
// so long multi-line content (e.g. a ~20-step plan preset) is easy to read and
// edit. Editable when `onChange` is given; read-only otherwise (view a plan).

function EditorModal({
  title, value, readOnly, onClose, onSave,
}: {
  title?: string
  value: string
  readOnly: boolean
  onClose: () => void
  onSave: (v: string) => void
}) {
  const [text, setText] = useState(value)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const lines = text.length ? text.split('\n').length : 1

  // Keep the line-number gutter aligned with the textarea while scrolling.
  const onScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
  }

  // Esc closes the modal.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col"
        style={{ height: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <span className="text-sm font-medium text-gray-700">{title ?? 'Editor'}</span>
          <span className="text-[11px] text-gray-400">{lines} line{lines > 1 ? 's' : ''}</span>
        </div>

        {/* line-number gutter + editor (no wrap → one line = one row, gutter aligns) */}
        <div className="flex-1 min-h-0 flex font-mono text-sm">
          <div
            ref={gutterRef}
            className="overflow-hidden text-right text-gray-400 bg-gray-50 border-r border-gray-200 px-2 py-2 select-none"
            style={{ minWidth: '3rem' }}
          >
            {Array.from({ length: lines }, (_, i) => (
              <div key={i} className="leading-6">{i + 1}</div>
            ))}
          </div>
          <textarea
            value={text}
            readOnly={readOnly}
            wrap="off"
            spellCheck={false}
            onChange={e => setText(e.target.value)}
            onScroll={onScroll}
            className="flex-1 min-h-0 resize-none px-3 py-2 leading-6 text-gray-800 focus:outline-none overflow-auto"
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
          >
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onSave(text)}
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ExpandEditor({
  value, onChange, title, readOnly = false, className = '',
}: {
  value: string
  onChange?: (v: string) => void
  title?: string
  readOnly?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={readOnly ? 'Expand to view' : 'Expand editor'}
        className={className || 'text-[10px] text-gray-400 hover:text-blue-600'}
      >
        ⤢
      </button>
      {open && (
        <EditorModal
          title={title}
          value={value}
          readOnly={readOnly || !onChange}
          onClose={() => setOpen(false)}
          onSave={v => { onChange?.(v); setOpen(false) }}
        />
      )}
    </>
  )
}
