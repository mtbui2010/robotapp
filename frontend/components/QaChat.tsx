'use client'
import { useEffect, useRef, useState } from 'react'

// Conversation card of the visual Q&A (top-bar 💬 Q&A). Shows what the robot
// said and what it heard or was typed, and — in text mode — the box the user
// types the question into while the `qa` skill waits for it (a `listen` event
// with mode 'text'). The typed line goes back through the same
// POST /agent/listen/<id> as a transcript from the browser mic.

export interface QaLine { who: 'robot' | 'user'; text: string }

export default function QaChat({
  log, mode, waiting, active, onSend, onClose,
}: {
  log: QaLine[]
  mode: 'voice' | 'text'
  waiting: boolean          // the skill is waiting for a typed question
  active: boolean           // the Q&A run is going
  onSend: (text: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [log.length])
  useEffect(() => { if (waiting) inputRef.current?.focus() }, [waiting])

  const send = () => {
    const t = draft.trim()
    if (!t || !waiting) return
    onSend(t)
    setDraft('')
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-300 rounded-lg shadow-lg flex flex-col text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <span className="font-medium text-gray-700">💬 Q&A</span>
        <span className="text-[10px] text-gray-500">{mode === 'text' ? '⌨ text' : '🎤 voice'}</span>
        {active
          ? <span className="text-[10px] text-emerald-600">● live</span>
          : <span className="text-[10px] text-gray-400">ended</span>}
        <button onClick={onClose} title={active ? 'Hide (the conversation keeps going)' : 'Close'}
          className="ml-auto text-gray-400 hover:text-gray-700 leading-none">×</button>
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2 max-h-72 overflow-y-auto">
        {log.length === 0 && <span className="text-[11px] text-gray-400">…</span>}
        {log.map((l, i) => (
          <div key={i} className={`max-w-[85%] px-2 py-1 rounded text-[13px] leading-snug ${
            l.who === 'robot' ? 'self-start bg-gray-100 text-gray-800' : 'self-end bg-indigo-600 text-white'}`}>
            {l.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {mode === 'text' && active && (
        <div className="flex gap-1.5 px-2 py-2 border-t border-gray-200">
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
            disabled={!waiting}
            placeholder={waiting ? '질문을 입력하세요 · type a question' : 'robot is busy…'}
            className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-[13px] focus:outline-none focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button onClick={send} disabled={!waiting || !draft.trim()}
            className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40">
            Send
          </button>
        </div>
      )}
    </div>
  )
}
