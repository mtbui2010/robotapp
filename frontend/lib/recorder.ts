// Raw VLA episode recording (robot_agent GET /recorder): what the Record panel shows and what its buttons mean. Pure helpers; the fetches are
// `api.getRecorder` / `makeRecordPrompt` / `startRecording` / `stopRecording`. Nothing here names a task, a field or a language: the fields and the
// prompt templates are the robot's own config, read by the backend.
export interface RecorderState {
  state: 'idle' | 'recording' | 'saving'
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
  if (!hasPrompt && !hasAction) return 'fill the action (and the other fields), or write a prompt'
  return ''
}

/** The line after an episode was saved. */
export function lastText(r: RecorderStatus): string {
  const l = r.state?.last
  return l ? `saved ${l.episode} (${l.label}${typeof l.duration_s === 'number' ? `, ${clock(l.duration_s)}` : ''})` : ''
}
