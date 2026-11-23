// Small pure helpers of a dashboard run (moved out of app/page.tsx so the page does not grow).
import type { AgentEvent } from './types'
import { newHandles, type RunHandles } from './robotSessions'

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

/** True while one session's own speech / listen jobs run (or just ended). The hands-free mic of the SHOWN robot asks only its session. */
export const handleBusy = (h: RunHandles, now: number): boolean => h.busy > 0 || now < h.speechUntil

/** The url a session uses: the registry's, or (no robot registered) the legacy default agent url the caller names. Pure, no HTTP. */
export const sessionUrl = (url: string | null | undefined, fallback: string): string => url || fallback

/** The browser has one mic. A caller may end the capture when nobody owns it or it is the owner (`same` resolves renamed keys). */
export const micMayEnd = (owner: string | null, caller: string, same: (a: string, b: string) => boolean): boolean =>
  owner === null || same(owner, caller)

// ── run closures hold an immutable id, not the registry name ──
// A name can be renamed or reused while a run is live; the id of a robot's handles never changes. `sid:<id>` stands for "the robot whose handles carry it".
const SID = 'sid:'
/** The stable token of a registry key (creates its handles); a token stays itself. */
export const stableKey = (hs: Record<string, RunHandles>, key: string): string => key.startsWith(SID) ? key : SID + (hs[key] ??= newHandles()).sid
/** The registry key a token names now (it follows renames); `gone:<token>` (no session) when the robot left. A plain key stays itself. */
export const resolveKey = (hs: Record<string, RunHandles>, key: string): string =>
  !key.startsWith(SID) ? key : Object.keys(hs).find(k => hs[k].sid === key.slice(SID.length)) ?? `gone:${key}`
/** Applies a reconcile result to the handles: dropped ones are closed, renamed ones move to the new name (a stale handle there is closed). */
export function moveHandles(hs: Record<string, RunHandles>, r: { dropped: string[]; renamed: [string, string][] }, close: (h: RunHandles) => void): void {
  for (const k of r.dropped) if (hs[k]) { close(hs[k]); delete hs[k] }
  for (const [from, to] of r.renamed) {
    if (hs[to]) { close(hs[to]); delete hs[to] }
    if (hs[from]) { hs[to] = hs[from]; delete hs[from] }
  }
}
