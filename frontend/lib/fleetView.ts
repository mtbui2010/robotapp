// Pure helpers of the Fleet tab (components/FleetPanel.tsx): data in, decision or text out; no IO, no React.
// Unit-tested in scripts/test_fleet.mjs with made-up robots and goals.
import type { CancelResult, FleetEvent, FleetGoal, FleetGoalNode, FleetPlan, FleetRobot } from './fleet_types'

/** "pick cup from shelf to table": what the goal asks, in the goal's own words (object and place names as sent). */
export const goalLabel = (g: FleetGoal): string =>
  [g.type, g.object, g.from && `from ${g.from}`, g.to && `to ${g.to}`].filter(Boolean).join(' ')

export interface RobotGroup { robot: string | null; goals: FleetGoalNode[] }

/** Goals grouped by robot, robots in the order their first goal appears; goals with no robot yet come last. */
export function groupByRobot(plan: FleetPlan): RobotGroup[] {
  const groups = new Map<string | null, FleetGoalNode[]>()
  for (const n of plan.goals) if (n.robot) groups.set(n.robot, [...(groups.get(n.robot) ?? []), n])
  const free = plan.goals.filter(n => !n.robot)
  const out: RobotGroup[] = [...groups].map(([robot, goals]) => ({ robot, goals }))
  return free.length ? [...out, { robot: null, goals: free }] : out
}

/** "starts first" or "after g1 (pick cup on b), g2 (...)": what a goal waits for, readable. */
export function afterText(node: FleetGoalNode, plan: FleetPlan): string {
  if (!node.after.length) return 'starts first'
  const byId = new Map(plan.goals.map(n => [n.goal_id, n]))
  return 'after ' + node.after.map(id => {
    const d = byId.get(id)
    return d ? `${id} (${goalLabel(d.goal)}${d.robot ? ` on ${d.robot}` : ''})` : id
  }).join(', ')
}

// One colour per state of a goal, a plan or a robot (Tailwind classes). Unknown states are grey.
const COLOURS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600 border-gray-300',
  ready: 'bg-sky-50 text-sky-700 border-sky-300',
  released: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  running: 'bg-blue-100 text-blue-800 border-blue-400',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  failed: 'bg-red-50 text-red-700 border-red-300',
  canceled: 'bg-amber-50 text-amber-700 border-amber-300',
  understanding: 'bg-gray-100 text-gray-600 border-gray-300',
  awaiting_approval: 'bg-yellow-50 text-yellow-800 border-yellow-400',
  stopped: 'bg-amber-50 text-amber-700 border-amber-300',
  refused: 'bg-red-50 text-red-700 border-red-300',
  idle: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  busy: 'bg-blue-100 text-blue-800 border-blue-400',
  lost: 'bg-red-100 text-red-800 border-red-400',
}
export const UNKNOWN_COLOUR = 'bg-gray-100 text-gray-500 border-gray-300'
export const stateColour = (state: string): string => COLOURS[state] ?? UNKNOWN_COLOUR

/** A robot counts as real unless the manager says real: false (SPEC: default TRUE); an unknown robot is real. */
export const isReal = (id: string, robots: FleetRobot[]): boolean => robots.find(r => r.id === id)?.real !== false

/** The real robots an approval may move: the plan's robots, plus every reachable robot when a goal has none yet. */
export function realRobotsOf(plan: FleetPlan, robots: FleetRobot[]): string[] {
  const ids = new Set(plan.goals.map(n => n.robot).filter((r): r is string => !!r))
  if (plan.goals.some(n => !n.robot)) robots.filter(r => r.state !== 'lost').forEach(r => ids.add(r.id))
  return [...ids].filter(id => isReal(id, robots)).sort()
}

export const canApprove = (plan: FleetPlan | null): boolean => plan?.state === 'awaiting_approval'

/** The confirmation an Approve asks for (rule 8), or '' when the plan moves no real robot. */
export function approveConfirm(plan: FleetPlan, robots: FleetRobot[]): string {
  const real = realRobotsOf(plan, robots)
  if (!real.length) return ''
  const names = real.join(', ')
  return `This plan moves ${real.length === 1 ? 'a REAL robot' : 'REAL robots'}: ${names}. ` +
    'Check that the space around them is clear and that nobody else (another tab, the CLI) drives them. Start?'
}

export type StopLevel = 'ok' | 'warning'
export interface StopLine { robot: string; level: StopLevel; text: string }

/** One line per robot of a Stop all. Only a cancel that worked AND cancelled something is ok; the rest warn. */
export function stopLines(results: CancelResult[]): StopLine[] {
  return results.map(r => {
    const errs = Object.entries(r.errors ?? {}).map(([k, v]) => `${k}: ${v}`)
    const cancelled = r.cancelled ?? []
    const ok = r.ok && cancelled.length > 0 && !r.warning && !errs.length
    const what = !r.ok ? 'the cancel failed' : cancelled.length ? `cancelled ${cancelled.join(', ')}` : 'nothing was cancelled'
    const text = [r.warning, what, errs.length ? `errors: ${errs.join('; ')}` : ''].filter(Boolean).join('; ')
    return { robot: r.robot, level: ok ? 'ok' : 'warning', text }
  })
}

/** A Stop all that came back with no robot at all is itself a warning. */
export const stopEmptyWarning = (results: CancelResult[]): string =>
  results.length ? '' : 'The fleet manager answered with no robot: check each robot and use its own Stop.'

export const lostRobots = (robots: FleetRobot[]): FleetRobot[] => robots.filter(r => r.state === 'lost')

/** What to read again after a live event: the plan it names, and the robots when it names a robot or no plan. */
export function refreshTargets(e: FleetEvent): { plan: string | null; robots: boolean } {
  return { plan: e.plan_id ?? null, robots: !!e.robot || !e.plan_id }
}

/** Plans by id, newest last: merge a list read from the manager (or one plan) into what the tab knows. */
export function mergePlans(known: FleetPlan[], fresh: FleetPlan[]): FleetPlan[] {
  const out = [...known]
  for (const p of fresh) {
    const i = out.findIndex(k => k.plan_id === p.plan_id)
    if (i >= 0) out[i] = p
    else out.push(p)
  }
  return out
}
