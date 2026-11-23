'use client'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fleet, type LiveStatus } from '../lib/fleet'
import { lostRobots, refreshTargets, stateColour, stopEmptyWarning, stopLines, type StopLine } from '../lib/fleetView'
import type { FleetRobot } from '../lib/fleet_types'
import FleetCameras from './FleetCameras'
import { COLS_DEFAULT, COLS_MAX, loadCols, saveCols } from '../lib/fleetCams'

// The Fleet tab: several robots driven by the robot_fleet manager (docs/features/fleet.md). Opening it only reads
// (GET + the /ws/fleet stream); Stop all (through the page's Cancel button) and Release are its only POSTs.
// Requests, the plan read-back, the yes/no approval and the robots' questions are in the chat card (rule 8 stays:
// nothing moves before the person answers yes in the chat).
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const Badge = ({ s }: { s: string }) => <span className={`px-1.5 py-0.5 rounded border text-[11px] ${stateColour(s)}`}>{s.replace('_', ' ')}</span>
const RealBadge = ({ real }: { real: boolean }) => real
  ? <span className="px-1 py-0.5 rounded border border-red-400 bg-red-50 text-red-700 text-[10px] font-semibold" title="A real robot: it moves in the real world">REAL</span>
  : <span className="px-1 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-500 text-[10px]" title="A simulated robot">sim</span>

// toolbarSlot: the page's tab row; the fleet manager controls are drawn there (one row with the tabs and the fleet name) instead of
// under it. stopRef: the page's Cancel button calls what is put here (Stop all of the fleet); there is no second Stop all button.
export default function FleetPanel({ toolbarSlot, stopRef }: {
  toolbarSlot?: HTMLElement | null; stopRef?: React.MutableRefObject<(() => void) | null> }) {
  const [url] = useState(fleet.getFleetUrl())            // the manager of this tab's fleet (set in the fleet editor; a chosen fleet remounts the tab)
  const [robots, setRobots] = useState<FleetRobot[]>([])
  const [err, setErr] = useState('')
  const [live, setLive] = useState<LiveStatus>('connecting')
  const [stop, setStop] = useState<{ lines: StopLine[]; warning: string; error: string } | null>(null)
  const [cols, setCols] = useState(COLS_DEFAULT)           // robot tiles on one row (a tab preference)
  useEffect(() => { setCols(loadCols()) }, [])

  const load = useCallback(() => fleet.robots().then(r => { setRobots(r); setErr('') })
    .catch(e => setErr(`Cannot read the fleet manager at ${url}: ${msgOf(e)}`)), [url])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const sub = fleet.subscribe(e => { if (refreshTargets(e).robots) load() }, s => { setLive(s); if (s === 'open') load() })
    return () => sub.close()
  }, [url, load])
  useEffect(() => {                                     // the stream is down: read every 5 s (GET only) until it is back
    if (live === 'open') return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [live, load])

  const stopAll = () => fleet.stopAll()
    .then(r => setStop({ lines: stopLines(r), warning: stopEmptyWarning(r), error: '' }))
    .catch(e => setStop({ lines: [], warning: '', error: `Stop all failed: ${msgOf(e)}. Stop each robot with its own Stop.` }))
    .finally(load)
  useEffect(() => {                                     // the page's Cancel button is the fleet's Stop all while this tab is open
    if (!stopRef) return
    stopRef.current = stopAll
    return () => { if (stopRef.current === stopAll) stopRef.current = null }
  })

  const controls = (
    <div className="flex items-center gap-2 text-xs min-w-0 w-full">
      <button onClick={load} title={`Read again from the fleet manager at ${url}`} className="px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-100 shrink-0">↻</button>
      <span title={`fleet manager: ${url}`} className={`shrink-0 ${live === 'open' ? 'text-emerald-700' : 'text-amber-700'}`}>{live === 'open' ? 'live' : 'live updates off: reconnecting, reading every 5 s'}</span>
      <label className="ml-auto flex items-center gap-1 text-gray-600 shrink-0 whitespace-nowrap">Robots per row
        <select data-testid="fleet-cols" value={cols} onChange={e => { const n = Number(e.target.value); setCols(n); saveCols(n) }}
          className="px-1 py-0.5 rounded border border-gray-300 bg-white">
          {Array.from({ length: COLS_MAX }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  )

  return (
    <div data-testid="fleet-panel" className="flex flex-col gap-2 text-xs">
      {toolbarSlot ? createPortal(controls, toolbarSlot) : <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      {(stop?.error || stop?.warning || stop?.lines.length) ? (
        <div className="sticky top-0 z-10 flex flex-col gap-1 bg-white border border-red-200 rounded p-2">
          {stop?.error && <div className="text-red-700">⚠ {stop.error}</div>}
          {stop?.warning && <div className="text-amber-700">⚠ {stop.warning}</div>}
          {stop?.lines.map(l => (
            <div key={l.robot} className={l.level === 'ok' ? 'text-emerald-700' : 'text-amber-700'}>{l.level === 'ok' ? '✓' : '⚠'} {l.robot}: {l.text}</div>
          ))}
        </div>
      ) : null}

      {err && <div className="text-red-700">{err}</div>}

      {lostRobots(robots).map(r => <LostBanner key={r.id} robot={r} onDone={load} onError={m => setErr(m)} />)}
      {robots.length === 0 && <div className="text-gray-500">No robots read from the fleet manager.</div>}
      <FleetCameras robots={robots} cols={cols} badge={r => <RealBadge real={r.real !== false} />} info={r => <RobotInfo robot={r} />} />
    </div>
  )
}

/** What the table of robots used to say, now under the robot's camera: its state, its active goal and the URL the manager reads it at. */
function RobotInfo({ robot }: { robot: FleetRobot }) {
  return (
    <div data-testid="fleet-robot-info" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-gray-100 pt-1">
      <Badge s={robot.state} />
      <span title="active goal">{robot.active_goal ? <>goal: {robot.active_goal}</> : <span className="text-gray-400">no active goal</span>}</span>
      <span className="ml-auto text-gray-500 break-all">{robot.url}</span>
    </div>
  )
}

function LostBanner({ robot, onDone, onError }: { robot: FleetRobot; onDone: () => void; onError: (m: string) => void }) {
  const [res, setRes] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const release = (r: string) => fleet.releaseLock(r).then(() => { setAsking(null); setRes(''); onDone() }).catch(e => { setAsking(null); onError(msgOf(e)) })
  return (
    <div data-testid="fleet-lost" className="flex flex-col gap-1 border border-red-400 bg-red-50 text-red-800 rounded p-2">
      <div><b>Robot {robot.id} is lost</b>: the fleet manager gets no answer from {robot.url}. Its running goal failed and is never given to another robot.
        A place it held stays locked until you release it.</div>
      <div className="flex flex-wrap items-center gap-1">
        {(robot.locks ?? []).map(l => <button key={l} onClick={() => setAsking(l)} className="px-2 py-0.5 rounded border border-red-400 bg-white hover:bg-red-100">Release {l}</button>)}
        <input value={res} onChange={e => setRes(e.target.value)} placeholder="place name" aria-label="place to release" className="w-32 px-1.5 py-0.5 rounded border border-red-300" />
        <button onClick={() => res.trim() && setAsking(res.trim())} disabled={!res.trim()} className="px-2 py-0.5 rounded border border-red-400 bg-white hover:bg-red-100 disabled:opacity-40">Release</button>
      </div>
      {asking && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Release {asking}? Check first that {robot.id} is not there: a goal waiting for {asking} may then start on another robot.</span>
          <button onClick={() => release(asking)} className="px-2 py-0.5 rounded bg-red-600 text-white">Yes, release</button>
          <button onClick={() => setAsking(null)} className="px-2 py-0.5 rounded border border-gray-300 bg-white">No</button>
        </div>
      )}
    </div>
  )
}
