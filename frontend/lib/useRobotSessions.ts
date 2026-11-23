'use client'
// React glue of the per-robot sessions (lib/robotSessions.ts): the store in a ref (safe inside sockets and timers that live for minutes)
// mirrored into state (re-renders), one RunHandles per key, the stop-timeout per session, a close-the-tab guard while a run is going.
// Design: docs/proposals/per_robot_sessions.md section 3.2.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { moveHandles, resolveKey, stableKey } from './runHelpers'
import { STOP_TIMEOUT_MS, type RunEvent } from './chatRun'
import {
  EMPTY_STORE, applyRun, newHandles, newSession, patch, reconcile, select, shownOf, statusOf, syncUrls, update, type Listed,
  type RobotSession, type RunHandles, type SessionKey, type SessionStore,
} from './robotSessions'

const closeHandles = (h: RunHandles): void => {
  if (h.nudge) clearInterval(h.nudge)
  if (h.stopTimer) clearTimeout(h.stopTimer)
  h.nudge = null; h.stopTimer = null; h.repeat.active = false; h.textAsk?.(null)
  const ws = h.ws
  h.ws = null
  if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; try { ws.close() } catch { /* closed */ } }
}

export function useRobotSessions() {
  const [store, setStore] = useState<SessionStore>(EMPTY_STORE)
  const ref = useRef<SessionStore>(store)
  const hs = useRef<Record<SessionKey, RunHandles>>({})
  const robots = useRef<Listed[]>([])
  const canon = useCallback((key: SessionKey): SessionKey => resolveKey(hs.current, key), [])   // a stable token (a run closure) -> the registry key now
  const stable = useCallback((key: SessionKey): SessionKey => stableKey(hs.current, key), [])

  /** Synchronous: the ref first (the next `get` sees it), then the render. */
  const apply = useCallback((f: (st: SessionStore) => SessionStore) => {
    const next = f(ref.current)
    if (next === ref.current) return
    ref.current = next
    setStore(next)
  }, [])
  const put = useCallback((key: SessionKey, f: (s: RobotSession) => RobotSession) => apply(st => update(st, canon(key), f)), [apply, canon])
  const set = useCallback((key: SessionKey, p: Partial<Omit<RobotSession, 'key'>>) => apply(st => patch(st, canon(key), p)), [apply, canon])
  const dispatch = useCallback((key: SessionKey, e: RunEvent) => apply(st => applyRun(st, canon(key), e)), [apply, canon])
  const get = useCallback((key: SessionKey): RobotSession => ref.current.sessions[canon(key)] ?? newSession(key, ''), [canon])
  const getStore = useCallback(() => ref.current, [])
  const shownKey = useCallback(() => ref.current.shown ?? '', [])
  const sameKey = useCallback((a: SessionKey, b: SessionKey) => canon(a) === canon(b), [canon])
  /** The session of the robot the tab shows (created blank by the first pick; no HTTP, no run). */
  const choose = useCallback((key: SessionKey, url: string) => apply(st => {
    const next = select(st, key, url)
    return next.shown === st.shown && next.sessions === st.sessions ? st : next
  }), [apply])
  const handles = useCallback((key: SessionKey): RunHandles => {
    const k = canon(key)
    return k.startsWith('gone:') ? newHandles() : (hs.current[k] ??= newHandles())   // a left robot: detached handles, nothing is kept
  }, [canon])
  /** Like `apply`, for a run closure: `f` gets the registry key the token names now. */
  const applyAt = useCallback((key: SessionKey, f: (st: SessionStore, k: SessionKey) => SessionStore) => apply(st => f(st, canon(key))), [apply, canon])

  /** Called with the registry list: drops the sessions of removed robots (closes the socket, best-effort cancel at the frozen url), moves the session
   *  of a renamed running robot to its new name, and points idle sessions at the urls their robots have now. */
  const reconcileRobots = useCallback((list: Listed[]) => {
    const before = robots.current
    robots.current = list
    const r = reconcile(ref.current, list, before)
    for (const k of r.dropped) {
      const s = ref.current.sessions[k]
      if (s && statusOf(s) !== 'idle') api.cancelRunAt(s.url).catch(() => {})
    }
    moveHandles(hs.current, r, closeHandles)
    apply(() => syncUrls(r.store, list))
  }, [apply])
  useEffect(() => { apply(st => syncUrls(st, robots.current)) }, [store.sessions, apply])   // a run ended: its session takes the url its robot has now

  // the stop timer is per session: a stopping background run must offer "Force reset" too
  useEffect(() => {
    for (const [k, s] of Object.entries(store.sessions)) {
      const h = hs.current[k]
      if (!h) continue
      if (s.run.phase === 'stopping' && !h.stopTimer) h.stopTimer = setTimeout(() => { h.stopTimer = null; dispatch(k, { t: 'timeout' }) }, STOP_TIMEOUT_MS)
      else if (s.run.phase !== 'stopping' && h.stopTimer) { clearTimeout(h.stopTimer); h.stopTimer = null }
    }
  }, [store, dispatch])

  // closing the tab ends every run (the backend cancels a run whose socket closes): ask first while any session runs
  const anyRunning = Object.values(store.sessions).some(s => statusOf(s) !== 'idle')
  useEffect(() => {
    if (!anyRunning) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [anyRunning])
  useEffect(() => () => { Object.values(hs.current).forEach(closeHandles) }, [])

  return { store, shown: shownOf(store), get, getStore, shownKey, put, set, apply, applyAt, stable, dispatch, choose, handles, reconcileRobots, sameKey }
}
