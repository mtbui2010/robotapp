// Raw VLA episode recording (robot_agent GET /recorder): what the Record panel shows and what its buttons mean. Pure helpers; the fetches are
// `api.getRecorder` / `makeRecordPrompt` / `startRecording` / `stopRecording`. Nothing here names a task, a field or a language: the fields and the
// prompt templates are the robot's own config, read by the backend.
export interface RecorderState {
  state: 'idle' | 'recording' | 'saving'      // 'saving' only from an older node: the new one is idle while it copies in the background
  saving?: number               // episodes being copied to the shared folder in the background (a new recording can start meanwhile)
  episode?: string
  prompt?: string
  elapsed_s?: number
  counts?: Record<string, number>
  last?: { episode: string; dir: string; label: string; duration_s?: number | null } | null
  error?: string
  ready?: boolean               // false: the shared folder cannot be written
}
export interface RecorderStatus {
  available: boolean            // robot_teleop's recorder is running
  state?: RecorderState | null
  age_s?: number | null
  dir?: string | null
  teleop?: string | null        // the teleop function switched on with the recording
  fields: string[]              // the prompt fields, in order
}

export type RecPhase = 'off' | 'idle' | 'recording' | 'saving'

export const recPhase = (r: RecorderStatus): RecPhase => (!r.available || !r.state ? 'off' : r.state.state)

/** `target_object` -> `target object`. */
export const fieldLabel = (name: string): string => name.replace(/_/g, ' ')

/** 83.4 -> `1:23`. */
export function clock(s: number | null | undefined): string {
  const t = Math.max(0, Math.floor(s ?? 0))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** `head 284 · wrist 169`: the camera frame counts of the episode being recorded (only the streams that carry images are named by the robot). */
export function countsText(counts: Record<string, number> | undefined): string {
  return Object.entries(counts ?? {}).filter(([k]) => !/^(state|action|gripper)/.test(k)).map(([k, v]) => `${k} ${v}`).join(' · ')
}

/** Whether Record can be pressed, and why not. A prompt is not needed: pressing Record makes one from the fields when it is empty. */
export function recordBlock(r: RecorderStatus, runInFlight: boolean, hasAction: boolean, hasPrompt: boolean): string {
  if (recPhase(r) === 'off') return 'the recorder is not running on the robot (make run)'
  if (r.state && r.state.ready === false) return 'the shared folder cannot be written'
  if (recPhase(r) !== 'idle') return `the recorder is ${r.state?.state}`
  if (runInFlight) return 'a run is in flight: cancel it first'
  if (!hasPrompt && !hasAction) return 'fill the action (and the other fields) of the checked row'
  return ''
}

/** The line after an episode was saved. */
export function lastText(r: RecorderStatus): string {
  const l = r.state?.last
  return l ? `saved ${l.episode} (${l.label}${typeof l.duration_s === 'number' ? `, ${clock(l.duration_s)}` : ''})` : ''
}

/** `saving 2…` while episodes are being copied in the background; '' when none (an older node says 'saving' as its state instead). */
export function savingText(r: RecorderStatus): string {
  const n = r.state?.saving ?? 0
  return n > 1 ? `saving ${n}…` : n === 1 ? 'saving…' : ''
}

/** The field rows of the Record bar (two, so open and close a drawer need no retyping), the "Go to" pose each row starts from (`inits`: a pose id, '' = none),
 *  whether that row records BEFORE the move (`before`; default false = the recording starts after the arm arrived) and which row Record uses. `raw` = the saved state, `legacy` = the single set of fields an older version saved (it becomes row 1). Anything unreadable
 *  gives empty rows, no init, the first row active. */
export interface RecRows { rows: Record<string, string>[]; inits: string[]; before: boolean[]; active: number }
export function parseRecRows(raw: string | null, legacy: string | null, n = 2): RecRows {
  const obj = (t: string | null): Record<string, string> => { try { const v = JSON.parse(t || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
  let rows: Record<string, string>[] = []
  let inits: string[] = []
  let before: boolean[] = []
  let active = 0
  try {
    const v = JSON.parse(raw || 'null')
    if (v && Array.isArray(v.rows)) {
      rows = v.rows.filter((r: unknown) => r && typeof r === 'object' && !Array.isArray(r))
      inits = Array.isArray(v.inits) ? v.inits.map((x: unknown) => (typeof x === 'string' ? x : '')) : []
      before = Array.isArray(v.before) ? v.before.map((x: unknown) => x === true) : []
      active = Number(v.active) || 0
    }
  } catch { /* unreadable: start empty */ }
  if (!rows.length) rows = [obj(legacy)]
  while (rows.length < n) rows.push({})
  rows = rows.slice(0, n)
  inits = Array.from({ length: n }, (_, i) => inits[i] ?? '')
  before = Array.from({ length: n }, (_, i) => before[i] ?? false)
  return { rows, inits, before, active: active >= 0 && active < n ? active : 0 }
}
