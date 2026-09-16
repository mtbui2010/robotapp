'use client'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ExpandEditor } from './ExpandEditor'
import type { AgentEvent, WorldState, LlmInfo } from '../lib/types'

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
  startedAt?: number
  endedAt?: number
}

const SHORT_THRESHOLD = 80

function CopyBtn({ value }: { value: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const text = JSON.stringify(value, null, 2)
    navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }
  return (
    <button
      onClick={copy}
      title="Copy result to clipboard"
      className="text-[10px] text-blue-400 hover:text-blue-600 ml-1"
    >
      {copied ? 'copied ✓' : '⎘ copy'}
    </button>
  )
}

function JsonLine({ value, color = 'text-gray-400', copyable = false }: { value: Record<string, unknown>; color?: string; copyable?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const short = JSON.stringify(value)
  if (short.length <= SHORT_THRESHOLD) {
    return (
      <div className={`text-[11px] ${color} font-mono`}>
        {short}
        {copyable && <CopyBtn value={value} />}
      </div>
    )
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
      {copyable && <CopyBtn value={value} />}
    </div>
  )
}

function StepResult({ result }: { result: Record<string, unknown> }) {
  return <div className="mt-0.5"><JsonLine value={result} copyable /></div>
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

// ── World state ───────────────────────────────────────────
function ageHint(since: number | null): string | null {
  if (since == null) return null
  // `holding_since` is a unix timestamp in seconds.
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - since))
  if (secs < 60) return `held ${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `held ${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `held ${hrs}h ago`
}

const splitList = (s: string): string[] =>
  s.split(',').map(x => x.trim()).filter(Boolean)

interface WorldDraft {
  arrived: string
  found: string
  holding: string
  opened: string
  on: string
}

const toDraft = (w: WorldState): WorldDraft => ({
  arrived: w.arrived ?? '',
  found:   w.found ?? '',
  holding: w.holding ?? '',
  opened:  w.opened.join(', '),
  on:      w.on.join(', '),
})

function WorldStateBlock({ events }: { events: AgentEvent[] }) {
  // Latest world snapshot carried on an event (task_start/plan/step_done/replan/done).
  const eventWorld = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].world) return events[i].world as WorldState
    }
    return null
  })()

  const [world, setWorld] = useState<WorldState | null>(null)
  const [draft, setDraft] = useState<WorldDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showRaw, setShowRaw] = useState(false)
  const [collapsed, setCollapsed] = useState(true)

  // Fetch current world on mount (idle / before any run).
  useEffect(() => {
    let cancelled = false
    api.getWorld()
      .then(w => { if (!cancelled) setWorld(prev => prev ?? w) })
      .catch(() => { /* backend may not expose world yet */ })
    return () => { cancelled = true }
  }, [])

  // Prefer the latest event world when present; it always wins (closed-loop truth).
  useEffect(() => {
    if (eventWorld) setWorld(eventWorld)
  }, [eventWorld])

  // Seed / refresh the inputs from `world` unless the user is mid-edit.
  useEffect(() => {
    if (world && !dirty) setDraft(toDraft(world))
  }, [world, dirty])

  if (!world || !draft) return null

  const set = (k: keyof WorldDraft, v: string) => {
    setDraft(d => (d ? { ...d, [k]: v } : d))
    setDirty(true)
    setSaveState('idle')
  }

  const save = async () => {
    if (!draft) return
    // Only send changed fields.
    const patch: Partial<WorldState> = {}
    const arrived = draft.arrived.trim() || null
    const found   = draft.found.trim() || null
    const holding = draft.holding.trim() || null
    const opened  = splitList(draft.opened)
    const on      = splitList(draft.on)
    if (arrived !== world.arrived) patch.arrived = arrived
    if (found   !== world.found)   patch.found = found
    if (holding !== world.holding) patch.holding = holding
    if (JSON.stringify(opened) !== JSON.stringify(world.opened)) patch.opened = opened
    if (JSON.stringify(on)     !== JSON.stringify(world.on))     patch.on = on
    if (Object.keys(patch).length === 0) {
      setDirty(false)
      return
    }
    setSaveState('saving')
    try {
      const updated = await api.setWorld(patch)
      setWorld(updated)
      setDraft(toDraft(updated))
      setDirty(false)
      setSaveState('saved')
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1500)
    } catch {
      setSaveState('idle')
    }
  }

  const age = ageHint(world.holding_since)
  const fp = (world.found_pose ?? null) as Record<string, unknown> | null
  const hp = (world.holding_pose ?? null) as Record<string, unknown> | null
  const fmtNums = (v: unknown): string =>
    Array.isArray(v)
      ? '[' + v.map(n => (typeof n === 'number' ? n.toFixed(3) : String(n))).join(', ') + ']'
      : String(v)

  const field = (label: string, k: keyof WorldDraft, hint?: string | null) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-400 flex items-center gap-1">
        {label}
        {hint && <span className="text-gray-400 normal-case">· {hint}</span>}
      </span>
      <input
        value={draft[k]}
        onChange={e => set(k, e.target.value)}
        onBlur={save}
        className="text-xs font-mono bg-white border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-blue-300"
      />
    </label>
  )

  // Compact one-line summary shown while collapsed.
  const summary = [
    world.arrived && `@${world.arrived}`,
    world.holding && `holding ${world.holding}`,
    world.found && `found ${world.found}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-1.5 min-w-0"
        >
          <span className="text-gray-600 text-[10px] w-3 text-left">{collapsed ? '▸' : '▾'}</span>
          <span className="text-[11px] text-gray-400 uppercase">Robot State</span>
          {collapsed && summary && (
            <span className="text-[10px] text-gray-400 font-mono truncate">{summary}</span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {saveState === 'saving' && <span className="text-[10px] text-gray-400">saving…</span>}
          {saveState === 'saved' && <span className="text-[10px] text-green-600">saved</span>}
          {!collapsed && dirty && saveState !== 'saving' && (
            <button
              onClick={save}
              className="text-[10px] text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1.5 py-0.5"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {!collapsed && (<>
      <div className="grid grid-cols-2 gap-2 mt-2">
        {field('arrived', 'arrived')}
        {field('holding', 'holding', age)}
        {field('found', 'found')}
        {field('opened (csv)', 'opened')}
        {field('on (csv)', 'on')}
      </div>

      {/* Geometric memory of the found object — read-only, flagged stale once
          the base has moved away from the detection spot. */}
      {fp && (
        <div className="mt-2 border-t border-gray-200 pt-1.5 text-[10px] font-mono text-gray-500">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="uppercase text-gray-400">found pose</span>
            {world.found_pose_stale
              ? <span className="text-amber-600">⚠ stale (robot moved — re-detect before grasp)</span>
              : <span className="text-green-600">fresh</span>}
          </div>
          {fp.loc_3d != null && <div>loc_3d: {fmtNums(fp.loc_3d)}</div>}
          {fp.grasppose != null && <div>grasp: {fmtNums(fp.grasppose)}</div>}
        </div>
      )}

      {/* Grasp actually used to pick the held object — read-only history. */}
      {hp && (
        <div className="mt-2 border-t border-gray-200 pt-1.5 text-[10px] font-mono text-gray-500">
          <div className="uppercase text-gray-400 mb-0.5">holding pose</div>
          {hp.grasppose != null && <div>grasp: {fmtNums(hp.grasppose)}</div>}
          {hp.robot_pose != null && <div>picked at: {fmtNums(hp.robot_pose)}</div>}
        </div>
      )}

      {/* Full state — everything, verbatim. */}
      <div className="mt-2 border-t border-gray-200 pt-1.5">
        <button
          onClick={() => setShowRaw(v => !v)}
          className="text-[10px] text-blue-400 hover:text-blue-600"
        >
          {showRaw ? '▴ raw' : '▾ raw'}
        </button>
        {showRaw && (
          <pre className="mt-1 text-[10px] font-mono text-gray-500 whitespace-pre-wrap break-all bg-white border border-gray-200 rounded p-1.5 max-h-56 overflow-y-auto">
            {JSON.stringify(world, null, 2)}
          </pre>
        )}
      </div>
      </>)}
    </div>
  )
}

interface Props {
  events: AgentEvent[]
  steps: Step[]
  planMethod?: string   // 'grace' | 'direct' — planner used by the active run
}

// ── GRACE planning trace ──────────────────────────────────
// Reconstructs the per-sub-goal planning detail from the streamed `plan_step`
// events (decompose → expand → refine → verify) so the operator can see the
// concrete plan under each sub-goal, which steps violated symbolic
// preconditions, and how each refine pass changed the steps.
interface StepLite { action?: string; object?: string }
interface Violation { index?: number; code?: string; reason?: string; action?: string; object?: string; severity?: string }
interface SubgoalTrace {
  index: number
  subgoal: string
  initialSteps: StepLite[]   // task sequence from the first expansion (pre-refine)
  steps: StepLite[]          // final committed task sequence
  ok: boolean | null
  violations: Violation[]
  refines: { attempt: number; violations: Violation[]; steps: StepLite[] }[]
}

const asSteps = (v: unknown): StepLite[] =>
  Array.isArray(v) ? v.map(s => ({ action: (s as StepLite)?.action, object: (s as StepLite)?.object })) : []
const asViolations = (v: unknown): Violation[] =>
  Array.isArray(v) ? (v as Violation[]) : []

function buildTraces(events: AgentEvent[]): SubgoalTrace[] {
  const byIdx = new Map<number, SubgoalTrace>()
  const ensure = (i: number, sg?: string): SubgoalTrace => {
    let t = byIdx.get(i)
    if (!t) { t = { index: i, subgoal: sg ?? '', initialSteps: [], steps: [], ok: null, violations: [], refines: [] }; byIdx.set(i, t) }
    if (sg && !t.subgoal) t.subgoal = sg
    return t
  }
  for (const e of events) {
    if (e.event !== 'plan_step') continue
    const i = e.index ?? -1
    switch (e.phase) {
      case 'decompose':
        (e.subgoals ?? []).forEach((sg, k) => ensure(k, sg))
        break
      case 'expand':
        if (i >= 0) ensure(i, e.subgoal)
        break
      case 'expanded':
        if (i >= 0) {
          const t = ensure(i, e.subgoal)
          t.initialSteps = asSteps(e.steps)
          t.steps = t.initialSteps
        }
        break
      case 'refine':
        if (i >= 0) ensure(i, e.subgoal).refines.push({ attempt: e.attempt ?? 0, violations: asViolations(e.violations), steps: [] })
        break
      case 'refined': {
        if (i < 0) break
        const t = ensure(i, e.subgoal)
        const r = t.refines.find(x => x.attempt === (e.attempt ?? 0))
        if (r) r.steps = asSteps(e.steps); else t.refines.push({ attempt: e.attempt ?? 0, violations: [], steps: asSteps(e.steps) })
        t.steps = asSteps(e.steps)
        break
      }
      case 'verified': {
        if (i < 0) break
        const t = ensure(i, e.subgoal)
        t.ok = e.ok ?? null
        t.violations = asViolations(e.violations)
        if (Array.isArray(e.steps) && e.steps.length) t.steps = asSteps(e.steps)
        break
      }
    }
  }
  return [...byIdx.values()].sort((a, b) => a.index - b.index)
}

const stepStr = (s: StepLite) => [s.action, s.object].filter(Boolean).join(' ')

function ViolationList({ items }: { items: Violation[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      {items.map((v, k) => (
        <div key={k} className="text-[10px] text-red-600 font-mono">
          ⚠ step {(v.index ?? 0) + 1}: [{v.code}] {v.reason}
          {(v.action || v.object) ? ` (${[v.action, v.object].filter(Boolean).join(' ')})` : ''}
        </div>
      ))}
    </div>
  )
}

function GracePlanningTrace({ events }: { events: AgentEvent[] }) {
  const [open, setOpen] = useState(false)
  const traces = buildTraces(events)
  if (traces.length === 0) return null
  const totalViol = traces.reduce((n, t) => n + (t.ok === false ? t.violations.length : 0), 0)
  const allOk = traces.every(t => t.ok !== false)

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-2 text-[11px]">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 w-full text-left">
        <span className="text-gray-600 text-[10px] w-3">{open ? '▾' : '▸'}</span>
        <span className="text-gray-400 uppercase">GRACE planning trace</span>
        <span className="text-gray-400">— {traces.length} sub-goal{traces.length > 1 ? 's' : ''}</span>
        <span className={`ml-auto text-[10px] px-1 py-0.5 rounded border ${
          allOk ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'
        }`}>
          {allOk ? '✓ verified' : `⚠ ${totalViol} violation${totalViol > 1 ? 's' : ''}`}
        </span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {traces.map(t => {
            const initial = t.initialSteps.length ? t.initialSteps : t.steps
            return (
            <div key={t.index} className="border-l-2 border-gray-200 pl-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-700 font-medium">{t.index + 1}. {t.subgoal || '(sub-goal)'}</span>
                {t.ok === true && <span className="text-[10px] text-green-600">✓ verified</span>}
                {t.ok === false && <span className="text-[10px] text-red-600">⚠ {t.violations.length} violation{t.violations.length > 1 ? 's' : ''}</span>}
                {t.refines.length > 0 && <span className="text-[10px] text-amber-600">refined ×{t.refines.length}</span>}
              </div>

              {/* Initial task sequence (first expansion) */}
              {initial.length > 0 && (
                <div className="mt-0.5">
                  <div className="text-[10px] text-gray-400 uppercase">{t.refines.length > 0 ? 'task sequence (initial)' : 'task sequence'}</div>
                  <div className="mt-0.5 flex flex-col gap-0.5 font-mono text-[10px] text-gray-600">
                    {initial.map((s, k) => <div key={k}>{k + 1}. {stepStr(s) || '—'}</div>)}
                  </div>
                </div>
              )}

              {/* Refinement passes: what violated → the corrected sequence */}
              {t.refines.map((r, k) => (
                <div key={k} className="mt-1 border-t border-gray-100 pt-1">
                  <div className="text-[10px] text-amber-600 uppercase">refine #{r.attempt} — fixed violations:</div>
                  <ViolationList items={r.violations} />
                  {r.steps.length > 0 && (
                    <>
                      <div className="mt-0.5 text-[10px] text-gray-400 uppercase">→ sequence after refine</div>
                      <div className="mt-0.5 flex flex-col gap-0.5 font-mono text-[10px] text-gray-500">
                        {r.steps.map((s, j) => <div key={j}>{j + 1}. {stepStr(s) || '—'}</div>)}
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/* Violations still remaining after the last refine */}
              {t.ok === false && (
                <div className="mt-1 border-t border-gray-100 pt-1">
                  <div className="text-[10px] text-red-600 uppercase">remaining violations</div>
                  <ViolationList items={t.violations} />
                </div>
              )}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

function PlannerMeta({ meta }: { meta: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const extra = (meta.extra ?? {}) as Record<string, unknown>
  const subgoals = (extra.subgoals as string[]) ?? []
  const n = (v: unknown) => (typeof v === 'number' ? v : undefined)
  const llmCalls = n(meta.llm_calls)
  const refines = n(extra.refines)
  const latency = n(meta.latency_s)
  const head = [
    subgoals.length ? `${subgoals.length} sub-goals` : '',
    llmCalls != null ? `${llmCalls} LLM calls` : '',
    latency != null ? `${latency.toFixed(1)}s` : '',
  ].filter(Boolean).join(' · ')
  if (!head && !subgoals.length) return null
  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-2 text-[10px] text-gray-500">
      <button onClick={() => setOpen(o => !o)} className="text-blue-400 hover:text-blue-600">
        {open ? '▾' : '▸'} planner steps{head ? ` — ${head}` : ''}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5 font-mono">
          {subgoals.map((sg, i) => <div key={i}>{i + 1}. {sg}</div>)}
          {refines != null && <div className="text-gray-400">refines: {refines}</div>}
        </div>
      )}
    </div>
  )
}

export default function PlanPanel({ events, steps, planMethod }: Props) {
  // Plan block: full (uncapped) by default; unchecking collapses it to ~4 lines.
  const [planFull, setPlanFull] = useState(true)
  // The 'plan' event differs by path: legacy/direct sends `plan` (a string),
  // the closed-loop (GRACE) sends `steps` (an array of {action, object}). Render
  // either — otherwise a GRACE plan never shows and "Generating…" stays stuck.
  const planEv = events.find(e => e.event === 'plan')
  const plan: string | undefined =
    // Prefer the kcare `skill::inputs` text the robot actually runs; then the
    // legacy/direct `plan` string; finally a formatted view of GRACE steps.
    typeof planEv?.plan_text === 'string' && planEv.plan_text.trim()
      ? planEv.plan_text
      : typeof planEv?.plan === 'string'
        ? planEv.plan
        : Array.isArray(planEv?.steps)
          ? (planEv!.steps as Array<{ action?: string; object?: string }>)
              .map((s, i) => `${i + 1}. ${[s.action, s.object].filter(Boolean).join(' ')}`)
              .join('\n')
          : undefined
  const status = events.find(e => e.event === 'status')?.msg
  const done   = events.find(e => e.event === 'done')
  const error  = events.find(e => e.event === 'error')

  const [llm, setLlm] = useState<LlmInfo | null>(null)
  // Fetch on mount, then refetch at the start of each run — the active LLM is
  // often chosen/changed after this panel mounts, so a one-time mount fetch goes
  // stale (empty), which is why the model/URL beside "Generating task plan…"
  // disappeared. `startCount` bumps on every new run (events reset then a 'start'
  // event arrives), giving us the currently-effective LLM config each time.
  const startCount = events.reduce((n, e) => (e.event === 'start' ? n + 1 : n), 0)
  useEffect(() => {
    let cancelled = false
    api.getLlmConfig().then(c => { if (!cancelled) setLlm(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [startCount])

  // Latest live planner-progress step (GRACE multi-step).
  const lastStep = (() => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].event === 'plan_step') return events[i]
    return undefined
  })()
  const planMeta = planEv?.plan_meta as Record<string, unknown> | undefined

  const empty = !plan && steps.length === 0 && !done && !error && !status

  // Show the steps newest-first (current step on top, right under the "Execution"
  // header) so the active step is always visible without any auto-scroll — earlier
  // steps sit below and the user scrolls down to read them. This keeps every
  // surrounding panel (camera, plan, robot state) completely still.
  const stepsView = [...steps].reverse()

  // Two backends, two shapes: the closed-loop (GRACE) sends `status`
  // ('success'|'failed'|'planned'|'aborted'); run_direct / legacy `run` send a
  // boolean `success`. Prefer `status` when present, else fall back to `success`.
  const ok = done?.status != null
    ? (done.status === 'success' || done.status === 'planned')
    : done?.success === true
  const doneBadge = done && (
    <span className={`text-[11px] px-2 py-0.5 rounded border ${
      ok
        ? 'bg-green-50 border-green-200 text-green-700'
        : 'bg-red-50 border-red-200 text-red-600'
    }`}>
      {ok ? '✓ Task completed' : '✗ Task failed'}
      {done.elapsed_ms != null ? ` · ${(done.elapsed_ms / 1000).toFixed(1)}s` : ''}
    </span>
  )

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide">Task Plan &amp; Execution</p>
        <div className="flex items-center gap-1.5 min-w-0">
          {planMethod && (
            <span className="text-[10px] font-mono uppercase px-1 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">
              {planMethod}
            </span>
          )}
          {(llm?.model || llm?.url || llm?.name) && (
            <span className="text-[10px] text-gray-400 font-mono truncate" title={llm?.url || ''}>
              LLM: {llm?.model || llm?.name || '?'}{llm?.url ? ` @ ${llm.url.replace(/^https?:\/\//, '')}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Robot world state (editable, persistent) */}
      <WorldStateBlock events={events} />

      {empty && (
        <p className="text-xs text-gray-400 text-center mt-6">No task running</p>
      )}

      {/* Status — while generating the plan, show which model/server is being called */}
      {status && !plan && (
        <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
          <span className="animate-pulse">●</span>{status}
          {/task plan/i.test(status) && planMethod && (
            <span className="text-[10px] font-mono uppercase px-1 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">
              {planMethod}
            </span>
          )}
          {/task plan/i.test(status) && (llm?.model || llm?.name || llm?.url) && (
            <span className="text-[10px] text-gray-400 font-mono" title={llm?.url || ''}>
              {llm?.model || llm?.name || '?'}{llm?.url ? ` @ ${llm.url.replace(/^https?:\/\//, '')}` : ''}
            </span>
          )}
        </p>
      )}

      {/* Live multi-step planner progress (GRACE) — so a long plan never looks hung */}
      {lastStep && !plan && (
        <p className="text-[11px] text-gray-500 flex items-center gap-2 font-mono">
          <span className="animate-pulse">▸</span>
          {lastStep.phase === 'decompose'
            ? `decompose → ${(lastStep.subgoals ?? []).length} sub-goals`
            : lastStep.phase === 'expand'
              ? `expand ${(lastStep.index ?? 0) + 1}/${lastStep.total ?? '?'}: ${lastStep.subgoal ?? ''}`
              : lastStep.phase === 'refine'
                ? `refine ${(lastStep.index ?? 0) + 1}: ${lastStep.subgoal ?? ''}`
                : String(lastStep.phase ?? '')}
        </p>
      )}

      {/* Task plan */}
      {plan && (
        <div className="bg-gray-50 border border-gray-200 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-gray-400 uppercase">Plan</p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer"
                title="Show the full plan, or collapse it to ~4 lines with scroll">
                <input type="checkbox" checked={planFull}
                  onChange={e => setPlanFull(e.target.checked)} className="accent-blue-600" />
                full
              </label>
              <ExpandEditor
                value={plan}
                readOnly
                title="Plan"
                className="text-[11px] leading-none text-gray-400 hover:text-blue-600"
              />
            </div>
          </div>
          <pre className={`text-sm text-green-700 whitespace-pre-wrap leading-relaxed ${planFull ? '' : 'max-h-24 overflow-y-auto'}`}>{plan}</pre>
        </div>
      )}

      {/* Multi-step planner breakdown (post-hoc) */}
      {plan && planMeta && <PlannerMeta meta={planMeta} />}

      {/* GRACE per-sub-goal plan / violations / refine trace */}
      <GracePlanningTrace events={events} />

      {/* Execution timeline */}
      {steps.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded p-3 flex flex-col gap-2 flex-1 min-h-0">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-400 uppercase">
              Execution — {steps.length} step{steps.length > 1 ? 's' : ''}
            </p>
            {doneBadge}
          </div>
          <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
          {stepsView.map((step) => (
            <div key={step.index} className="flex items-start gap-3">
              <span className={`text-sm leading-5 flex-shrink-0 ${stepColor(step.status)} ${
                step.status === 'running' ? 'animate-spin' : ''
              }`}>
                {stepIcon(step.status)}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-gray-500">Step {step.index}/{step.total}: </span>
                <span className="text-sm text-gray-900 font-mono">{step.task}</span>
                {step.startedAt != null && step.endedAt != null && (
                  <span className="text-[10px] text-gray-400 ml-1">({((step.endedAt - step.startedAt) / 1000).toFixed(1)}s)</span>
                )}
                {step.logs && step.logs.length > 0 && <StepLogs logs={step.logs} />}
                {step.result && <StepResult result={step.result} />}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* Done — when there are no steps, the badge has no header to ride on, so
          show it on its own row. With steps it appears in the Execution header. */}
      {done && steps.length === 0 && (
        <div>{doneBadge}</div>
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
