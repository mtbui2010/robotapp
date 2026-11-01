export type ClientType = 'ros_service' | 'ros_topic' | 'ros_action' | 'webrtc' | 'llm' | 'tcp' | 'zmq' | 'websocket' | 'http' | 'visionserve' | 'switchbot' | 'stt'
  | 'vlms' | 'visions' | 'voices'

// AI-server connections (robot_agent/connect/pool.py): one role, several servers in fallback order.
export type PoolKind = 'vlms' | 'visions' | 'voices'
export type PoolLevel = 'ok' | 'warn' | 'error' | 'unknown'
export interface PoolServerStatus {
  idx: number
  label: string
  enabled: boolean
  provider: string | null
  status: 'unknown' | 'ok' | 'slow' | 'down' | 'off'
  error: string
  last_sec: number | null
  cooldown: number        // s left before it is tried first again
}
export interface PoolStatus {
  level: PoolLevel        // ok: main server works · warn: a fallback does · error: none
  using: number | null    // index of the server that served the last call
  servers: PoolServerStatus[]
}

// Languages the robot speaks and understands (skills: hri LANGS).
export type Lang = 'ko' | 'en'

export interface ClientEntry {
  id: string
  name: string
  type: ClientType
  config: Record<string, unknown>
  connected: boolean
  is_camera: boolean
  is_active: boolean   // type 'llm' / 'vlms' — marks the entry that resolves dm.get_client('llm') (the planner)
  error: string
  last_checked: number
  servers?: PoolStatus // AI-server connections (vlms / visions / voices and the older llm / visionserve / stt)
}

export interface GuideVersion {
  name: string
  guide: string
  // null → freeform (llm.chat_guide); a JSON schema → structured (llm.chat).
  format: Record<string, unknown> | null
  // {ROBOT} / {ACTIONS} / {EXAMPLES} the text uses ([] = a legacy guide, sent as written)
  placeholders?: string[]
}

// Which planners plan with the guide (GET /guides?planner=…): only the direct
// path and llm_direct; SAGE (grace / sage) builds its prompts from the manifest.
export interface GuideUsage {
  used_by: string[]
  active_planner: string
  active_planner_uses_guide: boolean
}

export interface GuideList extends Partial<GuideUsage> {
  active: string | null
  versions: GuideVersion[]
}

// POST /guides/preview: the guide as the LLM would receive it for a command.
export interface GuidePreview extends Partial<GuideUsage> {
  rendered: string
  placeholders: string[]
  legacy: boolean
  examples: { task: string; score?: number; source?: string }[]
}

export interface SkillDef {
  name: string
  type: 'internal' | 'external' | 'plan'
  description: string
  module_path: string
  func_name: string
  url: string
  plan?: string        // type 'plan': steps, one "skill::args" per line
  aliases?: string[]   // other names the skill answers to (SkillRegistry.resolve)
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
  // Where each value came from (robot_agent docs/guard.md; absent on an older backend).
  provenance?: WorldProvenance
}

export type ProvenanceSource = 'sensor' | 'operator' | 'belief' | 'unknown'

export interface FieldProvenance {
  source: ProvenanceSource
  ts: number | null          // unix seconds the sensor read it / the operator set it
  detail?: string
  why?: string               // unknown: why the sensor could not tell
}

export interface WorldProvenance {
  arrived?: FieldProvenance
  found?: FieldProvenance
  holding?: FieldProvenance
  on?: FieldProvenance
  opened?: FieldProvenance & {
    containers?: Record<string, { source: ProvenanceSource; ts: number | null; open: boolean }>
    unconfirmed?: string[]
  }
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
  log_image_reset?: boolean   // step_log: clear the shown log image first
  log_dir?: string                   // backend vision-capture dir when log_data=backend
  // Streamed vision dataset (log_data=frontend): base64 PNG rgb/annotated,
  // zlib-compressed uint16 depth + shape, and the raw detection results.
  dataset?: {
    tag?: string
    ts?: number
    rgb?: string | null
    annotated?: string | null
    depth?: string | null
    depth_w?: number
    depth_h?: number
    results?: unknown
  }
  ts?: number
  // Closed-loop (GRACE) events
  say?: string                       // localized phrase for voice output
  say_lang?: string                  // the phrase's language when not the run's (a plain-name step is said in English)
  quiet?: boolean                    // step_start of a `%skill::…` step: not narrated (nor the 15 s nudge)
  // HRI skills (kcare hri.reply / hri.ask, source='dashboard'). `speak` is
  // always voiced — it is the skill's own output, not narration like `say`.
  // `listen` asks the dashboard to capture one phrase and POST it back to
  // /agent/listen/{id}.
  speak?: string
  speak_lang?: string | null
  speak_rate?: number                // how fast to say it (HRI_CONFIGS.speech_rate or the call's rate=)
  speak_id?: string                  // the skill waits until this line is reported spoken
  alarm?: { volume?: number; cycles?: number }   // kcare call_119 (simulated): play the siren, in order
  qa_state?: { active: boolean }     // kcare qa conversation running / over (the "End Q&A" button)
  // kcare ask did not understand: its options as buttons until a click (POST /agent/listen/<id> {text: option}),
  // the spoken answer or the end of the ask (choose_close = that id)
  choose?: { id: string; options: string[]; prompt?: string }
  choose_close?: string
  listen?: { id: string; lang?: string; max_sec?: number; prompt?: string; mode?: 'voice' | 'text'
             // 'whisper': record and post the audio (the robot transcribes);
             // 'browser': the browser's own recogniser
             capture?: 'whisper' | 'browser'; silence_sec?: number
             earcon?: number                 // "your turn" / "got it" tone volume, 0 = off
             rate?: number }                 // how fast to say the prompt
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
  // GRACE per-sub-goal planning detail (plan_step): expanded steps, symbolic
  // violations, and the final verify verdict.
  ok?: boolean
  violations?: Array<Record<string, unknown>>
}

export interface LlmInfo {
  name?: string
  url?: string
  model?: string
}

// ── Map tab (components/MapPanel.tsx) ─────────────────────────────────────────
// Read from the active site's `MAP` skill-config group (GET /skill-configs/MAP). A site without one has
// no Map tab content. Frames follow ROS map.yaml: `origin` = world (x, y) [m] of the image's
// bottom-left corner, `resolution` m/px, image row 0 = the top (largest y), x to the right.
export interface MapFrame {
  resolution: number
  origin: [number, number]
  width: number
  height: number
  unit?: string                       // value unit of a data layer, e.g. 'cm'
}

export interface MapLayer {
  file: string                         // site file, served by GET /config/locations/_active/files/<file>
  frame: MapFrame
  values?: Record<string, number>      // occupancy: {free, inflated, occupied}
  unit?: string
}

export interface MapSurface {
  name: string                         // e.g. an ENV key: 'dining table@kitchen'
  centre: [number, number]
  size: [number, number]               // [depth along yaw_deg, width across it] [m]
  yaw_deg: number                      // direction the front faces
  height: number                       // surface height [m]
}

// A skill call with templated params: "{x}" etc. are filled in by the panel (a lone placeholder
// becomes a number).
export interface MapSkillCall {
  skill: string
  params: Record<string, string>
}

export interface MapConfig {
  // the picture under everything: a camera connection (sim top-down view) or a site file
  // (map/map.png written by POST /map/snapshot from a SLAM map connection)
  image?: { connection?: string; url?: string; file?: string; frame: MapFrame }
  // where the saved map came from (POST /map/snapshot): the OccupancyGrid connection etc.
  // keep: the area kept (map frame; outside = unknown, images cropped to it), speck_cells: lone obstacle
  // blobs below this size were dropped — both applied again by every later snapshot
  source?: { connection: string; saved_at?: string; inflate_m?: number; occupied?: number
             keep?: [number, number][]; speck_cells?: number }
  layers?: { occupancy?: MapLayer; height?: MapLayer }
  surfaces?: MapSurface[]
  places?: 'ENV' | null                // draw ENV entries; clicking one runs move::<name>
  // robot pose: a device agent read with GET /agent/<agent>/get (never clears a pending cancel)
  // without pose / goal the map is view-only
  pose?: { agent: string; x: string; y: string; orientation?: string; yaw?: string; angle?: 'deg' | 'rad'; period_s?: number }
  goal?: MapSkillCall                  // placeholders {x} {y} {rz} (rz in degrees, current heading)
  rotate?: MapSkillCall & { step_deg?: number }        // placeholder {deg}
  lift?: MapSkillCall & { clearance?: number; reach_m?: number }   // placeholder {h} [m]
  confirm_goal?: boolean               // ask before every motion (real robots)
  // the user's origin: a frame on the map [map-frame x, y in m, yaw in deg]. Coordinates shown in the Map tab
  // (hover, robot, angles) are relative to it; the robot and ENV keep using the robot's own map frame.
  origin?: MapOrigin
  // simulation only: the agent of the sim's control service (kcare-sim /sim/command) — reset, move / add /
  // remove objects and furniture, save / load scenes
  sim?: { agent: string }
}

// kcare-sim /sim/command "state" reply (see MapPanel's Sim bar)
export interface SimObject { body: string; name: string; ycb: string | null; surface: string | null; pos: number[]; yaw_deg: number; quat: number[]
                            moved?: boolean; spec?: { surface?: string; offset?: number[]; yaw_deg?: number } | null }
export interface SimFurniture { pos: [number, number]; yaw_deg: number; type: string | null; editable: boolean
                                footprint?: { centre: [number, number]; size: [number, number]; yaw_deg: number } }
export interface SimState {
  ok: boolean; msg?: string
  scene: string; dirty: boolean; scene_def: Record<string, unknown>; scenes: string[]
  objects: SimObject[]; furniture: Record<string, SimFurniture>
  catalog: { furniture: Record<string, string>; objects: string[] }; spots: string[]
}

export interface MapOrigin { x: number; y: number; yaw_deg: number }

/** GET /config/locations. Several machines may share the robot's configs
 *  folder; `others` are the live ones (presence heartbeat) and their site —
 *  two machines on one site share its connections and Global Configs.
 *  `clash`: another machine runs with this backend's host id. */
export interface LocationsInfo {
  locations: string[]
  active: string
  host?: string
  others?: { host: string; location: string | null; pkg?: string | null; age_sec: number; clash?: boolean }[]
}
