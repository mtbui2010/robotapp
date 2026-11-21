// How one run event changes the plan's step list (step_start / step_done / step_log). Pure; used by the tab's own run
// (app/page.tsx) and by a run started by someone else (lib/useForeignRun.ts), so both draw the same rows.
import type { Step } from '../components/PlanPanel'
import type { AgentEvent } from './types'

export function reduceSteps(steps: Step[], ev: AgentEvent, now: number = Date.now()): Step[] {
  if (ev.event === 'step_start') {
    // SAGE events carry `index` / `action` / `object` instead of `step` / `total` / `task`
    const stepNo = ev.step ?? ev.index
    return [...steps, {
      index: stepNo!,
      total: ev.total!,
      task: ev.task ?? [ev.action, ev.object].filter(Boolean).join(' '),
      status: 'running' as const,
      startedAt: now,
    }]
  }
  if (ev.event === 'step_done') {
    const doneNo = ev.step ?? ev.index      // SAGE: `index`, reused after a recovery splice → the running row
    let hit = -1
    steps.forEach((s, i) => { if (s.index === doneNo && s.status === 'running') hit = i })
    return steps.map((s, i) =>
      i === hit
        ? { ...s, status: (ev.result?.isdone ? 'done' : 'failed') as Step['status'], result: ev.result, endedAt: now }
        : s
    )
  }
  if (ev.event === 'step_log') {
    const entry = { data: ev.data ?? {}, image: ev.log_image ?? undefined, ts: ev.ts ?? now / 1000 }
    return steps.map(s => (s.index === ev.step ? { ...s, logs: [...(s.logs ?? []), entry] } : s))
  }
  return steps
}
