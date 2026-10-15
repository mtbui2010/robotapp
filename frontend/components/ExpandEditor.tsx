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
  const rows = text.split('\n')
  const lines = rows.length
  const dirty = !readOnly && text !== value

  // Closing keeps the edits (outside click, Esc, Ctrl+S / Ctrl+Enter): an edit
  // was lost every time the modal closed by itself. Only the Discard button
  // throws them away.
  const close = () => { if (dirty) onSave(text); else onClose() }
  const closeRef = useRef(close)
  closeRef.current = close
  // A click on the backdrop closes only when the press started there too:
  // selecting text and letting go outside the box used to close the modal (the
  // browser reports that click on the backdrop).
  const pressedBackdrop = useRef(false)

  // Esc, Ctrl+S, Ctrl+Enter: close, keeping the edits.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const save = (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')
      if (e.key === 'Escape' || save) {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6"
      onMouseDown={e => { pressedBackdrop.current = e.target === e.currentTarget }}
      onClick={e => {
        if (pressedBackdrop.current && e.target === e.currentTarget) close()
        pressedBackdrop.current = false
      }}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col"
        style={{ height: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <span className="text-sm font-medium text-gray-700">
            {title ?? 'Editor'}
            {dirty && <span className="ml-2 text-[11px] font-normal text-amber-600" title="Kept when the editor closes">● edited</span>}
          </span>
          <span className="text-[11px] text-gray-400">{lines} line{lines > 1 ? 's' : ''}</span>
        </div>

        {/* line-number gutter + editor, long lines wrapped. Each line is drawn once more,
            invisible, in a row with its number (same font, padding and wrapping as the
            textarea laid over it), so a number sits on the first row of its wrapped line.
            One scroll container holds both: no scroll syncing. */}
        <div className="flex-1 min-h-0 overflow-auto font-mono text-sm">
          <div className="relative min-h-full">
            <div className="absolute inset-y-0 left-0 w-12 bg-gray-50 border-r border-gray-200" />
            <div className="relative py-2" aria-hidden>
              {rows.map((l, i) => (
                <div key={i} className="flex">
                  <div className="w-12 shrink-0 px-2 text-right leading-6 text-gray-400 select-none">{i + 1}</div>
                  <div className="flex-1 min-w-0 px-3 leading-6 whitespace-pre-wrap break-words invisible">{l || ' '}</div>
                </div>
              ))}
            </div>
            <textarea
              value={text}
              readOnly={readOnly}
              spellCheck={false}
              onChange={e => setText(e.target.value)}
              className="absolute inset-y-0 right-0 left-12 resize-none overflow-hidden bg-transparent px-3 py-2 leading-6 text-gray-800 whitespace-pre-wrap break-words focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-200">
          {!readOnly && (
            <span className="mr-auto text-[11px] text-gray-400">
              Changes are kept when you close (click outside, Esc, Ctrl+S)
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            title={dirty ? 'Close and throw the edits away' : undefined}
            className={`px-3 py-1 text-sm rounded ${dirty ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {dirty ? 'Discard changes' : 'Close'}
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
