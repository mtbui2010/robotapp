// Small pure helpers of a dashboard run (moved out of app/page.tsx so the page does not grow).
import type { AgentEvent } from './types'
import type { RunHandles } from './robotSessions'

// Filename-safe prefix from a task string, e.g. 'find::apple' → 'find_apple'.
export const sanitizeTask = (t: string): string =>
  (t || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'task'

// Sequentially download a base64 JPEG to the browser Downloads folder.
export const downloadJpeg = (b64: string, name: string): void => {
  const a = document.createElement('a')
  a.href = `data:image/jpeg;base64,${b64}`
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
}

// Mirrors the backend's failure test (unified_agent._is_failure_event): a step
// returning isdone False, a run-level error, or a SAGE symbolic violation.
export const isFailureEvent = (ev: AgentEvent): boolean => {
  if (ev.event === 'error') return true
  if (ev.event === 'step_done') {
    if (ev.status === 'failed') return true
    if (ev.result && (ev.result as { isdone?: unknown }).isdone === false) return true
  }
  if (ev.event === 'done') {
    return ev.status != null ? !(ev.status === 'success' || ev.status === 'planned') : ev.success === false
  }
  if (ev.event === 'plan_step' && ev.phase === 'verified' && ev.ok === false) return true
  if (ev.event === 'plan_step' && Array.isArray(ev.violations) && ev.violations.length > 0) return true
  if (ev.event === 'replan') return true
  return false
}

// ── per-session HRI queue and timers (state lives in the session's RunHandles) ──
export const stopNudge = (h: RunHandles): void => { if (h.nudge) { clearInterval(h.nudge); h.nudge = null } }

/** A new run and a Reset start a new EPOCH: jobs of an older epoch that have not started are dropped and cannot hold the queue. */
export const newHriEpoch = (h: RunHandles): void => { h.epoch++; h.chain = Promise.resolve(); h.busy = 0; h.speechUntil = 0 }

/** Speak / listen / alarm jobs of one robot's run, strictly in order. */
export const enqueueHri = (h: RunHandles, job: () => Promise<void>): void => {
  const ep = h.epoch
  h.busy++
  h.chain = h.chain.then(() => ep === h.epoch ? job() : undefined).catch(() => {}).finally(() => {
    if (ep !== h.epoch) return          // a Reset / new run zeroed the counter
    h.busy--
    h.speechUntil = Math.max(h.speechUntil, Date.now())   // spoken to the end just now
  })
}
