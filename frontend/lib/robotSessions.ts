// Per-robot sessions inside one tab (pure: no React, no HTTP, no storage, no clock). Tested in scripts/test_sessions.mjs.
// A session is plain data; the store maps a key to a session and names the one that is shown. Design: docs/proposals/per_robot_sessions.md.
// The wrong-target Cancel is impossible by construction: `cancelTarget` reads the SHOWN session and returns its frozen url.
import { INITIAL_RUN, runReduce, type RunEvent, type RunState } from './chatRun'
import type { AgentEvent } from './types'
import type { ChatLine } from '../components/ChatPanel'
import type { Step } from '../components/PlanPanel'
import type { RobotLanguages } from './robotLanguages'

/** 'robot:<registry name>' | 'fleet:<fleet name>' = the drop-down's <option value>. */
export type SessionKey = string
export const robotKey = (name: string): SessionKey => `robot:${name}`
export const fleetKey = (name: string): SessionKey => `fleet:${name}`
export const isRobotKey = (k: SessionKey): boolean => k.startsWith('robot:')
export const nameOfKey = (k: SessionKey): string => k.slice(k.indexOf(':') + 1)

export interface Choice { id: string; options: string[]; prompt: string }
export type Verdict = 'success' | 'planned' | 'failed' | 'aborted' | 'error'

export interface RobotSession {
  key: SessionKey
  url: string                  // the agent this session talks to; frozen by beginRun until the run ends
  run: RunState
  running: boolean             // a run or a repeat loop is going
  trial: number
  runMethod: string
  events: AgentEvent[]
  steps: Step[]
  logImage: string | null
  qaLog: ChatLine[]            // this robot's conversation: survives runs
  listenId: string | null
  choice: Choice | null
  qaSkill: boolean
  heardLang: string | null
  startedAt: number | null
  endedAt: number | null
  verdict: Verdict | null      // the last finished run
}
export interface SessionStore { shown: SessionKey | null; sessions: Readonly<Record<SessionKey, RobotSession>> }

export interface RunArgs {
  finalPrompt: string; direct: boolean; lang: string; planner: 'grace' | 'direct' | 'sage'; planOnly: boolean
  logData: boolean; logTarget: 'backend' | 'frontend'; logAll: boolean; voice: boolean; screenRec: boolean
}
/** What is not data (socket, timers, resolvers, counters): one object per key, kept by the hook, never read by a render. */
export interface RunHandles {
  ws: WebSocket | null; nudge: ReturnType<typeof setInterval> | null; stopTimer: ReturnType<typeof setTimeout> | null
  repeat: { remaining: number; continueOnError: boolean; active: boolean }
  args: RunArgs | null; textAsk: ((text: string | null) => void) | null
  stopReq: boolean; epoch: number; busy: number; speechUntil: number; choiceAt: number
  fromChat: boolean; nextFromChat: boolean
  langs: RobotLanguages | null; heard: string | null; recording: boolean
  chain: Promise<void>         // this robot's speak / listen jobs, strictly in order
  sid: string                  // immutable id of this robot's run state: a run closure holds it, never the (renamable, reusable) registry name
}
let nextSid = 1
export const newHandles = (): RunHandles => ({
  sid: String(nextSid++),
  ws: null, nudge: null, stopTimer: null, repeat: { remaining: 0, continueOnError: false, active: false },
  args: null, textAsk: null, stopReq: false, epoch: 0, busy: 0, speechUntil: 0, choiceAt: 0,
  fromChat: false, nextFromChat: false, langs: null, heard: null, recording: false, chain: Promise.resolve(),
})

export const EMPTY_STORE: SessionStore = { shown: null, sessions: {} }

export function newSession(key: SessionKey, url: string): RobotSession {
  return {
    key, url, run: INITIAL_RUN, running: false, trial: 0, runMethod: '', events: [], steps: [], logImage: null, qaLog: [],
    listenId: null, choice: null, qaSkill: false, heardLang: null, startedAt: null, endedAt: null, verdict: null,
  }
}

// ── status ──────────────────────────────────────────────────────────────────────────────────────
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'lost'

export function statusOf(s: RobotSession): SessionStatus {
  switch (s.run.phase) {
    case 'waiting': return 'waiting'
    case 'stopping': return 'stopping'
    case 'running': return 'running'
    default: return s.run.alive ? 'lost' : s.running ? 'running' : 'idle'   // idle phase + running flag = between two iterations of a repeat
  }
}
const isBusy = (s: RobotSession): boolean => statusOf(s) !== 'idle'
const isBlank = (s: RobotSession): boolean => !isBusy(s) && !s.qaLog.length && !s.events.length && s.verdict === null

// ── create / select / change ────────────────────────────────────────────────────────────────────
/** Shows `key`; creates a blank session when there is none (no HTTP, no run). The url of a busy session stays frozen. */
export function select(st: SessionStore, key: SessionKey, url: string): SessionStore {
  const cur = st.sessions[key]
  const s = !cur ? newSession(key, url) : isBusy(cur) || cur.url === url ? cur : { ...cur, url }
  return { shown: key, sessions: s === cur ? st.sessions : { ...st.sessions, [key]: s } }
}
export const sessionOf = (st: SessionStore, key: SessionKey): RobotSession | undefined => st.sessions[key]
/** Never null: a blank session when nothing is shown. */
export function shownOf(st: SessionStore): RobotSession {
  return (st.shown !== null && st.sessions[st.shown]) || newSession(st.shown ?? '', '')
}

/** An unknown key leaves the store unchanged, so a late event of a dropped session is harmless. */
export function update(st: SessionStore, key: SessionKey, f: (s: RobotSession) => RobotSession): SessionStore {
  const cur = st.sessions[key]
  if (!cur) return st
  const next = f(cur)
  return next === cur ? st : { ...st, sessions: { ...st.sessions, [key]: next } }
}
export const patch = (st: SessionStore, key: SessionKey, p: Partial<Omit<RobotSession, 'key'>>): SessionStore =>
  update(st, key, s => ({ ...s, ...p }))
export const applyRun = (st: SessionStore, key: SessionKey, e: RunEvent): SessionStore =>
  update(st, key, s => {
    const run = runReduce(s.run, e)
    return run === s.run ? s : { ...s, run }
  })

/** A run starts: freezes the url, clears the last run (the chat log stays). */
export const beginRun = (st: SessionStore, key: SessionKey, url: string, now: number): SessionStore =>
  patch(st, key, { url, running: true, startedAt: now, endedAt: null, events: [], steps: [], logImage: null, trial: 0, verdict: null })
/** The run (or the last repeat) is over: the result stays visible; the pending asks go. */
export const endRun = (st: SessionStore, key: SessionKey, verdict: Verdict, now: number): SessionStore =>
  patch(st, key, { running: false, verdict, endedAt: now, listenId: null, choice: null, qaSkill: false })

export interface Listed { name: string; url?: string }
/** A robot left the registry: its session is dropped (the caller closes the socket and cancels); a robot renamed in place (same url, new name,
 *  no live session under the new name) keeps its session under the new name (`renamed` = [from, to] pairs: the caller moves the handles).
 *  Fleet sessions are not robots. */
export function reconcile(st: SessionStore, robots: Listed[], before: Listed[] = []): { store: SessionStore; dropped: SessionKey[]; renamed: [SessionKey, SessionKey][] } {
  const names = new Set(robots.map(r => r.name)), old = new Set(before.map(r => r.name))
  const gone = Object.keys(st.sessions).filter(k => isRobotKey(k) && !names.has(nameOfKey(k)))
  const sessions: Record<SessionKey, RobotSession> = { ...st.sessions }
  const renamed: [SessionKey, SessionKey][] = [], dropped: SessionKey[] = []
  let shown = st.shown
  for (const k of gone) {
    const s = st.sessions[k]
    // a target has no session of its own (a blank one from a pick does not count) and is not taken by another rename: a sibling's chat log is never overwritten
    const free = (r: Listed): boolean => {
      const t = sessions[robotKey(r.name)]
      return !gone.includes(robotKey(r.name)) && !renamed.some(x => x[1] === robotKey(r.name)) && (!t || isBlank(t))
    }
    const cands = s.url ? robots.filter(r => r.url === s.url && free(r)) : []
    const to = cands.find(r => !old.has(r.name))      // only a name that is new to the list may receive a run (an old idle sibling must not)
    if (to && isBusy(s)) {
      const nk = robotKey(to.name)
      delete sessions[k]; sessions[nk] = { ...s, key: nk }; renamed.push([k, nk])
      if (shown === k) shown = nk
    } else { delete sessions[k]; dropped.push(k); if (shown === k) shown = null }
  }
  if (!renamed.length && !dropped.length) return { store: st, dropped, renamed }
  return { store: { shown, sessions }, dropped, renamed }
}
/** An idle session follows the url its robot has now (a busy one keeps the url of its run: a Cancel must reach the robot that runs). */
export function syncUrls(st: SessionStore, robots: Listed[]): SessionStore {
  let sessions = st.sessions
  for (const r of robots) {
    const k = robotKey(r.name), s = sessions[k]
    if (s && r.url && s.url !== r.url && !isBusy(s)) sessions = { ...sessions, [k]: { ...s, url: r.url } }
  }
  return sessions === st.sessions ? st : { ...st, sessions }
}

// ── what the operator sees ──────────────────────────────────────────────────────────────────────
/** Only the non-idle sessions: one entry per robot that is running (or waiting / stopping / lost). */
export function statusMap(st: SessionStore): Record<SessionKey, SessionStatus> {
  const m: Record<SessionKey, SessionStatus> = {}
  for (const [k, s] of Object.entries(st.sessions)) { const x = statusOf(s); if (x !== 'idle') m[k] = x }
  return m
}
const MARKS: Record<Exclude<SessionStatus, 'idle'>, [string, string]> = {
  running: ['●', 'running'], waiting: ['◆', 'asks you'], stopping: ['○', 'stopping'], lost: ['▲', 'lost'],
}
/** Text of an <option> (text only; the mark goes first so a truncated closed select still shows it). */
export function optionText(label: string, status: SessionStatus, idlePrefix = ''): string {
  if (status === 'idle') return `${idlePrefix}${label}`
  const [mark, word] = MARKS[status]
  return `${mark} ${label} · ${word}`
}
/** Why a new command on this robot is refused (rule 7: one client per robot); null = allowed. */
export function startBlock(st: SessionStore, key: SessionKey): string | null {
  const s = st.sessions[key]
  if (!s || !isBusy(s)) return null
  return `${nameOfKey(key)} is already ${statusOf(s) === 'lost' ? 'running a run this tab lost track of' : 'running'}: a second command would mean two clients driving one robot, which is unsafe. Stop it first.`
}

// ── what Cancel / Stop / Reset / End Q&A / a listen answer talk to ──────────────────────────────
export interface Target { key: SessionKey; url: string }
export const targetOf = (st: SessionStore, key: SessionKey): Target | null => {
  const s = st.sessions[key]
  return s ? { key, url: s.url } : null
}
/** The DISPLAYED robot session and its frozen url; null when none is shown or a fleet is (its Stop all is not a robot cancel). */
export const cancelTarget = (st: SessionStore): Target | null =>
  st.shown !== null && isRobotKey(st.shown) ? targetOf(st, st.shown) : null

// ── chat log ────────────────────────────────────────────────────────────────────────────────────
export const HEARD_PENDING = '🎤 …'
/** Appends a line; an identical consecutive robot line is kept once. */
export function appendLine(log: ChatLine[], who: ChatLine['who'], text: string, kind?: ChatLine['kind']): ChatLine[] {
  const last = log[log.length - 1]
  if (who === 'robot' && last && last.who === 'robot' && last.text === text) return log
  return [...log, { who, text, ...(kind ? { kind } : {}) }]
}
/** The last pending "🎤 …" line becomes the transcript, or is removed when there is none. */
export function settleHeard(log: ChatLine[], text: string | null): ChatLine[] {
  const i = log.map(x => x.who === 'user' && x.text === HEARD_PENDING).lastIndexOf(true)
  if (i < 0) return log
  const n = log.slice()
  if (text) n[i] = { ...n[i], text }; else n.splice(i, 1)
  return n
}
export function verdictOf(ev: AgentEvent): Verdict {
  if (ev.event === 'error') return 'error'
  if (ev.status === 'success' || ev.status === 'planned' || ev.status === 'aborted') return ev.status
  return ev.status == null && ev.success === true ? 'success' : 'failed'
}
/** The grey line that closes a run. */
export function closeLine(ev: AgentEvent): ChatLine {
  const v = verdictOf(ev)
  const msg = ev.msg ? ` — ${ev.msg}` : ''
  if (v === 'error') return { who: 'system', text: `✗ error: ${ev.msg ?? ''}` }
  if (v === 'success' || v === 'planned') return { who: 'system', text: (v === 'planned' ? '✓ planned (plan only: the robot did not move)' : '✓ done') + msg }
  return { who: 'system', text: `✗ failed${msg}` }
}
