'use client'
import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import type { PlannerPrompt } from '../lib/types'
import { PLANNER_EVENT, storedPlanner } from '../lib/planner'

const PLANNER_LABEL: Record<string, string> = { sage: 'SAGE + assist', grace: 'SAGE (plain loop)', direct: 'Direct' }

// Read-only view of the Direct planner's prompt for a command (GET /planner/prompt).
// The backend builds it from the robot's manifest (skills, description, planner.notes),
// the ENV places and the most similar example plans each time it plans; nothing here is
// stored or edited. SAGE builds its own prompts: the panel says so for that choice.
export default function PlannerPromptPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [collapsed, setCollapsed] = useState(true)
  const [planner,   setPlanner]   = useState('')
  const [command,   setCommand]   = useState('')
  const [result,    setResult]    = useState<PlannerPrompt | null>(null)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')

  // the planner chosen in the Agent panel (stored + live changes)
  useEffect(() => {
    setPlanner(storedPlanner())
    const on = (e: Event) => setPlanner(String((e as CustomEvent).detail || storedPlanner()))
    window.addEventListener(PLANNER_EVENT, on)
    return () => window.removeEventListener(PLANNER_EVENT, on)
  }, [])

  // another robot / location: the shown prompt is stale
  useEffect(() => { setResult(null) }, [refreshKey])

  const show = async () => {
    if (!command.trim()) return
    setBusy(true); setError('')
    try {
      setResult(await api.plannerPrompt(command.trim(), planner || undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the prompt')
    } finally { setBusy(false) }
  }

  const plannerName = PLANNER_LABEL[result?.planner ?? ''] ?? result?.planner ?? ''

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setCollapsed(c => !c)} className="text-gray-600 text-[10px] w-3 text-left">
          {collapsed ? '▸' : '▾'}
        </button>
        <h2 className="font-semibold text-gray-800 flex-1">Planner prompt</h2>
        <span className="text-[10px] text-gray-400" title="Built by the backend from the robot each time it plans">read-only</span>
      </div>

      {!collapsed && (
        <div className="border border-gray-200 rounded bg-white p-2 flex flex-col gap-2">
          <p className="text-[10px] text-gray-500">
            What the Direct planner sends to the LLM for a command: the robot and its skills (manifest), the places,
            the robot&apos;s notes and the most similar example plans. Change it in the robot&apos;s manifest
            (<code>planner.notes</code>, skill descriptions) or its seed pool, not here.
          </p>
          <div className="flex items-center gap-1.5">
            <input value={command} onChange={e => setCommand(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') show() }}
              placeholder="command, e.g. Bring the cup to the sofa"
              className="flex-1 min-w-0 bg-white border border-gray-300 text-gray-800 text-[11px] rounded px-1.5 py-1" />
            <button type="button" onClick={show} disabled={busy || !command.trim()}
              className="px-2 py-1 border border-gray-300 hover:border-blue-400 disabled:opacity-40 text-gray-700 rounded text-[10px]">
              Show
            </button>
          </div>
          {result && !result.uses_prompt && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              The selected planner ({plannerName}) does not use this prompt: SAGE builds its own prompts from the
              robot&apos;s manifest. It applies to the Direct planner (Agent panel → Direct).
            </p>
          )}
          {result && (
            <>
              {result.examples.length > 0 && (
                <span className="text-[10px] text-gray-500">
                  examples: {result.examples.map(e => e.task).join(' | ')}
                </span>
              )}
              <textarea readOnly value={result.prompt} rows={14} spellCheck={false}
                className="font-mono text-[10px] bg-gray-50 border border-gray-200 rounded px-2 py-1.5 resize-y" />
            </>
          )}
          {error && <span className="text-[10px] text-red-500">⚠ {error}</span>}
        </div>
      )}
    </div>
  )
}
