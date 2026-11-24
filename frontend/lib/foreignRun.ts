// Runs started by someone else on this robot (the fleet manager, another client), seen on the robot's read-only
// WS /ws/events. Pure decisions only (no socket): which events to show, which run is ours, when to retry.
import type { AgentEvent } from './types'

/** Events of /ws/events that are not run events to draw (the hello, the refusal of a message, the run manager's notices). */
const NOT_DRAWN = new Set(['events_open', 'refused', 'run_state', 'run_refused', 'run_attached', 'duplicate'])
/** Keep the newest events only: a long run must not grow the tab without limit. */
export const MAX_EVENTS = 1000
/** Delay before reconnect number n (0, 1, ...): 5, 10, 20, 40, then every 60 s. Rare on purpose: a robot without /ws/events refuses every time. */
export function retryDelay(n: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, n))
}

export function parseEvent(raw: unknown): AgentEvent | null {
  if (typeof raw !== 'string') return null
  try {
    const ev = JSON.parse(raw)
    return ev && typeof ev === 'object' && typeof ev.event === 'string' ? (ev as AgentEvent) : null
  } catch { return null }
}

/** Remember the run id of an event this tab got on its own /ws/agent socket (every run event carries `run_id`). */
export function noteOwn(own: Set<string>, ev: { run_id?: unknown }): void {
  if (typeof ev.run_id === 'string' && ev.run_id) own.add(ev.run_id)
}

export interface Routed {
  show: boolean        // draw this event
  fresh: boolean       // it is the first event of a run not shown before: start the view from empty
  ended: boolean       // the run ended with it (done / error)
}
const NO: Routed = { show: false, fresh: false, ended: false }

/** Decide what to do with one /ws/events event.
 *  `own`: run ids this tab started or attached to; `current`: the foreign run now shown (or null);
 *  `ownRunning`: this tab has a run in flight, whose own socket draws it (nothing else may draw meanwhile). */
export function route(own: ReadonlySet<string>, current: string | null, ev: AgentEvent, ownRunning: boolean): Routed {
  if (NOT_DRAWN.has(ev.event)) return NO
  const id = ev.run_id
  if (typeof id !== 'string' || !id || own.has(id)) return NO
  const ended = ev.event === 'done' || ev.event === 'error'
  // while our own run draws, nothing is drawn, but the end of the foreign run already on screen is still noted (`ended` with
  // `show` false), so the badge and the Continue guard cannot go stale
  if (ownRunning) return ended && id === current ? { show: false, fresh: false, ended: true } : NO
  return { show: true, fresh: id !== current, ended }
}

/** Append, keeping the newest MAX_EVENTS. */
export function pushEvent(events: AgentEvent[], ev: AgentEvent): AgentEvent[] {
  const next = [...events, ev]
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
}
