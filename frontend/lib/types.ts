export type ClientType = 'ros_service' | 'ros_topic' | 'ros_action' | 'webrtc' | 'llm' | 'tcp' | 'zmq' | 'websocket' | 'http' | 'visionserve'

export interface ClientEntry {
  id: string
  name: string
  type: ClientType
  config: Record<string, unknown>
  connected: boolean
  is_camera: boolean
  is_active: boolean   // only meaningful for type='llm' — marks the entry that resolves dm.get_client('llm')
  error: string
  last_checked: number
}

export interface GuideVersion {
  name: string
  guide: string
  // null → freeform (llm.chat_guide); a JSON schema → structured (llm.chat).
  format: Record<string, unknown> | null
}

export interface SkillDef {
  name: string
  type: 'internal' | 'external'
  description: string
  module_path: string
  func_name: string
  url: string
}

export interface RosScanResult {
  topic: [string, string][]
  service: [string, string][]
  action: [string, string][]
}

export interface WorldState {
  arrived: string | null
  found: string | null
  holding: string | null
  opened: string[]
  on: string[]
  holding_since: number | null
  // Geometric memory of the found object (loc_3d/pose_3d/grasppose/ts/robot_pose).
  // Display-only; `found_pose_stale` is true once the base moved away from it.
  found_pose?: Record<string, unknown> | null
  found_pose_stale?: boolean
  // Grasp actually used to pick the held object ({grasppose, ts, robot_pose}).
  holding_pose?: Record<string, unknown> | null
}

export interface AgentEvent {
  event: string
  prompt?: string
  text?: string
  msg?: string
  plan?: string
  step?: number
  total?: number
  task?: string
  result?: Record<string, unknown>
  success?: boolean
  trace?: string
  data?: Record<string, unknown>
  log_image?: string | null
  ts?: number
  // Closed-loop (GRACE) events
  say?: string                       // localized phrase for voice output
  index?: number                     // step index (closed-loop)
  action?: string                    // GRACE action
  object?: string                    // GRACE object
  skill?: string | null              // mapped kcare skill
  status?: string                    // step/run status
  reason?: string                    // failure reason
  verifies?: Array<Record<string, unknown>>
  steps?: unknown                    // plan steps
  plan_text?: string                 // plan in kcare `skill::inputs` format
  plan_meta?: Record<string, unknown>  // planner metrics (subgoals/llm_calls/refines/latency…)
  warnings?: string[]
  run_id?: string
  elapsed_ms?: number                 // total run wall-clock (client-measured)
  world?: WorldState                 // closed-loop: persistent symbolic state snapshot
  // Live multi-step planner progress (GRACE): decompose → expand → refine
  phase?: string
  subgoals?: string[]
  subgoal?: string
  attempt?: number
}

export interface LlmInfo {
  name?: string
  url?: string
  model?: string
}
