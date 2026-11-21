'use client'
import { useCallback, useEffect, useState } from 'react'
import { fleet, type LiveStatus } from '../lib/fleet'
import { afterText, approveConfirm, canApprove, goalLabel, groupByRobot, isReal, lostRobots, mergePlans, refreshTargets, stateColour, stopEmptyWarning, stopLines, type StopLine } from '../lib/fleetView'
import type { FleetPlan, FleetRobot } from '../lib/fleet_types'
import FleetCameras from './FleetCameras'
import { readTabPref, writeTabPref } from '../lib/tabPref'

// The Fleet tab: several robots driven by the robot_fleet manager (docs/features/fleet.md). Opening it only reads
// (GET + the /ws/fleet stream); Submit, Approve, Answer, Release and Stop all are the only POSTs, and Approve is
// the only one that starts motion (with a confirmation naming the real robots, rule 8).
const LS_OPERATOR = 'robotapp_fleet_operator'
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const Badge = ({ s }: { s: string }) => <span className={`px-1.5 py-0.5 rounded border text-[11px] ${stateColour(s)}`}>{s.replace('_', ' ')}</span>
const RealBadge = ({ real }: { real: boolean }) => real
  ? <span className="px-1 py-0.5 rounded border border-red-400 bg-red-50 text-red-700 text-[10px] font-semibold" title="A real robot: it moves in the real world">REAL</span>
  : <span className="px-1 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-500 text-[10px]" title="A simulated robot">sim</span>

export default function FleetPanel({ lang }: { lang?: string }) {
  const [url, setUrl] = useState(fleet.getFleetUrl())
  const [urlEdit, setUrlEdit] = useState(url)
  const [robots, setRobots] = useState<FleetRobot[]>([])
  const [plans, setPlans] = useState<FleetPlan[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [live, setLive] = useState<LiveStatus>('connecting')
  const [text, setText] = useState('')
  const [operator, setOperator] = useState('')
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null)   // the plan the confirmation is about (a newer plan may arrive meanwhile)
  const [stop, setStop] = useState<{ lines: StopLine[]; warning: string; error: string } | null>(null)
  useEffect(() => { setOperator(readTabPref(LS_OPERATOR) ?? '') }, [])

  const load = useCallback(() => fleet.snapshot().then(s => { setRobots(s.robots); setPlans(p => mergePlans(p, s.plans)); setErr('') })
    .catch(e => setErr(`Cannot read the fleet manager at ${url}: ${msgOf(e)}`)), [url])
  const readPlan = useCallback((id: string) => fleet.plan(id).then(p => setPlans(ps => mergePlans(ps, [p]))).catch(e => setErr(msgOf(e))), [])
  const readRobots = useCallback(() => fleet.robots().then(setRobots).catch(e => setErr(msgOf(e))), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const sub = fleet.subscribe(e => { const t = refreshTargets(e); if (t.plan) readPlan(t.plan); if (t.robots) readRobots() },
      s => { setLive(s); if (s === 'open') load() })
    return () => sub.close()
  }, [url, load, readPlan, readRobots])
  useEffect(() => {                                     // the stream is down: read every 5 s (GET only) until it is back
    if (live === 'open') return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [live, load])

  const plan = plans.find(p => p.plan_id === sel) ?? plans[plans.length - 1] ?? null
  const act = (p: Promise<unknown>, then?: () => void) => p.then(() => { setErr(''); then?.() }).catch(e => setErr(msgOf(e)))
  const submit = () => act(fleet.submit(text.trim(), lang).then(r => { setSel(r.plan_id); setText(''); return readPlan(r.plan_id) }))
  const approve = (p: FleetPlan) => { const c = approveConfirm(p, robots); if (c) setConfirm({ id: p.plan_id, text: c }); else doApprove(p.plan_id) }
  const doApprove = (id: string) => { setConfirm(null); writeTabPref(LS_OPERATOR, operator.trim()); act(fleet.approve(id, operator.trim()), () => readPlan(id)) }
  const stopAll = () => fleet.stopAll()
    .then(r => setStop({ lines: stopLines(r), warning: stopEmptyWarning(r), error: '' }))
    .catch(e => setStop({ lines: [], warning: '', error: `Stop all failed: ${msgOf(e)}. Stop each robot with its own Stop.` }))
    .finally(load)

  return (
    <div data-testid="fleet-panel" className="flex flex-col gap-2 text-xs">
      <div className="sticky top-0 z-10 flex flex-col gap-1 bg-white border border-red-200 rounded p-2">
        <div className="flex items-center gap-2">
          <button data-testid="fleet-stop-all" onClick={stopAll} className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-base font-bold rounded"
            title="Cancel what every robot of the fleet is doing; the plan stops and cannot continue">■ Stop all</button>
          <span className="text-gray-500">Stops every robot of the fleet, whoever started its run (another tab, the CLI). Two clients driving one robot is unsafe.</span>
        </div>
        {stop?.error && <div className="text-red-700">⚠ {stop.error}</div>}
        {stop?.warning && <div className="text-amber-700">⚠ {stop.warning}</div>}
        {stop?.lines.map(l => (
          <div key={l.robot} className={l.level === 'ok' ? 'text-emerald-700' : 'text-amber-700'}>{l.level === 'ok' ? '✓' : '⚠'} {l.robot}: {l.text}</div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-600">Fleet manager</span>
        <input value={urlEdit} onChange={e => setUrlEdit(e.target.value)} aria-label="fleet manager URL" className="w-56 px-1.5 py-0.5 rounded border border-gray-300" />
        <button onClick={() => { fleet.setFleetUrl(urlEdit); setUrl(fleet.getFleetUrl()) }} className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100">Use</button>
        <button onClick={load} title="Read again" className="px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-100">↻</button>
        <span className={live === 'open' ? 'text-emerald-700' : 'text-amber-700'}>{live === 'open' ? 'live' : 'live updates off: reconnecting, reading every 5 s'}</span>
      </div>
      {err && <div className="text-red-700">{err}</div>}

      {lostRobots(robots).map(r => <LostBanner key={r.id} robot={r} onDone={load} onError={m => setErr(m)} />)}
      <FleetCameras robots={robots} badge={r => <RealBadge real={r.real !== false} />} />
      <RobotsTable robots={robots} />

      <div className="flex items-center gap-2">
        <input data-testid="fleet-request" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && text.trim()) submit() }}
          placeholder="What should the robots do?" aria-label="request" className="flex-1 px-2 py-1 rounded border border-gray-300" />
        <button onClick={submit} disabled={!text.trim()} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
          title="Ask the fleet to understand the request; nothing moves before Approve">Submit</button>
      </div>
      {plans.length > 1 && (
        <select value={plan?.plan_id ?? ''} onChange={e => setSel(e.target.value)} aria-label="plan" className="self-start px-1 py-0.5 rounded border border-gray-300 bg-white">
          {plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_id}: {p.text} ({p.state})</option>)}
        </select>
      )}
      {plan && <PlanView plan={plan} robots={robots} operator={operator} onOperator={setOperator} onApprove={() => approve(plan)}
        onAnswer={t => act(fleet.answer(plan.plan_id, t), () => readPlan(plan.plan_id))} />}

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md flex flex-col gap-3 text-sm">
            <div className="font-medium text-red-700">{confirm.id}: {confirm.text}</div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)} className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100">Do not start</button>
              <button data-testid="fleet-approve-confirm" onClick={() => doApprove(confirm.id)} className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white">Approve and start</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RobotsTable({ robots }: { robots: FleetRobot[] }) {
  if (!robots.length) return <div className="text-gray-500">No robots read from the fleet manager.</div>
  return (
    <table className="w-full border border-gray-200 rounded">
      <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left px-2">robot</th><th className="text-left px-2">url</th><th className="text-left px-2">kind</th><th className="text-left px-2">state</th><th className="text-left px-2">active goal</th></tr></thead>
      <tbody>{robots.map(r => (
        <tr key={r.id} className="border-t border-gray-100">
          <td className="px-2 font-medium">{r.id}</td><td className="px-2 text-gray-500">{r.url}</td>
          <td className="px-2"><RealBadge real={r.real !== false} /></td><td className="px-2"><Badge s={r.state} /></td>
          <td className="px-2">{r.active_goal || '–'}</td>
        </tr>))}
      </tbody>
    </table>
  )
}

function PlanView({ plan, robots, operator, onOperator, onApprove, onAnswer }: {
  plan: FleetPlan; robots: FleetRobot[]; operator: string; onOperator: (v: string) => void; onApprove: () => void; onAnswer: (t: string) => void }) {
  const [answer, setAnswer] = useState('')
  return (
    <div data-testid="fleet-plan" className="flex flex-col gap-1 border border-gray-200 rounded p-2 bg-white">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{plan.plan_id}: “{plan.text}”</span><Badge s={plan.state} />
        {plan.approved_by && <span className="text-gray-500">approved by {plan.approved_by}</span>}
        {canApprove(plan) && (
          <span className="ml-auto flex items-center gap-1">
            <input value={operator} onChange={e => onOperator(e.target.value)} placeholder="your name" aria-label="operator" className="w-28 px-1.5 py-0.5 rounded border border-gray-300" />
            <button data-testid="fleet-approve" onClick={onApprove} disabled={!operator.trim()} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
              title={operator.trim() ? 'Start the plan: the robots begin to move' : 'Type your name first: the approval is recorded with it'}>Approve</button>
          </span>
        )}
      </div>
      {plan.warnings.map((w, i) => <div key={i} className="text-amber-700">⚠ {w}</div>)}
      {plan.questions.length > 0 && (
        <div className="flex flex-col gap-1 border border-yellow-300 bg-yellow-50 rounded p-1.5">
          {plan.questions.map((q, i) => <div key={i}>❓ {q}</div>)}
          <div className="flex gap-1">
            <input value={answer} onChange={e => setAnswer(e.target.value)} aria-label="answer" placeholder="Answer" className="flex-1 px-1.5 py-0.5 rounded border border-gray-300" />
            <button onClick={() => { onAnswer(answer.trim()); setAnswer('') }} disabled={!answer.trim()} className="px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-40">Answer</button>
          </div>
        </div>
      )}
      {groupByRobot(plan).map(g => (
        <div key={g.robot ?? '-'} className="flex flex-col">
          <div className="flex items-center gap-1 text-gray-600 mt-1">{g.robot ? <><span className="font-medium">{g.robot}</span><RealBadge real={isReal(g.robot, robots)} /></> : 'no robot yet'}</div>
          {g.goals.map(n => (
            <div key={n.goal_id} className="flex flex-wrap items-center gap-2 pl-3">
              <span className="text-gray-400">{n.goal_id}</span><span>{goalLabel(n.goal)}</span><Badge s={n.state} />
              <span className="text-gray-500">{afterText(n, plan)}</span>
              {n.outcome && (n.outcome.code || n.outcome.msg) && <span className="text-gray-500">{[n.outcome.code, n.outcome.msg].filter(Boolean).join(': ')}</span>}
            </div>
          ))}
        </div>
      ))}
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
