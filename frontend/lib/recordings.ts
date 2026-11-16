// Raw VLA episodes (robot_agent GET /recordings): the Data tab's numbers and chart. Pure helpers; the fetches are `api.listRecordings` etc.
// Nothing here names a robot or a task: the robot's recorder wrote the episodes, the backend summarised them.
export interface RecSummary {
  duration_s: number
  rates_hz?: Record<string, number>
  max_gap_s?: Record<string, number>
  moving_fraction?: number
  idle_head_s?: number
  idle_tail_s?: number
  trim_suggest?: [number, number]
  init_moves?: { start: number; end: number; name: string | null }[]   // the arm went to a pose with teleop off (Go to): kept as the init part
  notes?: string[]
  gripper_changes?: number
  inactive_inside_s?: number
  max_speed_rad_s?: number
  warnings: string[]
}
export interface RecEdit { trim_start_s?: number; trim_end_s?: number; label?: string; exclude?: boolean; note?: string }
export interface RecRow {
  id: string
  day: string
  episode: string
  prompt: string
  label?: string | null
  summary: RecSummary
  edit?: RecEdit | null
  error?: string
}
export interface RecSeries { t: number[]; joints: number[][]; gripper: number[]; gripper_cmd?: number[] }
export interface RecDetail extends RecRow { series: RecSeries; cameras: Record<string, { frames: number; first_t: number }> }
export interface RecList { dir: string; episodes: RecRow[]; totals: { episodes: number; hours: number; success: number; failure: number; excluded: number } }
export interface RecExport { manifest: string; episodes: number; hours: number; command: string }

/** The label that counts: the operator's edit wins over the one given when recording. */
export const effectiveLabel = (r: RecRow): string => r.edit?.label || r.label || '?'

/** The part of the episode that is kept, in seconds: the edit's trim, else all of it. */
export function keptRange(r: RecRow): [number, number] {
  return [r.edit?.trim_start_s ?? 0, r.edit?.trim_end_s ?? r.summary.duration_s]
}

/** `83.4` -> `1:23.4`. */
export function fmtSec(s: number | null | undefined): string {
  const t = Math.max(0, s ?? 0)
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

/** Points of a polyline for `values` (one per time in `t`) drawn in a w x h box: time on x over [0, duration], values scaled into [lo, hi] (y down). */
export function polyline(t: number[], values: number[], duration: number, lo: number, hi: number, w: number, h: number): string {
  if (!t.length || duration <= 0) return ''
  const span = hi - lo || 1
  return t.map((x, i) => `${((x / duration) * w).toFixed(1)},${(h - ((values[i] - lo) / span) * h).toFixed(1)}`).join(' ')
}

/** The shared value range of the arm joints (so the curves can be compared), padded a little. */
export function jointRange(joints: number[][]): [number, number] {
  const all = joints.flat()
  if (!all.length) return [-1, 1]
  const lo = Math.min(...all), hi = Math.max(...all)
  const pad = (hi - lo || 1) * 0.05
  return [lo - pad, hi + pad]
}

/** A clock position (px in a chart `w` wide) -> seconds, clamped to the episode. */
export const xToTime = (x: number, w: number, duration: number): number => Math.max(0, Math.min(duration, (x / w) * duration))

/** Whether an edit form differs from what is saved (a trim equal to the whole episode counts as none). */
export function editChanged(saved: RecEdit | null | undefined, now: RecEdit, duration: number): boolean {
  const norm = (e: RecEdit | null | undefined) => ({
    a: e?.trim_start_s && e.trim_start_s > 0 ? e.trim_start_s : 0, b: e?.trim_end_s && e.trim_end_s < duration - 0.05 ? e.trim_end_s : duration,
    label: e?.label ?? '', exclude: !!e?.exclude, note: e?.note ?? '',
  })
  return JSON.stringify(norm(saved)) !== JSON.stringify(norm(now))
}

/** The one-line summary of an export result. */
export const exportText = (x: RecExport): string => `${x.episodes} episodes, ${x.hours.toFixed(2)} h → ${x.manifest}`

/** Whether the saved trim is already the suggested one (within 0.05 s). */
export function suggestApplied(r: RecRow): boolean {
  const s = r.summary.trim_suggest
  return !!s && r.edit?.trim_start_s !== undefined && Math.abs(r.edit.trim_start_s - s[0]) < 0.05 && Math.abs((r.edit.trim_end_s ?? -1) - s[1]) < 0.05
}

/** The one-line answer after an auto-clean. */
export function cleanText(x: { cleaned: number; skipped: number; rows: { kept_s: number; was_s: number }[] }): string {
  const cut = x.rows.reduce((a, r) => a + (r.was_s - r.kept_s), 0)
  return x.cleaned ? `trimmed ${x.cleaned} episode${x.cleaned > 1 ? 's' : ''} (${cut.toFixed(1)} s cut)${x.skipped ? `, ${x.skipped} left as they were` : ''}` : `nothing to trim (${x.skipped} left as they were)`
}

/** A default export name: `vla_20261116`. */
export const defaultExportName = (d = new Date()): string => `vla_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
