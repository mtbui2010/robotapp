'use client'
import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../lib/types'
import type { PlannerMethod } from '../lib/planner'
import type { ChatState } from '../lib/chatMic'

// The one chat card (top-bar 💬 Chat): a two-way conversation with task planning.
//   idle     a message starts a NEW RUN of that text (unstructured command, SAGE planner)
//   running  the robot is executing: the input is disabled (hint), Stop is live
//   waiting  the robot asked (a `listen` is pending): a message is the ANSWER
//            (POST /agent/listen/<id>, the same path as a spoken answer)
// The typed box is present in every state and works in voice mode too. Robot lines
// show as bubbles whether or not 🔊 is on. Semantics: docs/features/chat.md.

export interface ChatLine { who: 'robot' | 'user' | 'system'; text: string; kind?: 'say' }

const HELP = 'Type a task ("put the apple on the counter") and the robot plans and runs it; when the robot asks '
  + 'something, your next message is the answer. The 🎤 button listens for a new command only while the robot is idle '
  + 'and silent. One robot should have ONE client driving it: a second client (CLI, another browser) is unsafe, '
  + 'and Stop / Cancel stops both.'

export default function ChatPanel({
  log, state, lang, onLang, planner, onPlanner, planOnly, onPlanOnly,
  handsFree, onHandsFree, micSupported, micListening, micNote,
  onSend, onStop, onReset, canStop, canType, lost, stuck, onClear, onClose,
}: {
  log: ChatLine[]
  state: ChatState
  lang: Lang
  onLang: (l: Lang) => void
  planner: PlannerMethod
  onPlanner: (p: PlannerMethod) => void
  planOnly: boolean
  onPlanOnly: (v: boolean) => void
  handsFree: boolean
  onHandsFree: (v: boolean) => void
  micSupported: boolean
  micListening: boolean      // the hands-free recogniser is open right now
  micNote: string            // why the mic is off / paused (shown under the input), '' = nothing
  onSend: (text: string) => void
  onStop: () => void
  onReset: () => void        // hard reset: always works (docs/features/chat.md, Stop and Reset)
  canStop: boolean           // a run may still be alive on the backend (also after the socket dropped)
  canType: boolean
  lost: boolean              // idle, but the last run never got its `done`
  stuck: boolean             // stopping for more than a few seconds: offer Force reset
  onClear: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [log.length])
  // focus when the chat can take a message again (asked / finished)
  useEffect(() => { if (canType) inputRef.current?.focus() }, [state, canType])

  const send = () => {
    const t = draft.trim()
    if (!t || !canType) return
    onSend(t)
    setDraft('')
  }
  const status = state === 'stopping' ? (stuck ? 'no confirmation from the robot' : 'stopping… waiting for the robot to confirm')
    : state === 'idle' && lost ? 'connection to the run lost; it may still be going: Stop / reset'
    : state === 'idle' ? 'idle: type or say a task'
    : state === 'running' ? 'working…'
    : handsFree ? 'waiting for your answer (speak or type)' : 'waiting for your answer (type it; the mic is off)'
  const dot = state === 'stopping' ? 'bg-red-500 animate-pulse' : state === 'idle' && lost ? 'bg-red-400' : state === 'idle' ? 'bg-gray-300' : state === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'

  return (
    <div data-testid="chat-card"
      className="fixed bottom-4 right-4 z-40 w-96 max-w-[calc(100vw-2rem)] bg-white border border-gray-300 rounded-lg shadow-lg flex flex-col text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <span className="font-medium text-gray-700">💬 Chat</span>
        <span title={HELP} className="cursor-help text-[11px] text-gray-400 border border-gray-300 rounded-full w-4 h-4 inline-flex items-center justify-center">?</span>
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <button onClick={onStop} data-testid="chat-stop"
          title="Cancel every command in flight on the robot and end the run (stops every client driving this robot)"
          className="ml-auto px-2 py-0.5 text-[11px] rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-40"
          disabled={!canStop}>
          {state === 'stopping' ? '■ Stopping…' : '■ Stop'}
        </button>
        <button onClick={onReset} data-testid="chat-reset"
          title="Reset: cancel, drop the run, every pending question, the speech and the mic capture, and make the chat idle again. Works even when the robot does not answer."
          className="text-[11px] text-gray-500 hover:text-gray-800 underline decoration-dotted">reset</button>
        <button onClick={onClear} title="Clear the conversation (log only)" className="text-[11px] text-gray-400 hover:text-gray-700">clear</button>
        <button onClick={onClose} title={state === 'idle' && !lost ? 'Close' : 'Hide (the run keeps going)'}
          className="text-gray-400 hover:text-gray-700 leading-none">×</button>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 text-[11px] text-gray-600 flex-wrap">
        <select value={planner} onChange={e => onPlanner(e.target.value as PlannerMethod)} disabled={state !== 'idle'}
          title="Planner for the next command"
          className="bg-white border border-gray-300 rounded px-1 py-0.5 disabled:opacity-50">
          <option value="sage" title="SAGE plans; the assist layer understands the task first (asks when unclear, reads it back, refuses unsafe) and guards every step">SAGE + assist</option>
          <option value="grace" title="SAGE planner in the plain closed loop (no understanding / clarification layer)">SAGE plain loop</option>
          <option value="direct">Direct</option>
        </select>
        <select value={lang} onChange={e => onLang(e.target.value as Lang)} disabled={state !== 'idle'}
          title="Language of the robot's speech and of what it hears"
          className="bg-white border border-gray-300 rounded px-1 py-0.5 disabled:opacity-50">
          <option value="ko">KO</option>
          <option value="en">EN</option>
        </select>
        <label data-testid="chat-plan-only" title={planOnly ? 'ON: the robot only PLANS the command, it does not move' : 'OFF: the robot executes the plan (it moves)'}
          className={`flex items-center gap-1 cursor-pointer px-1.5 py-0.5 rounded border ${planOnly ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-red-50 border-red-300 text-red-700'}`}>
          <input type="checkbox" checked={planOnly} onChange={e => onPlanOnly(e.target.checked)} disabled={state !== 'idle'} className="accent-amber-600" />
          plan only{planOnly ? '' : ' — will move'}
        </label>
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2 h-64 max-h-[40vh] overflow-y-auto" data-testid="chat-log">
        {log.length === 0 && <span className="text-[11px] text-gray-400">Say or type a task for the robot, e.g. &ldquo;Please put the apple on the counter.&rdquo;</span>}
        {log.map((l, i) => l.who === 'system'
          ? <div key={i} className="self-center text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-0.5">{l.text}</div>
          : (
          <div key={i} data-who={l.who} className={`max-w-[85%] px-2 py-1 rounded text-[13px] leading-snug ${
            l.who === 'robot'
              ? (l.kind === 'say' ? 'self-start bg-gray-50 text-gray-500 italic text-[12px]' : 'self-start bg-gray-100 text-gray-800')
              : 'self-end bg-indigo-600 text-white'}`}>
            {l.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div data-testid="chat-status" className="px-3 py-1 border-t border-gray-100 text-[11px] text-gray-500 flex items-center gap-1.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />{status}
        {stuck && (
          <button onClick={onReset} data-testid="chat-force-reset"
            className="ml-auto px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-white font-medium whitespace-nowrap">Force reset</button>
        )}
        {micListening && <span className="ml-auto text-red-600 animate-pulse">🎤 listening…</span>}
      </div>
      <div className="flex gap-1.5 px-2 pb-1">
        <button onClick={() => onHandsFree(!handsFree)} disabled={!micSupported} data-testid="chat-mic"
          title={micSupported
            ? (handsFree ? 'Hands-free ON: listens for a new command only while idle and after the robot stops speaking. Click to turn off.'
                         : 'Hands-free OFF. Click to listen for a new command by voice (only while idle, never while the robot speaks).')
            : 'This browser has no speech recognition'}
          className={`px-2 py-1 text-xs rounded border ${handsFree ? 'bg-red-50 border-red-300 text-red-600' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'} disabled:opacity-40`}>
          🎤
        </button>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          disabled={!canType}
          data-testid="chat-input"
          placeholder={state === 'waiting' ? (handsFree ? 'type your answer (or speak)' : 'type your answer') : state === 'idle' ? 'type a task, e.g. put the apple on the counter' : state === 'stopping' ? 'stopping…' : 'robot is working…'}
          className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-[13px] focus:outline-none focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button onClick={send} disabled={!canType || !draft.trim()} data-testid="chat-send"
          className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40">
          Send
        </button>
      </div>
      <p className="px-3 pb-1.5 text-[10px] text-gray-400 leading-snug">
        {micNote ? <span className="text-amber-600">{micNote} · </span> : null}
        One client per robot: a second client driving it is unsafe, and Cancel stops both.
      </p>
    </div>
  )
}
