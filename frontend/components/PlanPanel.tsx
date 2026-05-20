'use client'
import { useState } from 'react'
import type { AgentEvent } from '../lib/types'

export interface StepLog {
  data: Record<string, unknown>
  image?: string
  ts: number
}

export interface Step {
  index: number
  total: number
  task: string
  status: 'running' | 'done' | 'failed'
  result?: Record<string, unknown>
  logs?: StepLog[]
}

const SHORT_THRESHOLD = 80

function JsonLine({ value, color = 'text-gray-400' }: { value: Record<string, unknown>; color?: string }) {
  const [expanded, setExpanded] = useState(false)
  const short = JSON.stringify(value)
  if (short.length <= SHORT_THRESHOLD) {
    return <div className={`text-[11px] ${color} font-mono`}>{short}</div>
  }
  return (
    <div>
      {expanded ? (
        <pre className={`text-[11px] ${color} font-mono whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto bg-gray-100 rounded px-2 py-1`}>
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <span className={`text-[11px] ${color} font-mono`}>{short.slice(0, SHORT_THRESHOLD)}…</span>
      )}
      <button
        onClick={() => setExpanded(v => !v)}
        className="text-[10px] text-blue-400 hover:text-blue-600 ml-1"
      >
        {expanded ? '▴ collapse' : '▾ expand'}
      </button>
    </div>
  )
}

function StepResult({ result }: { result: Record<string, unknown> }) {
  return <div className="mt-0.5"><JsonLine value={result} /></div>
}

function StepLogs({ logs }: { logs: StepLog[] }) {
  return (
    <div className="mt-1 flex flex-col gap-0.5 border-l border-gray-300 pl-2">
      {logs.map((l, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="text-[10px] text-blue-400 leading-4 flex-shrink-0">▸</span>
          <div className="flex-1 min-w-0">
            <JsonLine value={l.data} color="text-gray-500" />
            {l.image && <span className="text-[10px] text-blue-400">[log_image → camera]</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

const stepIcon = (s: Step['status']) =>
  s === 'running' ? '⟳' : s === 'done' ? '✓' : '✗'

const stepColor = (s: Step['status']) =>
  s === 'running' ? 'text-yellow-500'
  : s === 'done'    ? 'text-green-600'
  : 'text-red-500'

interface Props {
  events: AgentEvent[]
  steps: Step[]
}

export default function PlanPanel({ events, steps }: Props) {
  const plan   = events.find(e => e.event === 'plan')?.plan
  const status = events.find(e => e.event === 'status')?.msg
  const done   = events.find(e => e.event === 'done')
  const error  = events.find(e => e.event === 'error')

  const empty = !plan && steps.length === 0 && !done && !error && !status

  return (
    <div className="flex flex-col gap-3 h-full">
      <p className="text-[11px] text-gray-400 uppercase tracking-wide">Task Plan &amp; Execution</p>

      {empty && (
        <p className="text-xs text-gray-400 text-center mt-6">No task running</p>
      )}

      {/* Status */}
      {status && !plan && (
        <p className="text-xs text-gray-500 flex items-center gap-2">
          <span className="animate-pulse">●</span>{status}
        </p>
      )}

      {/* Task plan */}
      {plan && (
        <div className="bg-gray-50 border border-gray-200 rounded p-3">
          <p className="text-[11px] text-gray-400 uppercase mb-2">Plan</p>
          <pre className="text-sm text-green-700 whitespace-pre-wrap leading-relaxed">{plan}</pre>
        </div>
      )}

      {/* Execution timeline */}
      {steps.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded p-3 flex flex-col gap-2 flex-1 overflow-y-auto">
          <p className="text-[11px] text-gray-400 uppercase mb-1">
            Execution — {steps.length} step{steps.length > 1 ? 's' : ''}
          </p>
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className={`text-sm leading-5 flex-shrink-0 ${stepColor(step.status)} ${
                step.status === 'running' ? 'animate-spin' : ''
              }`}>
                {stepIcon(step.status)}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-gray-500">Step {step.index}/{step.total}: </span>
                <span className="text-sm text-gray-900 font-mono">{step.task}</span>
                {step.logs && step.logs.length > 0 && <StepLogs logs={step.logs} />}
                {step.result && <StepResult result={step.result} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Done */}
      {done && (
        <div className={`text-xs px-3 py-2 rounded border ${
          done.success
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-600'
        }`}>
          {done.success ? '✓ Task completed' : '✗ Task failed'}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-600">
          <p className="font-semibold mb-1">Error: {error.msg}</p>
          {error.trace && (
            <pre className="text-red-400 text-[10px] overflow-x-auto">{error.trace}</pre>
          )}
        </div>
      )}
    </div>
  )
}
