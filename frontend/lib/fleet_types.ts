// Types of the robot_fleet manager API (the Fleet tab), hand-written from robot_fleet docs/SPEC.md section 6 and
// robot_fleet/models.py (2026-11-21). Regenerate from the fleet OpenAPI when `make gen-types` supports it.
// Listed in docs/backend_coupling.md (hand-written types). Fields marked "not in SPEC" are optional and may be absent.

export type RobotState = 'idle' | 'busy' | 'lost'
export type GoalState = 'pending' | 'ready' | 'released' | 'running' | 'done' | 'failed' | 'canceled'
export type PlanState = 'understanding' | 'awaiting_approval' | 'running' | 'done' | 'failed' | 'stopped' | 'refused'

/** GET /fleet/robots: one robot of the fleet. `real` is true when the manager does not say (SPEC: default TRUE). */
export interface FleetRobot {
  id: string
  url: string
  real?: boolean
  state: RobotState
  active_goal?: string | null
  manifest?: Record<string, unknown>
  locks?: string[]              // not in SPEC: the exclusive places held for this robot's goals, when the manager lists them
}

/** A robot_agent typed goal: {type, object, from, to, ...}; extra keys are kept. */
export interface FleetGoal {
  type: string
  object?: string
  from?: string
  to?: string
  [key: string]: unknown
}

/** How a goal ended on a robot (models.Outcome). */
export interface FleetOutcome {
  started?: boolean
  status?: string               // success | failed | aborted
  code?: string | null          // a robot_agent FailureCode, or "lost" / "refused"
  msg?: string
  run_id?: string
  duration_s?: number
}

export interface FleetGoalNode {
  goal_id: string
  goal: FleetGoal
  after: string[]
  robot: string | null
  state: GoalState
  outcome?: FleetOutcome | null
}

/** GET /fleet/plans/{plan_id} */
export interface FleetPlan {
  plan_id: string
  text: string
  state: PlanState
  goals: FleetGoalNode[]
  questions: string[]
  warnings: string[]
  approved_by?: string | null
}

/** POST /fleet/requests */
export interface SubmitResult { plan_id: string; state: PlanState }

/** One robot's answer to POST /fleet/stop (models.CancelResult). */
export interface CancelResult {
  robot: string
  ok: boolean
  cancelled: string[]
  errors: Record<string, string>
  warning: string
}

/** WS /ws/fleet: every plan / goal / robot event. */
export interface FleetEvent {
  event: string
  plan_id?: string
  goal_id?: string
  robot?: string
  [key: string]: unknown
}

// ── Fleet definitions kept in the browser (lib/fleetRegistry.ts) and the manager's config (lib/fleet.ts) ──
// Hand-written from the manager contract: GET /fleet/config, PUT / DELETE /fleet/robots/{id}.

/** A registry robot that belongs to a fleet; `real` is the operator's required choice (no default). */
export interface FleetMember { name: string; real: boolean }

/** A fleet as the dashboard keeps it: its manager and the robots (by registry name) it works with. */
export interface FleetDef { name: string; url: string; members: FleetMember[] }

/** One robot of GET /fleet/config. */
export interface FleetConfigRobot { id: string; url: string; real: boolean; places?: unknown }

/** GET /fleet/config. */
export interface FleetConfig {
  robots: FleetConfigRobot[]
  places?: unknown
  exclusive?: unknown
  policy?: unknown
}

/** Body of PUT /fleet/robots/{id}. */
export interface FleetRobotBody { url: string; real: boolean; places?: unknown }

/** What saving a fleet did to the manager. */
export interface SyncResult {
  state: 'synced' | 'not_synced' | 'error'
  /** One line for the person: "synced", "not synced: ...", or the manager's errors. */
  text: string
}
