// The "Go to" poses (robot_agent /poses): each is a label and a plan of steps written like a shortcut button's plan. The operator edits them all; one speed applies
// to every pose. Pure helpers; the fetches are `api.listPoses` etc. Nothing here names a pose or a skill.
export interface Pose { id: string; label: string; plan: string }
export interface PoseList { speed: number; poses: Pose[]; defaults_missing: number }

/** The speeds offered for every pose (fractions of the top speed). */
export const POSE_SPEEDS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1] as const

/** The steps of a plan: the lines with `skill::arg` (a `#` starts a comment). */
export const planSteps = (plan: string): string[] =>
  plan.replace(/\\n/g, '\n').split('\n').map(l => l.split('#')[0].trim()).filter(l => l.includes('::'))

/** The nearest offered speed to `s` (so a speed set elsewhere still shows). */
export const nearestSpeed = (s: number): number => POSE_SPEEDS.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a), POSE_SPEEDS[0] as number)

/** Why a pose form cannot be saved ('' when it can): a label, at least one step, a label no other pose has. */
export function poseFormError(label: string, plan: string, poses: Pose[], editingId?: string): string {
  if (!label.trim()) return 'give the pose a name'
  if (!planSteps(plan).length) return 'write at least one step: skill::argument (for example movej::fold)'
  if (poses.some(p => p.id !== editingId && p.label.trim().toLowerCase() === label.trim().toLowerCase())) return `a pose named "${label.trim()}" already exists`
  return ''
}
