'use client'
// Shows, in this robot's tab, the runs somebody else started on it (the fleet manager, another client): a read-only
// subscription to the robot's WS /ws/events. It sends nothing and never starts a run (rule 6). A robot without that route
// refuses the connection: stay silent and retry rarely. Decisions are in lib/foreignRun.ts (tests: scripts/test_fleet.mjs).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { noteOwn, parseEvent, pushEvent, retryDelay, route } from './foreignRun'
import { reduceSteps } from './planSteps'
import type { AgentEvent } from './types'
import type { Step } from '../components/PlanPanel'

export interface ForeignRun { runId: string; ended: boolean }

interface Opts {
  robotUrl: string | undefined                       // reconnect when the tab's robot changes
  ownRunning: () => boolean                          // this tab has its own run in flight
  show: (events: AgentEvent[], steps: Step[]) => void   // draw them like the tab's own run (page.tsx `emit`)
  showImage: (b64: string | null) => void            // the step image (page.tsx `setLogImage`)
}

export function useForeignRun({ robotUrl, ownRunning, show, showImage }: Opts) {
  const own = useRef(new Set<string>())
  const [run, setRun] = useState<ForeignRun | null>(null)
  const cb = useRef({ ownRunning, show, showImage })
  cb.current = { ownRunning, show, showImage }
  /** Call with each event of this tab's own /ws/agent socket: its run is never drawn twice. */
  const noteOwnEvent = useCallback((ev: AgentEvent) => noteOwn(own.current, ev), [])

  useEffect(() => {
    setRun(null)
    if (!robotUrl) return
    let closed = false, ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | null = null, tries = 0
    let current: string | null = null, events: AgentEvent[] = [], steps: Step[] = []
    const retry = () => {
      if (closed) return
      timer = setTimeout(open, retryDelay(tries++))
    }
    const open = () => {
      try { ws = api.eventsWs() } catch { retry(); return }
      ws.onmessage = e => {
        const ev = parseEvent(e.data)
        if (!ev) return
        if (ev.event === 'events_open') { tries = 0; return }
        const r = route(own.current, current, ev, cb.current.ownRunning())
        if (!r.show) return
        if (r.fresh) { current = ev.run_id!; events = []; steps = []; cb.current.showImage(null) }
        events = pushEvent(events, ev)
        steps = reduceSteps(steps, ev)
        if (ev.event === 'step_log') {
          if (ev.log_image) cb.current.showImage(ev.log_image)
          else if (ev.log_image_reset) cb.current.showImage(null)
        }
        cb.current.show(events, steps)
        setRun({ runId: current!, ended: r.ended })
      }
      ws.onclose = () => { ws = null; retry() }
      ws.onerror = () => { /* silent: onclose follows and retries */ }
    }
    open()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; try { ws.close() } catch { /* closed */ } }
    }
  }, [robotUrl])

  return { foreignRun: run, noteOwnEvent }
}
