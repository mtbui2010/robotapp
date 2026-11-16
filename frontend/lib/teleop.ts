// Teleoperation functions (robot_agent GET /teleop): what the strip above the cameras shows and what its buttons mean. Pure helpers;
// the fetches are `api.getTeleop` / `enableTeleop` / `setTeleopSpeed`. Nothing here names a device or a robot: a function is a name,
// a label and a state the robot's own teleop node publishes.
export interface TeleopState {
  state: 'inactive' | 'hold' | 'active'
  ready?: boolean               // false: the node lacks its profile (frame / joints): it cannot be switched on
  gripper_open?: boolean | null // null / absent: this function has no gripper
  speed?: number                // 0..1, a fraction of the function's top speed
  input_age_s?: number | null   // seconds since the input device last sent anything; null = never
  stalled?: boolean
  frame?: 'base' | 'tool'       // the frame of the twist right now (the tool-frame button held = 'tool')
  lock?: string | null          // the selected straight line: 'tool_z' | 'base_x' | 'base_y' | 'base_z' (the knob forward / back drives it)
  line?: boolean                // one axis at a time (only the main push axis is used)
  rotate?: boolean              // the rotation button is held
  rotation_on?: boolean         // false: translation only (rotation needs its button)
  battery?: number | null       // 0..1 charge of the INPUT DEVICE (e.g. a wireless SpaceMouse) when the node reports it; null / absent = not reported
  charging?: boolean            // the input device is charging (only with `battery`)
}
export interface TeleopFunction {
  name: string
  label: string
  available: boolean            // a fresh state has arrived: the function is running
  state?: TeleopState | null
  age_s?: number | null
}

export const SPEED_LEVELS = [0.25, 0.5, 1] as const

export type Tone = 'off' | 'wait' | 'on' | 'bad'

/** The pill: the text and its tone. A function that is not running says so (it cannot be switched on). */
export function stateLabel(f: TeleopFunction): { text: string; tone: Tone } {
  if (!f.available || !f.state) return { text: 'not running', tone: 'bad' }
  if (f.state.ready === false) return { text: 'not set up', tone: 'bad' }
  if (f.state.stalled) return { text: 'blocked', tone: 'wait' }
  if (f.state.state === 'hold') return { text: 'starting…', tone: 'wait' }
  if (f.state.state === 'active') return { text: 'driving', tone: 'on' }
  return { text: 'off', tone: 'off' }
}

export const isOn = (f: TeleopFunction): boolean => !!f.available && (f.state?.state === 'hold' || f.state?.state === 'active')

/** May the Enable button be offered: running, set up, off, and no run in flight. */
export const canEnable = (f: TeleopFunction, runInFlight: boolean): boolean =>
  f.available && !!f.state && f.state.ready !== false && f.state.state === 'inactive' && !runInFlight

/** The input device: connected when it sent something in the last 2 s (a SpaceMouse streams at 50 Hz even when idle). */
export function deviceText(f: TeleopFunction): { text: string; ok: boolean } {
  const age = f.state?.input_age_s
  if (age === null || age === undefined) return { text: 'no input device', ok: false }
  return age <= 2 ? { text: 'device ok', ok: true } : { text: 'device silent', ok: false }
}

/** The speed level (0.25 / 0.5 / 1) nearest to ``scale``. */
export function nearestLevel(scale: number | undefined): number {
  const s = typeof scale === 'number' ? scale : 1
  return SPEED_LEVELS.reduce((best, l) => Math.abs(l - s) < Math.abs(best - s) ? l : best, SPEED_LEVELS[SPEED_LEVELS.length - 1])
}

/** The gripper chip, or null when the function has no gripper. */
export const gripperText = (f: TeleopFunction): string | null =>
  f.state?.gripper_open === null || f.state?.gripper_open === undefined ? null : (f.state.gripper_open ? 'gripper open' : 'gripper closed')

/** What the function is doing besides on / off: the frame of the push, a line lock, the straight-line hold, rotation. Only what the node reports. */
export function modeChips(f: TeleopFunction): string[] {
  const st = f.state
  if (!st || !f.available) return []
  const out: string[] = []
  if (st.frame) out.push(st.frame === 'tool' ? 'tool frame' : 'base frame')
  if (st.lock) out.push(`line ${st.lock.replace('_', ' ')}`)
  else if (st.line) out.push('one axis')
  if (st.rotation_on === false) out.push('no rotation')
  else if (st.rotate) out.push('rotating')
  return out
}

/** The input device's battery as shown on the On / Off button: `🔋 78%` (`⚡` while charging); null when the node does not report it
 *  (the dashboard never guesses). `low` = 20 % or less and not charging. */
export function batteryInfo(f: TeleopFunction): { text: string; low: boolean } | null {
  const b = f.state?.battery
  if (!f.available || typeof b !== 'number' || !Number.isFinite(b)) return null
  const pct = Math.round(Math.min(1, Math.max(0, b)) * 100)
  return { text: `${f.state?.charging ? '⚡' : '🔋'} ${pct}%`, low: pct <= 20 && !f.state?.charging }
}

/** The text of the one On / Off button: it also says what the function is doing, so there is no separate state pill. */
export function driveLabel(f: TeleopFunction): string {
  const l = stateLabel(f)
  if (l.text === 'off') return '▶ On'
  if (l.text === 'driving') return '● driving'
  return l.text            // not running / not set up / starting… / blocked
}
