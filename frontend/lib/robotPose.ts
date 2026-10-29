import { api } from './api'
import type { MapConfig } from './types'

// Reading the robot's pose the way the Map tab does: MAP.pose names a device agent and the paths of
// x / y / orientation (quaternion) or yaw inside its value (GET /agent/<agent>/get — read-only, never
// clears a pending cancel).

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

export function quatYaw(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
}

/** {x, y, yaw [rad]} in the robot's map frame, from the value of MAP.pose's agent. */
export function poseFrom(v: unknown, p: NonNullable<MapConfig['pose']>): { x: number; y: number; yaw: number } | null {
  const x = Number(getPath(v, p.x)), y = Number(getPath(v, p.y))
  let yaw = 0
  if (p.orientation) yaw = quatYaw(getPath(v, p.orientation) as { x: number; y: number; z: number; w: number })
  else if (p.yaw) yaw = Number(getPath(v, p.yaw)) * (p.angle === 'deg' ? Math.PI / 180 : 1)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, yaw } : null
}

/** The robot's pose now, read through the active site's MAP.pose; throws with the reason. */
export async function readRobotPose(): Promise<{ x: number; y: number; yaw: number }> {
  const map = (await api.getSkillConfig('MAP')) as MapConfig | null
  if (!map?.pose) throw new Error('this site has no MAP.pose (Map tab ⚙ Settings)')
  const pose = poseFrom(await api.agentGet(map.pose.agent), map.pose)
  if (!pose) throw new Error(`no pose in ${map.pose.agent}`)
  return pose
}
