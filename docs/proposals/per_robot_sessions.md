# Proposal: per-robot sessions in one tab (2026-11-24)

Status: proposal for the loop "per-robot sessions" (branch `feat/per-robot-sessions`). Nothing in this file is built yet. It is
written from the code as it is at commit 2b12bba (line numbers below are for that commit; `page.tsx` is 1036 lines).

## 0. The problem, in the code

A tab has ONE run. `app/page.tsx` keeps the run in about 14 `useState` and 19 `useRef` values (section 1). Two things follow:

- The run's WebSocket handler (`fire`, page.tsx:251-598) writes into the page's single set of state. After the operator picks robot B
  in the drop-down the page still shows A's run, `running` stays true, and the Run / chat controls stay locked for B.
- `api.cancelRun()` (api.ts:468), `api.answerListen*` (api.ts:436, 457), `api.endQa()` (api.ts:475) and `api.agentWs()` (api.ts:856) all
  build their URL from `getAgentUrl()` = the active robot AT CALL TIME. Cancel pressed after a switch goes to B. A `listen` answer for
  A's question goes to B.

Backend facts measured on the sim robots (2026-11-24, `a` = :8021, `b` = :8022, structured command `wait::N`):

- A run started through `WS /ws/agent` with `{"prompt":"wait::30","direct":true,...}` shows in `GET /runs` as `active` (non-null) and ends
  with `done` / status `aborted` about 0.1 s after `POST /agent/cancel`. `wait` does not move the robot and Cancel / Stop end it.
- `POST /skill/wait {"inputs": 2}` takes 2.00 s on both robots but is NOT a run: `GET /runs` `active` stays null. So `POST /skill/<name>`
  is only good for timing a skill; the e2e must start its runs through the dashboard (`/ws/agent`).
- `POST /agent/cancel` on an idle robot answers `{"ok":true,...}` and does not touch the other robot (checked: cancel on :8022 while :8021
  ran left :8021 active; cancel on :8021 ended it).
- A SECOND `/ws/agent` socket on a robot that is already running does not fail: the backend attaches it to the running run
  (`run_attached`, `run_input`). So "one client per robot" (rule 7) can only be kept by the UI. That is requirement R4 below.

## 1. Inventory: page-level state that belongs to one robot's run

Legend: VIEW = drawn on screen (moves into the store as plain data); HANDLE = mutable object that is not data (socket, timer,
resolver, counter; moves into a per-session handles object); SHARED = stays page-level and says why.

All lines are `frontend/app/page.tsx` unless another file is named.

| # | Name | Line | Kind | Notes |
|---|---|---|---|---|
| 1 | `running` (+ `runningRef`) | 97, 176, 757 | VIEW | the run / repeat loop is going; the effect at 757-760 also clears `listenId` and `qaSkill` when it turns false |
| 2 | `agentEvents` | 98 | VIEW | the run's events; PlanPanel, backend log dir (824) |
| 3 | `agentSteps` | 99 | VIEW | plan rows (`reduceSteps`) |
| 4 | `eventsRef`, `stepsRef` | 110, 111 | HANDLE (disappear) | mirrors of 2 and 3 so `onmessage` can append; the store's synchronous `get(key)` replaces them |
| 5 | `emit` | 141 | writer | writes 2, 3 and 4; `useForeignRun` also calls it (178) |
| 6 | `logImage` | 100 | VIEW | the step image; `setLogImage` is used at 178, 540-542, 653, 1008 |
| 7 | `runMethod` | 101 | VIEW | planner used by the run |
| 8 | `trial` | 102 | VIEW | iteration counter of a repeat |
| 9 | `heardLang` / `heardLangRef` | 704 / 155 | VIEW / HANDLE | Detect: language heard last in this run |
| 10 | `robotLangsRef` | 154, 703 | HANDLE | the robot's languages, copied from the hook of the ACTIVE robot; `runLang` (156) reads it. A background run must keep the languages of ITS robot: freeze a copy at run start |
| 11 | `voiceLang` | 108, 259, 538 | SHARED | the browser's TTS language; only the SHOWN session may write it (a background run is not spoken) |
| 12 | `wsRef` | 109 | HANDLE | the run's `/ws/agent` socket (opened 346, closed 255, 647) |
| 13 | `runStartRef` | 112 | HANDLE (startedAt) | run start time, for `elapsed_ms` (549) |
| 14 | `repeatRef` | 150 | HANDLE | remaining / continueOnError / active of the repeat loop |
| 15 | `argsRef` | 153 | HANDLE | the arguments of the run, re-used by every repeat iteration (`RunArgs` type) |
| 16 | `nudgeRef`, `stopNudge` | 159, 234 | HANDLE | the "still working" timer |
| 17 | `qaLog` | 163 | VIEW | the chat log of the run (what the robot said, asked; what the user typed). Also receives the Fleet chat lines (768-771): see section 7 |
| 18 | `addQaLine` / `settleHeard` / `HEARD_PENDING` | 196-215 | writer | the dedupe rule and the "🎤 …" placeholder; they move out as pure functions |
| 19 | `textAskRef` | 164 | HANDLE | resolver of a typed `listen` answer being waited for |
| 20 | `listenId` / `listenIdRef` / `takeListen` | 166, 167, 172 | VIEW / HANDLE | the pending `listen` of THIS run (the id is posted back to THIS robot) |
| 21 | `rs` / `rsRef` / `sendRun` | 169-171 | VIEW | the life-cycle state of `lib/chatRun.ts` (idle / running / waiting / stopping, `alive`, `ws`, `stuck`); `runReduce` is reused unchanged |
| 22 | the stop timeout effect | 678-682 | HANDLE | keyed on `rs.phase` of the shown run only: a stopping background run would never become "stuck". Becomes a timer per session |
| 23 | `stopReqRef` | 180 | HANDLE | Stop was pressed for the run in flight |
| 24 | `hriEpochRef`, `hriChainRef`, `newHriEpoch` | 183-185 | HANDLE | HRI queue (speak / listen / alarm). One speaker and one mic exist, so the chain stays shared; the EPOCH (the "this job is stale" test) becomes per session |
| 25 | `hriBusyRef`, `speechUntilRef` | 192, 193 | HANDLE | per session; the hands-free snapshot (807) reads "any session busy" |
| 26 | `nextRunChatRef`, `runFromChatRef` | 187, 188 | HANDLE | the run was started from the chat card; decides typed vs mic answer (451) and whether the card opens (435) |
| 27 | `choice` / `choiceAtRef` / `pickChoice` | 217, 221, 222 | VIEW / HANDLE | the on-screen choice dialog (1015-1031) belongs to a run |
| 28 | `qaSkill` / `endQa` | 689, 690 | VIEW | "End Q&A" button; `api.endQa()` must name the run's robot |
| 29 | `foreignRun` / `noteOwnEvent` | 178 (`lib/useForeignRun.ts:23`) | SHARED (shown robot) | read-only `/ws/events` of the SHOWN robot; it writes through `emit`, so it writes to the shown session (see 5.3). `ownRunning` (178) must read the shown session |
| 30 | `beginRecording` / `endRecording` / `setRecordingPrefix` | 139, 265, 550, 594, 655 | SHARED | ONE screen recorder per tab. A session ends it only if it began it (risk 7.7) |
| 31 | `cancel`, `cancelTitle`, `stop`, `reset` | 640-685 | logic | call `api.cancelRun()` at 644 and 675 (no URL). They become `…(key)` and name the session's URL |
| 32 | `fleetMode`, `fleetChat`, `fleetStopRef` | 767-771, 86 | SHARED | unchanged (R5); only the chat LOG it writes to changes (7.5) |
| 33 | `target` | 96 | SHARED | `{robot, url, location, host}` of the robot the tab shows, set by DevicePanel `onActiveChange` (DevicePanel.tsx:277). It decides the shown session |

Not run state, left as they are: `clients` (80), `mainTab` (84), `chatOpen` (706), `lang` (705), `planner` (710), `planOnly` (711),
`handsFree` / mic state (712-716, one microphone per browser), `voiceOut` (103), `speechRates` (117), `echoGuard` (194),
`robotLangs` / `useRobotEpoch` (696-697: the cameras and the map are rebuilt per robot, R5), recorder / teleop / poses hooks (698-701, they
describe the shown robot). Closure variables inside `fire` (`prefix`, `runDir`, `buckets`, `runFailed`, ... lines 269-337) are already
per run and need no change.

Other readers of "the run is going" that must read the SHOWN session: `PlanPanel running` (912), `AgentPanel running` (941), `TeleopBar` /
`RecorderBar runInFlight` (1005-1006), `MapPanel running` (1010; its Stop button calls `api.cancelRun()` at MapPanel.tsx:484), the chat
card props (826-844), the Chat button (900), the hands-free snapshot (804-809).

## 2. Target data model

A session is plain data (no socket, no timer). The store maps a key to a session and names the one that is shown.

```ts
type SessionKey = string                     // 'robot:<registry name>' | 'fleet:<fleet name>' = the drop-down's <option value>
interface RobotSession {
  key: SessionKey
  url: string          // the agent this session talks to. Frozen by beginRun until the run ends (a URL edit cannot move a live run)
  run: RunState        // lib/chatRun.ts, unchanged (phase, alive, ws, stuck)
  running: boolean     // the old page `running`: a run or a repeat loop is going
  trial: number; runMethod: string
  events: AgentEvent[]; steps: Step[]; logImage: string | null
  qaLog: ChatLine[]    // this robot's conversation; survives runs, cleared by "clear"
  listenId: string | null; choice: Choice | null; qaSkill: boolean
  heardLang: string | null
  startedAt: number | null; endedAt: number | null
  verdict: 'success' | 'planned' | 'failed' | 'aborted' | 'error' | null   // last finished run: shown when the robot is picked again
}
interface SessionStore { shown: SessionKey | null; sessions: Readonly<Record<SessionKey, RobotSession>> }
```

The things that are not data live in one mutable object per key, created lazily by the hook and never read by React renders:

```ts
interface RunHandles {
  ws: WebSocket | null; nudge: ReturnType<typeof setInterval> | null; stopTimer: ReturnType<typeof setTimeout> | null
  repeat: { remaining: number; continueOnError: boolean; active: boolean }
  args: RunArgs | null; textAsk: ((text: string | null) => void) | null
  stopReq: boolean; epoch: number; busy: number; speechUntil: number; choiceAt: number
  fromChat: boolean; nextFromChat: boolean
  langs: RobotLanguages | null; heard: string | null; recording: boolean
}
```

Life cycle of a session: created by `select` the first time its robot is picked (blank, no HTTP, no run: rule 6); `beginRun` when a run
starts; `applyRun` for every `RunEvent` of `chatRun.ts`; `endRun` on `done` / `error` / last repeat; kept after the run (the result stays
visible when the robot is picked again); dropped by `reconcile` when its robot leaves the registry (its socket is closed and a
best-effort cancel is sent to its frozen URL). Sessions live in memory only: a reload starts blank, and the backend already cancels a
run whose socket closes (cancel-stop.md).

Status shown to the operator (pure, from the session): `running` (run.phase running, or `running` between two iterations of a repeat),
`waiting` (the robot asked), `stopping`, `lost` (socket gone, run may be alive: `run.alive` and phase idle), `idle`.

## 3. Exact signatures

### 3.1 `frontend/lib/robotSessions.ts` (pure: no React, no HTTP, no storage, no clock; at most 300 lines)

```ts
import type { RunEvent, RunState } from './chatRun'
import type { AgentEvent } from './types'
import type { ChatLine } from '../components/ChatPanel'
import type { Step } from '../components/PlanPanel'
import type { RobotLanguages } from './robotLanguages'

export type SessionKey = string
export const robotKey = (name: string): SessionKey => `robot:${name}`
export const fleetKey = (name: string): SessionKey => `fleet:${name}`
export const isRobotKey = (k: SessionKey): boolean => k.startsWith('robot:')
export const nameOfKey = (k: SessionKey): string => k.slice(k.indexOf(':') + 1)

export interface Choice { id: string; options: string[]; prompt: string }
export type Verdict = 'success' | 'planned' | 'failed' | 'aborted' | 'error'
export interface RobotSession { /* section 2 */ }
export interface SessionStore { /* section 2 */ }
export interface RunArgs { finalPrompt: string; direct: boolean; lang: string; planner: 'grace' | 'direct' | 'sage'; planOnly: boolean
                           logData: boolean; logTarget: 'backend' | 'frontend'; logAll: boolean; voice: boolean; screenRec: boolean }
export interface RunHandles { /* section 2 */ }
export const newHandles: () => RunHandles
export const EMPTY_STORE: SessionStore

// create / select
export function newSession(key: SessionKey, url: string): RobotSession
export function select(st: SessionStore, key: SessionKey, url: string): SessionStore     // shown := key; creates a blank session; refreshes `url` only when the session is not busy
export function shownOf(st: SessionStore): RobotSession                                  // never null: a blank session when nothing is shown
export function sessionOf(st: SessionStore, key: SessionKey): RobotSession | undefined

// change (unknown key: the store is returned unchanged, so a late event of a dropped session is harmless)
export function update(st: SessionStore, key: SessionKey, f: (s: RobotSession) => RobotSession): SessionStore
export function patch(st: SessionStore, key: SessionKey, p: Partial<Omit<RobotSession, 'key'>>): SessionStore
export function applyRun(st: SessionStore, key: SessionKey, e: RunEvent): SessionStore  // run := runReduce(run, e)
export function beginRun(st: SessionStore, key: SessionKey, url: string, now: number): SessionStore   // freezes url; clears events/steps/logImage/trial/verdict; keeps qaLog
export function endRun(st: SessionStore, key: SessionKey, verdict: Verdict, now: number): SessionStore // running=false; clears listenId, choice, qaSkill (old effect 757-760)
export function reconcile(st: SessionStore, robots: { name: string }[]): { store: SessionStore; dropped: SessionKey[] }   // sessions of robots that left the registry

// what the operator sees
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'lost'
export function statusOf(s: RobotSession): SessionStatus
export function statusMap(st: SessionStore): Record<SessionKey, SessionStatus>      // only non-idle keys: one entry per running robot
export function optionText(label: string, status: SessionStatus, idlePrefix?: string): string   // text of an <option>, section 5
export function startBlock(st: SessionStore, key: SessionKey): string | null        // why a new command on this robot is refused (R4); null = allowed

// what Cancel / Stop / Reset / End Q&A / a listen answer talk to (R3)
export interface Target { key: SessionKey; url: string }
export function cancelTarget(st: SessionStore): Target | null                        // the DISPLAYED session; null when none is shown or a fleet is shown (the Fleet's Stop all is not a robot cancel)
export function targetOf(st: SessionStore, key: SessionKey): Target | null           // a named session (used by async continuations that hold their own key)

// chat log (moved out of page.tsx 196-215, 392-396)
export const HEARD_PENDING = '🎤 …'
export function appendLine(log: ChatLine[], who: ChatLine['who'], text: string, kind?: ChatLine['kind']): ChatLine[]   // identical consecutive robot lines once
export function settleHeard(log: ChatLine[], text: string | null): ChatLine[]
export function closeLine(ev: AgentEvent): ChatLine                                  // the grey "✓ done / ✗ failed / ✗ error" line
export function verdictOf(ev: AgentEvent): Verdict
```

`cancelTarget` is the only way the page learns where a Cancel goes. It reads `st.shown`, not the registry, and returns the session's
frozen `url`, so a Cancel can only reach the robot whose session is on screen.

### 3.2 `frontend/lib/useRobotSessions.ts` (React glue, no HTTP; about 60 lines)

```ts
export function useRobotSessions(): {
  store: SessionStore                                   // re-renders the page on every change
  shown: RobotSession                                   // shownOf(store)
  get: (key: SessionKey) => RobotSession                // latest value from a ref: safe inside sockets and timers (no stale closure)
  put: (key: SessionKey, f: (s: RobotSession) => RobotSession) => void   // synchronous: ref first, then setState (the pattern of sendRun, page.tsx:171)
  choose: (key: SessionKey, url: string) => void        // select(); called when `target` changes
  handles: (key: SessionKey) => RunHandles              // created on first use; closed by drop()
  drop: (keys: SessionKey[]) => void                    // closes ws, clears timers, removes the sessions (used with reconcile)
}
```

It also owns two cleanups: close every socket and timer on unmount, and a `beforeunload` guard while any session runs (risk 7.8).

### 3.3 New URL-explicit functions in `frontend/lib/api.ts`

Every one takes the robot's base URL as its first argument and never calls `getAgentUrl()`. They reuse the `wsBase` conversion that
`eventsWsAt` / `cameraWsAt` already use (api.ts:155-165).

```ts
/** POST {baseUrl}/agent/cancel. Stop, Reset and every Cancel button end here; there is no other cancel call. */
cancelRunAt(baseUrl: string): Promise<void>
/** WS {baseUrl}/ws/agent: the run socket of the robot at baseUrl. */
agentWsAt(baseUrl: string): WebSocket
/** POST {baseUrl}/agent/listen/<id> (the answer to a `listen` of a run on THAT robot). */
answerListenAt(baseUrl: string, id: string, text: string, error?: string, note?: string): Promise<void>
/** POST {baseUrl}/agent/listen/<id>/audio. Never throws (same result shape as answerListenAudio). */
answerListenAudioAt(baseUrl: string, id: string, blob: Blob | null, mime: string, note?: string): Promise<{ text: string; error?: string; gone?: boolean }>
/** POST {baseUrl}/agent/qa/end ("End Q&A"). Throws the backend's detail (409 when no qa runs). */
endQaAt(baseUrl: string): Promise<void>
```

"Stop" and "Reset" are the same HTTP call (`cancelRunAt`); they differ only on this side (Stop keeps the socket to see `done`, Reset
drops it). A separate `stopRunAt` / `resetRunAt` would only be a second name for the same POST. After the migration the old
`cancelRun`, `agentWs`, `answerListen`, `answerListenAudio` and `endQa` are DELETED, not kept as wrappers: with them gone, TypeScript
refuses any code that cancels "the active robot", which makes the wrong-target Cancel impossible by construction (R3). The two lint
rules in `scripts/lint.mjs` stay as they are (HTTP only in `lib/api.ts`); no change to its allowlist.

## 4. How `page.tsx` and `DevicePanel` use them (smallest change)

Budget: `page.tsx` may be at most 1036 + 40 = 1076 lines (the checker `size_page`).

### 4.1 page.tsx

Logic that moves OUT (so the file does not grow):

- Rows 1-3, 6-9, 17, 20, 21, 27, 28 of the inventory (the 14 `useState` and their `useRef` mirrors, lines 97-102, 110-111, 163-171, 176,
  217, 689, 704, about 30 lines) become one line, `const sess = useRobotSessions()`, and one destructuring line of what the render needs
  (`const { running, events, steps, ... } = sess.shown`).
- The chat-log rules (`addQaLine`'s dedupe, `settleHeard`, the closing grey line, lines 196-215 and 392-396, about 20 lines) become
  `appendLine`, `settleHeard`, `closeLine` in `robotSessions.ts`.
- The effect at 757-760 and the stop-timeout effect at 678-682 (9 lines) become `endRun` and a timer in the handles.
- The 19 refs of rows 4, 12-16, 19, 23-26 become fields of `RunHandles` (`h = sess.handles(key)`).

What is added or changed in place:

1. `fire(key)`, `run`, `reset(key, why)`, `stop(key)` get the session key. `run` takes `key = sess.shown.key` once, at the top, and `fire`
   closes over it (and over `url = sess.get(key).url`, frozen by `beginRun`). Every `setX(...)` inside `fire` becomes
   `sess.put(key, s => ...)` (same number of lines). The repeat chain calls `fireRef.current(key)` (line 572).
2. `ws = api.agentWsAt(url)` (346); `api.answerListenAt(url, ...)` at 232, 417, 444, 469, 474, 498, 784; `api.cancelRunAt(url)` at 644, 675;
   `api.endQaAt(url)` at 691.
3. Side effects that only make sense for the robot on screen are guarded by `const live = () => sess.get(sess.shown.key).key === key`:
   `speak(...)` and the nudge (368-383), `setChatOpen(true)` (435), the mic / earcon / `speechSynthesis` part of `listenJob` (446-499),
   `setVoiceLang` (259, 538). Chat lines, the plan, the step image and the verdict are written for every session.
4. Cancel: `const cancel = () => { if (mainTab === 'fleet' && fleetStopRef.current) fleetStopRef.current(); else { const t = cancelTarget(sess.store); if (t) stopSession(t.key) } }`.
   The tab-row Cancel (999), the control-bar Cancel (884), the chat Stop (838) and the Agent panel Stop (941) all call it, so the four
   buttons agree. `MapPanel` gets `onStop={cancel}` instead of calling `api.cancelRun()` itself.
5. `useForeignRun({ robotUrl: target?.url, ownRunning: () => sess.shown.running, show: emitShown, ... })` where `emitShown` puts
   events / steps into `sess.shown.key`. The hook is unchanged.
6. `useEffect(() => { if (target?.robot) sess.choose(robotKey(target.robot), target.url) }, [target])` (the shown session follows the
   robot the tab shows) and, in the existing effect at 91 that reads the registry, `sess.drop(reconcile(...).dropped)`.
7. R4 notice: a 4-line `<div>` under `ForeignRunBadge` (911) showing `startBlock(sess.store, sess.shown.key)` ("robot `a` is running a
   command from this tab. One client per robot (rule 7): Cancel it first, or pick another robot."). `run()` that is refused adds the same
   text as a `system` line to that robot's log (visible in the chat), instead of returning silently as 602 does today.
8. The drop-down (973-986): `<option ...>{optionText(o.label, marks[o.value] ?? 'idle', '🤖 ')}</option>` with
   `const marks = statusMap(sess.store)`; pass `marks` to `DevicePanel` (one prop).

Estimated count (not measured): about -55 lines removed (state, helpers, effects), about +45 added (items 1-8). Expect the file
to end between 1020 and 1060 lines; the real number is measured at migration steps 4 and 5 with `check.sh static` (`size_page`).
If it is above 1076 the next logic to move out is the `listenJob` body (lines 446-499) into `lib/hriListen.ts`; that is a pure move.

### 4.2 DevicePanel.tsx

- New optional prop `marks?: Record<string, SessionStatus>`. The drop-down at 899-915 renders
  `optionText(o.label, marks?.[o.value] ?? 'idle')` (2 lines). `value` and `onChange` are unchanged.
- `switchActiveRobot` (317-336) and `switchRef` (338) are UNCHANGED: switching a robot does not stop, close or reset anything. The old
  `setClients([])` (cameras of the old robot are dropped) stays; the session is not touched.
- `removeActiveRobot` (378-387): when `marks[robotKey(activeRobot)]` is not idle, the `confirm()` text adds "Its running command will be
  cancelled." (the page then drops the session, which cancels it). No new prop for the rename: `updateRobot` already fires
  `ROBOT_CHANGED_EVENT`, the page re-reads the registry and the renamed robot starts as a new, blank session (old one dropped, see 7.9).

## 5. How the drop-down marks a running robot

An `<option>` holds text only (no colour, no element), and a closed `<select>` truncates the selected option (`max-w-[12rem]`, page.tsx:980),
so the mark goes FIRST. Chosen text, one rule for both drop-downs (`optionText`, tested):

| Status | Option text | Example |
|---|---|---|
| idle | the caller's usual text | `🤖 alpha` (page), `alpha` (DevicePanel) |
| running | `● ` + name + ` · running` | `● alpha · running` |
| waiting for the user's answer | `◆ ` + name + ` · asks you` | `◆ alpha · asks you` |
| stopping | `○ ` + name + ` · stopping` | `○ alpha · stopping` |
| lost (socket gone, run may live) | `▲ ` + name + ` · lost` | `▲ alpha · lost` |

Why these characters: `●` `◆` `○` `▲` are in every basic font (the emoji circles 🟢 / 🔴 are not, and render as empty boxes in headless
Chromium without an emoji font, which would also break the e2e). The word after the dot is for screen readers and for people who do not
read the glyph. The mark replaces the `🤖` so the width stays about the same. The e2e contract: the text of `option[value="robot:<name>"]`
of a running robot starts with `●`. The text is the only channel (a `title` on an `<option>` is not shown by all browsers). The Chat button already pulses amber when the SHOWN session waits (900); a background session that
waits shows `◆` in the drop-down, so the question is not missed.

## 6. Ordered migration steps

Each step is one commit, leaves `make lint typecheck unit` green and the app working (steps 3 to 6 also `make smoke` in this worktree
only). A test for a behaviour is written before the code and must fail without it. Commit messages say what and why (rule 9).

1. **Pure store + tests.** `scripts/test_sessions.mjs` first (red: module missing), then `lib/robotSessions.ts`; add the file to `make unit`.
   No app change. Tests (made-up robots `alpha`, `beta`):
   - select creates a blank session per robot and keeps the others; a running session is untouched by selecting another robot;
   - `statusOf`: idle, running, waiting, stopping, lost; a repeat between two iterations counts as running;
   - `statusMap` lists only non-idle keys, keyed like the `<option value>`;
   - `optionText`: idle unchanged, running starts with `● ` and ends `· running`, one case per status;
   - `startBlock`: null when idle, names the robot when running / waiting / stopping, null for a fleet key, null for `lost`;
   - `cancelTarget` / R3: alpha running, select beta, target is beta's url; select alpha, target is alpha's url; a fleet shown gives null;
   - `beginRun` freezes the url: `select(alpha, newUrl)` during the run keeps the old url, after `endRun` the new one applies;
   - `beginRun` clears the old events, steps and image but keeps `qaLog`; `endRun` clears `listenId`, `choice`, `qaSkill`;
   - `appendLine` on alpha does not change beta's log; identical consecutive robot lines once; `settleHeard` replaces or removes the placeholder;
   - `applyRun` follows `runReduce` for the named session only; an event for an unknown key changes nothing;
   - `reconcile` drops the sessions of removed robots and lists them.
2. **URL-explicit API + tests.** Add `cancelRunAt`, `agentWsAt`, `answerListenAt`, `answerListenAudioAt`, `endQaAt` to `lib/api.ts`; the old
   functions stay for now. Tests in `scripts/test_sessions.mjs` with a fake `fetch` and `WebSocket` (like `test_fleet.mjs`): with the
   ACTIVE robot set to `beta`, `cancelRunAt(alphaUrl)` posts to `alphaUrl/agent/cancel` (the old `cancelRun()` posts to beta: that is the
   failing test that documents the bug); a trailing slash does not double; `agentWsAt('https://x')` is `wss://x/ws/agent`.
3. **Handles per session, URL-explicit calls.** Add `lib/useRobotSessions.ts`. In `page.tsx` replace the 19 refs by `RunHandles`
   (row 4, 12-16, 19, 23-26), `fire(key)` closes over the frozen `url`, and all calls of item 4.1.2 use the `…At(url)` functions. The view
   state is still the page's `useState` (the store is only used for `shown` and the frozen url). Behaviour with one robot is identical;
   with a switch during a run, Cancel and `listen` answers now reach the run's own robot (the first real fix). Verify: `make ci`, and the
   e2e probe of section 8 steps 1-5 by hand.
4. **View state into the store.** Rows 1-3, 6-9, 17, 20, 21, 27, 28 move into `RobotSession`; chat helpers move to `robotSessions.ts`;
   `live()` guards (4.1.3); the shown session follows `target` (4.1.6); the stop timer replaces the effect (row 22). This is the step
   that delivers R1: picking B shows B's controls, picking A shows A's live state. Measure `size_page`.
5. **Marks, R4 notice, fleet log.** `marks` prop and `optionText` in both drop-downs; the notice (4.1.7); the Fleet chat writes to
   `fleetKey(fl.active)` (7.5). Verify R2, R4, R5 by hand and with the e2e.
6. **Delete the old API calls.** Remove `cancelRun`, `agentWs`, `answerListen`, `answerListenAudio`, `endQa` from `lib/api.ts`; `MapPanel`
   takes `onStop`. `tsc` now refuses any "active robot" cancel. Add a lint rule that `/agent/cancel` appears only in `lib/api.ts` (it
   already must, rule 1) and that `cancelRunAt` is not called with `getAgentUrl()` anywhere outside `lib/api.ts`.
7. **Docs.** `docs/features/sessions.md` (the model, the marks table of section 5, the rules R1-R4, the limits of section 7), a dated
   `docs/CHANGELOG.md` line containing the words "per-robot session", one line each in `docs/features/chat.md` (the log is per robot,
   Fleet view excepted), `docs/features/cancel-stop.md` (Cancel names the displayed session's robot) and `docs/architecture.md`
   (`lib/robotSessions.ts`, `lib/useRobotSessions.ts`). `CLAUDE.md` of the repo is not edited.
8. **E2E.** `scripts/e2e_sessions.py` (section 8); the checker `e2e` part.

## 7. Risks

7.1 **Switching during start.** `run()` freezes `key` and `url` before the socket opens (`ws.onopen` sends the frozen `args`), so a pick
of B between the click and `onopen` cannot move the run. `fire` must never read `target`, `getAgentUrl()` or `sess.shown` after its first
line; the unit test of `beginRun` and the e2e step 7 (click Run on A, pick B within 200 ms) cover it.

7.2 **Switching during stop.** `stop(key)` captures `key` and `url`; its `.then(() => applyRun(key, cancel-ack))` is keyed. The 5 s
"stuck / Force reset" timer is per session (row 22). Today it exists only for the shown run, so a stopping background run would never
offer Force reset. Pressing Cancel on the SHOWN session twice is still the force-reset path (`stopAction`).

7.3 **WebSocket cleanup.** One socket per running session plus the shown robot's read-only `/ws/events`. Rules: `gone()` (page.tsx:584)
compares `h.ws !== ws` per session, as now; `reset(key)` nulls the handlers before closing (647); `drop()` and unmount close every socket
and clear every nudge / stop timer; Strict Mode's double effect is harmless because nothing is open at mount. A reload or a closed tab
cancels every running session on the backends (existing behaviour: the backend cancels a run whose socket closes); sessions are not
saved. `beforeunload` asks for confirmation while any session runs (open decision D3).

7.4 **Stale closures.** The event handler of a background session lives for minutes. Everything it needs comes from `sess.get(key)`
(ref-backed) or from `RunHandles`, never from a value captured at render. `sess.put` is synchronous (ref, then `setState`), like
`sendRun` today. The `fire` dependency array (page.tsx:598) shrinks, because the state it used to read is no longer closed over.
`sendChat` (772) must read `sess.get(shownKey)` at click time, not the render's `running`.

7.5 **Fleet mode and the chat log per robot.** R5: `fleetMode`, `useFleetChat`, `fleetStopRef` and the Fleet view are unchanged, and the
robot sessions keep running while the Fleet view is open (the drop-down still shows their marks). Today the Fleet chat lines go through
the same `addQaLine` into the same `qaLog` (768-771); after the change `qaLog` is per robot, so the Fleet chat needs its own log: a
session under `fleetKey(fl.active)` that never runs (only its `qaLog` is used). The chat card shows
`qaLog` of `fleetMode ? fleetKey : shown`. The Fleet chat log is therefore kept per fleet, in memory. Rule 7 stays visible: the card's
help text and the Cancel tooltip are unchanged. A robot that a fleet drives AND this tab's session runs is two clients on one robot; the
notice of 4.1.7 covers only this tab's own sessions (the fleet manager's plans are not read here). Not handled in this loop.

7.6 **Voice and microphone are global.** One speaker and one mic exist. Decisions (default values, section 9): only the SHOWN session is
spoken (browser `speak`, nudge, earcons); a background session writes its lines to its log only. A `listen` of a background session
does NOT open the mic: it waits for a typed answer (`waitTyped`, as for `input='text'`), the drop-down shows `◆ … asks you`, and the
answer is posted to ITS url when the operator picks that robot and types (or clicks the choice dialog). The HRI chain stays shared so
two robots never talk or listen at once; `epoch` and `busy` are per session so Reset of A does not drop B's jobs. The hands-free
snapshot (807) reads `any session busy`. A hung job of one session could hold the shared chain: `abortCaptures` for that session resolves
`textAsk` with null, as today, and the epoch test skips its queued jobs.

7.7 **One screen recorder, one `voiceLang`, one `robotLangs`.** `beginRecording` / `endRecording` serve the whole tab; a session ends the
recording only if `h.recording` says it began it, and a background run does not begin one. `robotLangs` is the SHOWN robot's: `runLang`
uses the copy frozen in `h.langs` at run start, so a background run does not speak with another robot's languages.

7.8 **Closing the tab.** Running sessions die with the page (7.3). This is the same as today for one robot, but now several robots can be
running, so the guard matters more.

7.9 **Rename and remove.** Sessions are keyed by registry name. Removing a robot, or renaming it, drops its session (socket closed,
best-effort cancel to the frozen url); the renamed robot starts blank. This is rare and the confirm text says so (4.2).

7.10 **Same robot in two tabs.** Not changed: each tab has its own sessions; rule 7's warning stands. The backend lets a second client
join a running run (section 0), so the UI cannot prevent it across tabs.

7.11 **A frame of lag.** `target` reaches the page one effect after `api.setActiveRobot`. During that frame the page still shows the old
robot's session; since every call is URL-explicit and keyed by the shown session, a click in that frame acts on the old robot's session,
which is what is on screen. Other panels that still call `getAgentUrl()` (SkillPanel, Map click-to-move, poses) are rebuilt on
`ROBOT_CHANGED_EVENT` and are out of scope.

7.12 **`running` readers.** Row "Other readers" of section 1 must all read the shown session, or a panel would be locked by another
robot's run (the original bug) or would start a motion on a busy robot. The list is in section 1; step 4 greps for `running` after the move.

7.13 **page.tsx size.** See 4.1: estimate -10 to +25 net, hard limit +40, with a named escape (`lib/hriListen.ts`).

## 8. Recommended e2e (sim robots `a` = http://127.0.0.1:8021, `b` = http://127.0.0.1:8022)

Choose the commands by timing, without motion. Measured on 2026-11-24: `wait` (stands still, Cancel ends it) is exact and safe.

```bash
# time a skill (this is NOT a run: GET /runs active stays null, so use it only to pick durations)
curl -s -X POST http://127.0.0.1:8021/skill/wait -H 'Content-Type: application/json' -d '{"inputs": 2}'      # 2.00 s wall
curl -s http://127.0.0.1:8021/runs | python3 -c "import sys,json; print(json.load(sys.stdin)['active'])"       # null when idle
# a real run, as the dashboard starts it (what the e2e must use): WS /ws/agent, then GET /runs shows it active
#   {"prompt":"wait::30","lang":"en","direct":true,"planner":"grace","plan_only":false,"log_data":false,"log_mode":"frontend","log_all":false}
curl -s -X POST http://127.0.0.1:8021/agent/cancel                                                              # ends it in about 0.1 s
```

If a motion is wanted as a second proof, time `move::<place>` the same way on the sim (`POST /skill/move` with a place from
`GET /skill-configs/ENV`) and use it only on the sim robots.

Suggested e2e steps (same numbering as the brief), with the dashboard started by the script on :3017 from this worktree:

| Step | Do (Playwright) | Assert |
|---|---|---|
| 1 | seed `robotapp_robots` (a, b) and `robotapp_active_robot=a`; open the page; in the Agent panel's first textarea type `wait::40`, click `Run` | `GET :8021/runs` `active` non-null within 3 s; the Agent panel button reads `Stop` |
| 2 | `select[data-testid=fleet-switch]` `select_option('robot:b')` | the `Run` button is back (b is idle); `option[value="robot:a"]` text starts with `●`; `option[value="robot:b"]` has no `●` |
| 3 | type `wait::12`, click `Run`; screenshot | `:8022/runs` active non-null AND `:8021/runs` active non-null; the Plan panel shows b's step, not a's |
| 4 | still viewing b, click the tab-row `Cancel` (`button` with text exactly `Cancel`) | `:8022/runs` active null within 5 s AND `:8021/runs` active still non-null (the Cancel went to b only) |
| 5 | select a; Plan panel shows a's running step; click `Cancel` | `:8021/runs` active null within 30 s; a's chat / plan show the abort |
| 6 | finally `POST /agent/cancel` on both | both `active` null (also in a `finally`) |
| 7 (extra) | click `Run` on a and select b within 200 ms; then select a again | a's run still active, a's Cancel stops a (switching during start) |
| 8 (extra) | on a, press `Cancel`, select b before the run ends, select a again | a shows `stopping` then idle, not stuck (switching during stop) |

Run durations: a `wait::40` (long enough for every later step), b `wait::12` (long enough to poll both `/runs` and to press Cancel
in step 4, which would be too late with a 2-4 s command). The text a person reads in step 5, "a's live state", is the Plan panel's
running row plus the chat's grey lines; the old code would have shown b's.

`QUIET=1 bash check.sh unit`, `static`, `docs` run after steps 1, 3-6 and 7; `e2e` after step 8. `make smoke` is allowed in this
worktree only.

## 9. Open decisions (defaults used unless the owner changes them)

- D1. A background session's `listen` waits for a typed answer, it never opens the mic (7.6). Default: yes.
- D2. Option text uses `●` / `◆` / `○` / `▲` + name + a word (section 5). Default: yes.
- D3. `beforeunload` confirmation while a session runs (7.3, 7.8). Default: yes (it lives in the hook, adds no page lines).
- D4. Removing or renaming a robot cancels its running session (7.9). Default: yes, with the confirm text.
- D5. The Fleet chat log is a pseudo-session per fleet (7.5). Default: yes.
- D6. Backend: no change is needed (`POST /agent/cancel`, `/ws/agent`, `/runs` already behave as measured). The only backend gap seen is
  that a second `/ws/agent` client attaches to a running run instead of being refused (section 0); it is not worked around here, the UI
  refuses the second command from this tab (R4). If a refusal is wanted, it is a robot_agent change on its own branch.
