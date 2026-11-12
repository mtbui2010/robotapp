'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent } from '../lib/types'
import { buildPlanView, type Row, type PlanGoal } from '../lib/planView'

// The plan of the run as a list that follows the whole conversation (lib/planView.ts): steps pending / running
// (marked) / done (ticked, greyed) / failed; on a replan the not-yet-run part is replaced and a note says why, the
// steps already done stay above it; recoveries splice steps in with their own note; the understood goals and the
// final verdict. Look after the demo videos' right-hand panel (homeloop_live render.py).

const goalText = (g: PlanGoal): string =>
  [g.type, g.object, g.from ? `from ${g.from}` : '', g.to ? `→ ${g.to}` : ''].filter(Boolean).join(' ')

// Same marks as the Log panel's steps: a spinner for the running one
const ICON: Record<string, { ch: string; cls: string }> = {
  done: { ch: '✓', cls: 'text-green-600' },
  failed: { ch: '✗', cls: 'text-red-500' },
  running: { ch: '⟳', cls: 'text-yellow-500 animate-spin' },
  pending: { ch: '○', cls: 'text-gray-300' },
  skipped: { ch: '–', cls: 'text-gray-300' },
}

const secs = (r: { startedAt?: number; endedAt?: number }): string =>
  r.startedAt != null && r.endedAt != null && r.endedAt >= r.startedAt ? `(${((r.endedAt - r.startedAt) / 1000).toFixed(1)}s)` : ''

function RowView({ r, onPick }: { r: Row; onPick?: (seq: number) => void }) {
  if (r.kind === 'note') {
    const style = r.note === 'replan' ? 'text-amber-700 bg-amber-50 border-amber-200'
      : r.note === 'ask' ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
      : 'text-sky-700 bg-sky-50 border-sky-200'
    const tag = r.note === 'replan' ? '↻ replanned' : r.note === 'ask' ? '? asked' : '↳ recovery'
    return (
      <li data-row="note" data-note={r.note} title={r.detail ?? r.text}
        className={`ml-5 text-[10px] leading-snug border rounded px-1.5 py-0.5 ${style}`}>
        <b className="font-medium">{tag}</b> {r.text}
      </li>
    )
  }
  return <StepRow r={r} onPick={onPick} />
}

// One task: at most 2 lines, a longer one ends with "…" and has a ⤢ toggle to read it whole (the full text is also the tooltip
// and is in the Log). A click on the row shows the step in the Log; the toggle does not.
function StepRow({ r, onPick }: { r: Extract<Row, { kind: 'step' }>; onPick?: (seq: number) => void }) {
  const ic = ICON[r.status]
  const dur = secs(r)
  const pick = r.seq != null && onPick ? () => onPick(r.seq!) : undefined
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const textRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = textRef.current
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [r.label, r.reason, r.index, open])
  const stepTag = r.index != null && r.status !== 'pending' ? `Step ${r.index}${r.total != null ? `/${r.total}` : ''}: ` : ''
  return (
    <li data-row="step" data-status={r.status} data-spliced={r.spliced ? '1' : undefined} data-seq={r.seq}
      onClick={pick} title={`${stepTag}${r.label}${r.reason ? ` — ${r.reason}` : ''}`}
      className={`flex items-start gap-3 ${pick ? 'cursor-pointer hover:bg-gray-100 rounded' : ''}`}>
      <span className={`text-sm leading-5 flex-shrink-0 ${ic.cls}`}>{ic.ch}</span>
      <div className="flex-1 min-w-0">
        <div ref={textRef} data-testid="step-text" className={open ? '' : 'line-clamp-2'}>
          {stepTag && <span className="text-xs text-gray-500">{stepTag}</span>}
          <span className={`text-sm font-mono [overflow-wrap:anywhere] ${
            r.status === 'pending' ? 'text-gray-500' : r.status === 'skipped' ? 'text-gray-300 line-through' : 'text-gray-900'}`}>
            {r.spliced ? '↳ ' : r.retry ? '↻ ' : ''}{r.label}
          </span>
          {dur && <span className="text-[10px] text-gray-400 ml-1">{dur}</span>}
        </div>
        {r.status === 'failed' && r.reason && <div className={`text-[10px] text-red-500 ${open ? '' : 'truncate'}`}>{r.reason}</div>}
      </div>
      {(clipped || open) && (
        <button type="button" data-testid="step-expand" onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          title={open ? 'collapse to 2 lines' : 'show the whole text'}
          className="flex-shrink-0 text-[11px] leading-5 text-gray-400 hover:text-blue-600">{open ? '⤡' : '⤢'}</button>
      )}
    </li>
  )
}

export default function PlanList({ events, running, onPick }: { events: AgentEvent[]; running: boolean; onPick?: (seq: number) => void }) {
  // no verdict and no run any more (Stop, lost socket): close the view as stopped
  const ended = !running && events.length > 0 && !events.some(e => e.event === 'done' || e.event === 'error')
  const v = useMemo(() => buildPlanView(ended ? [...events, { event: 'stopped', msg: 'stopped before the end', _rx: Date.now() }] : events), [events, ended])
  const steps = v.rows.filter(r => r.kind === 'step')
  const nDone = steps.filter(r => r.kind === 'step' && r.status === 'done').length
  const now = steps.find(r => r.kind === 'step' && r.status === 'running')
  const nowLabel = now && now.kind === 'step' ? now.label : ''
  const listRef = useRef<HTMLOListElement>(null)
  // keep the step being run in view when the list is longer than its box
  useEffect(() => {
    listRef.current?.querySelector('[data-status="running"]')?.scrollIntoView({ block: 'nearest' })
  }, [v.rows.length, nowLabel])
  if (!steps.length && !v.goals.length && !v.final && !v.rows.length) return null
  return (
    <div data-testid="plan-list" className="bg-gray-50 border border-gray-200 rounded p-3 flex flex-col gap-2" style={{ zoom: 0.8 }}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400 uppercase">Plan progress</p>
        {steps.length > 0 && <span className="text-[10px] text-gray-400">{nDone}/{steps.length} done</span>}
      </div>
      {nowLabel && (
        <p data-testid="plan-now" className="text-[11px] text-blue-800 font-mono bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 [overflow-wrap:anywhere]">
          <span className="text-blue-500 uppercase text-[9px] mr-1">now</span>{nowLabel}
        </p>
      )}
      {v.goals.length > 0 && (
        <p className="text-[10px] text-gray-500" data-testid="plan-goals">
          <span className="uppercase text-gray-400">goals </span>{v.goals.map(goalText).join(' · ')}
        </p>
      )}
      {v.rows.length > 0 && (
        <ol ref={listRef} data-testid="plan-scroll" className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
          {v.rows.map(r => <RowView key={r.id} r={r} onPick={onPick} />)}
        </ol>
      )}
      {v.goalChecks.length > 0 && (
        <div className="text-[10px] text-gray-500">
          {v.goalChecks.map((g, i) => (
            <div key={i} title={g.evidence}>{g.ok ? '✓' : '✗'} goal {goalText(g.goal)}{g.evidence ? ` — ${g.evidence}` : ''}</div>
          ))}
        </div>
      )}
      {v.final && (
        <div data-testid="plan-final" data-ok={v.final.ok ? '1' : '0'}
          className={`text-[11px] px-2 py-1 rounded border ${v.final.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {v.final.ok ? (v.final.status === 'planned' ? '✓ Planned' : '✓ Succeeded') : v.final.status === 'stopped' ? '■ Stopped' : '✗ Failed'}
          {v.final.msg ? ` — ${v.final.msg}` : ''}
        </div>
      )}
    </div>
  )
}
