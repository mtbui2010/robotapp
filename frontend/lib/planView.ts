// Plan view of one run: the list the Task Plan panel shows. Pure reducer over the
// agent events (no React), so it is tested against recorded event files
// (scripts/test_lib.mjs, scripts/fixtures/events).
//
// Model (from real SAGE + assist logs):
//   - `plan`    lists the steps (pending).
//   - `step_start` / `step_done` run one step; `index` is the position in the
//     CURRENT list and is reused after a splice, so rows are matched by order,
//     never by index.
//   - `replan`  (at_index) replaces the not-yet-run part with `plan`; the failed
//     step stays above as a history row.
//   - `recover` (search_leg / second_look / retry / relook / asked / phantom)
//     splices steps in place: the steps that start next and are not in the list
//     are marked "spliced" and do not consume the list, until the step that
//     failed starts again (its retry).
//   - `done` / `error` end the run; a client-side `stopped` ends it when the operator pressed Stop.
// Durations: an event may carry `_rx`, the client's receive time (set in page.tsx, never in recorded files);
// a row has startedAt / endedAt only when both events had it.
// Invariant: rows = settled rows (done / failed / running / notes) first, then
// the pending rows; a new running row is inserted at that boundary.
import type { AgentEvent } from './types'

export type RowStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export interface StepRow {
  kind: 'step'
  id: number
  label: string
  status: RowStatus
  index?: number            // position the backend reported (informational)
  spliced?: boolean         // inserted by a recovery, not part of a plan
  retry?: boolean           // the failed step run again after a recovery
  reason?: string           // why it failed
  say?: string              // the robot's one-line narration of the step
  total?: number            // step_start's `total` (informational)
  seq?: number              // order of start in this run: the k-th started step is the k-th Execution/Log step
  startedAt?: number        // client receive time (`_rx`) of step_start; unknown without it
  endedAt?: number          // client receive time of step_done / the run's end
}
export interface NoteRow {
  kind: 'note'
  id: number
  note: 'replan' | 'recover' | 'ask' | 'plan'
  text: string
  detail?: string           // the full reason (the text may be shortened)
}
export type Row = StepRow | NoteRow
export interface PlanGoal { type?: string; object?: string; from?: string; to?: string }
export interface GoalCheck { goal: PlanGoal; ok: boolean; evidence: string }
export interface PlanView {
  rows: Row[]
  goals: PlanGoal[]
  understood?: { status: string; reason: string; question: string | null }
  goalChecks: GoalCheck[]
  final: { ok: boolean; status: string; msg: string } | null
  // reconcile state
  nextId: number
  started: number          // steps started so far (next `seq`)
  splice: boolean           // a recovery is running: steps not in the list are spliced
  failedLabel: string       // label of the last failed step (its retry ends the splice)
  noteNext?: NoteRow        // recovery note to insert before the next started step
}

export const emptyPlanView = (): PlanView => ({
  rows: [], goals: [], goalChecks: [], final: null, nextId: 1, started: 0, splice: false, failedLabel: '',
})

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')
const labelOf = (ev: AgentEvent): string => {
  if (ev.action) return clean([ev.action, ev.object].filter(Boolean).join(' '))
  return clean(String(ev.task ?? '')).replace(/->/g, ' → ')
}
const isOk = (ev: AgentEvent): boolean =>
  ev.status != null ? (ev.status === 'success' || ev.status === 'planned')
    : ev.success === true || (ev.result as { isdone?: unknown } | undefined)?.isdone === true

// 'MoveTo side_table@living' -> label as the step_start gives it ("MoveTo side_table@living").
const planLines = (ev: AgentEvent): string[] => {
  const steps = ev.steps
  if (Array.isArray(steps) && steps.length) {
    return steps.map(s => {
      const o = (s ?? {}) as { action?: string; object?: string }
      return clean([o.action, o.object].filter(Boolean).join(' '))
    }).filter(Boolean)
  }
  const text = typeof ev.plan_text === 'string' && ev.plan_text.trim() ? ev.plan_text
    : typeof ev.plan === 'string' ? ev.plan : ''
  return text.split('\n').map(l => clean(l.replace(/^\s*\d+[.)]\s*/, ''))).filter(Boolean)
}

const firstPending = (rows: Row[]): number => {
  const i = rows.findIndex(r => r.kind === 'step' && r.status === 'pending')
  return i < 0 ? rows.length : i
}
const short = (s: string, n = 150) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function withPending(v: PlanView, labels: string[]): PlanView {
  let id = v.nextId
  const kept = v.rows.filter(r => !(r.kind === 'step' && r.status === 'pending'))
  const pending: StepRow[] = labels.map(label => ({ kind: 'step', id: id++, label, status: 'pending' }))
  return { ...v, rows: [...kept, ...pending], nextId: id }
}

export function reducePlan(v: PlanView, ev: AgentEvent): PlanView {
  switch (ev.event) {
    case 'start':
      return emptyPlanView()
    case 'understand': {
      const goals = Array.isArray(ev.goals) ? ev.goals as PlanGoal[] : v.goals
      return { ...v, goals, understood: { status: String(ev.status ?? ''), reason: String(ev.reason ?? ''), question: (ev.question as string | null) ?? null } }
    }
    case 'clarify': {
      const q = clean(String(ev.question ?? ev.msg ?? ''))
      if (!q) return v
      const note: NoteRow = { kind: 'note', id: v.nextId, note: 'ask', text: q }
      const at = firstPending(v.rows)
      return { ...v, nextId: v.nextId + 1, rows: [...v.rows.slice(0, at), note, ...v.rows.slice(at)] }
    }
    case 'plan': {
      const labels = planLines(ev)
      return labels.length ? withPending(v, labels) : v
    }
    case 'replan': {
      const labels = (Array.isArray(ev.plan) ? ev.plan as unknown[] : []).map(p => clean(String(p))).filter(Boolean)
      const reason = clean(String(ev.reason ?? ev.msg ?? 'replanned'))
      const note: NoteRow = { kind: 'note', id: v.nextId, note: 'replan', text: short(reason), detail: reason }
      const base = withPending({ ...v, nextId: v.nextId + 1 }, [])
      const at = firstPending(base.rows)
      const rows = [...base.rows.slice(0, at), note, ...base.rows.slice(at)]
      return withPending({ ...base, rows }, labels)
    }
    case 'recover': {
      const text = clean(String(ev.msg ?? ev.kind ?? 'recovering'))
      return { ...v, splice: true,
        noteNext: { kind: 'note', id: -1, note: 'recover', text: short(text), detail: `${ev.kind ?? ''}: ${text}` } }
    }
    case 'step_start': {
      let label = labelOf(ev)
      let rows = v.rows
      let id = v.nextId
      let spliced = false, retry = false, splice = v.splice
      if (splice) {
        if (label === v.failedLabel) { retry = true; splice = false } else spliced = true
      } else {
        let k = rows.findIndex(r => r.kind === 'step' && r.status === 'pending' && r.label === label)
        // Structured (legacy) runs: the plan is text lines ("say::inputs='hi'") while step_start carries a Python list
        // ("[['say', \"inputs='hi'\"]]"): the labels never match, so the step takes the next pending line, by order.
        if (k < 0 && !ev.action) {
          k = rows.findIndex(r => r.kind === 'step' && r.status === 'pending')
          if (k >= 0) label = (rows[k] as StepRow).label
        }
        if (k >= 0) rows = [...rows.slice(0, k), ...rows.slice(k + 1)]
      }
      const at = firstPending(rows)
      const ins: Row[] = []
      if (v.noteNext) ins.push({ ...v.noteNext, id: id++ })
      const row: StepRow = { kind: 'step', id: id++, label, status: 'running',
        index: ev.index ?? ev.step, ...(spliced ? { spliced } : {}), ...(retry ? { retry } : {}),
        ...(ev.say ? { say: ev.say } : {}), seq: v.started,
        ...(ev.total != null ? { total: ev.total } : {}), ...(ev._rx != null ? { startedAt: ev._rx } : {}) }
      ins.push(row)
      return { ...v, rows: [...rows.slice(0, at), ...ins, ...rows.slice(at)], nextId: id, started: v.started + 1, splice, noteNext: undefined }
    }
    case 'step_done': {
      let k = -1
      for (let i = v.rows.length - 1; i >= 0; i--) {
        const r = v.rows[i]
        if (r.kind === 'step' && r.status === 'running') { k = i; break }
      }
      if (k < 0) return v
      const ok = isOk(ev)
      const row = v.rows[k] as StepRow
      const res = (ev.result ?? {}) as { msg?: unknown }
      const reason = ok ? undefined : String(ev.reason ?? res.msg ?? '') || undefined
      const rows = v.rows.slice()
      rows[k] = { ...row, status: ok ? 'done' : 'failed', ...(reason ? { reason } : {}), ...(ev._rx != null ? { endedAt: ev._rx } : {}) }
      return { ...v, rows, failedLabel: ok ? v.failedLabel : row.label }
    }
    case 'goal_check': {
      const g = (ev.goal ?? {}) as PlanGoal
      return { ...v, goalChecks: [...v.goalChecks, { goal: g, ok: ev.ok === true, evidence: String(ev.evidence ?? '') }] }
    }
    case 'stopped':       // client side: the run was ended (Stop / socket closed) without a `done`
    case 'done':
    case 'error': {
      const ok = ev.event === 'done' && isOk(ev)
      const status = ev.event === 'error' ? 'error' : ev.event === 'stopped' ? 'stopped' : String(ev.status ?? (ok ? 'success' : 'failed'))
      const rows = v.rows.map((r): Row => {
        if (r.kind !== 'step') return r
        if (r.status === 'running') return { ...r, status: ok ? 'done' : 'failed', ...(ev._rx != null ? { endedAt: ev._rx } : {}) }
        if (r.status === 'pending') return { ...r, status: 'skipped' }
        return r
      })
      return { ...v, rows, splice: false, noteNext: undefined,
        final: { ok, status, msg: String(ev.msg ?? '') } }
    }
    default:
      return v
  }
}

export function buildPlanView(events: AgentEvent[]): PlanView {
  return events.reduce(reducePlan, emptyPlanView())
}
