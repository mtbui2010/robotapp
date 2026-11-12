// Objects layer of the Map tab: pure logic (no React, no network; tested in scripts/test_lib.mjs).
//
// The backend declares the layer in the MAP config (`MAP.objects`, see MapObjectsConfig in types.ts and
// docs/features/map-tab.md "Objects layer"). Nothing about objects is known here: where they are read from, which
// fields hold x / y / label / kind, and which actions (spawn / move / remove) exist all come from that declaration.
import type { MapObjectsConfig, MapSkillCall } from './types'
import { getPath } from './robotPose'

export interface MapObject { id: string; x: number; y: number; label: string; kind: string; place: string; held: boolean }
export type ObjectAction = 'spawn' | 'move' | 'remove'
export type CallVars = { id?: string; x?: number; y?: number; place?: string; cls?: string }

const DEFAULT_FIELDS = { x: 'x', y: 'y', label: 'name', kind: 'cls', place: 'at', held: 'held', id: 'id' }

/** Dashboard polling period [ms] (MAP.objects.poll_s, default 1 s, never below 0.2 s). */
export const pollMs = (c: MapObjectsConfig): number => Math.max(0.2, Number(c.poll_s) || 1) * 1000

/** Whether the backend declared this action (the buttons exist only then). */
export const hasAction = (c: MapObjectsConfig | undefined | null, a: ObjectAction): boolean => !!c?.actions?.[a]?.skill

/** Objects out of a reply of the `read` call: a dict id -> entry, or a list of entries, found under `path`. Entries
 *  without a finite x and y are dropped (nothing to draw); a held object keeps its entry but the caller places it. */
export function parseObjects(reply: unknown, c: MapObjectsConfig): MapObject[] {
  const f = { ...DEFAULT_FIELDS, ...(c.fields ?? {}) }
  const root = c.path ? getPath(reply, c.path) : reply
  if (!root || typeof root !== 'object') return []
  const entries: [string, unknown][] = Array.isArray(root)
    ? root.map((v, i) => [String(getPath(v, f.id) ?? i), v] as [string, unknown])
    : Object.entries(root as Record<string, unknown>)
  const out: MapObject[] = []
  for (const [key, v] of entries) {
    const held = !!getPath(v, f.held)
    const x = Number(getPath(v, f.x)), y = Number(getPath(v, f.y))
    if (!held && !(Number.isFinite(x) && Number.isFinite(y))) continue
    const kind = String(getPath(v, f.kind) ?? '')
    const label = String(getPath(v, f.label) ?? kind ?? key)
    out.push({ id: key, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, label: label || key, kind,
               place: String(getPath(v, f.place) ?? ''), held })
  }
  return out
}

/** Where an object is drawn: a held one follows the robot (when its pose is known), the rest sit at their x, y. */
export function drawnAt(o: MapObject, robot: { x: number; y: number } | null): [number, number] | null {
  if (!o.held) return [o.x, o.y]
  return robot ? [robot.x, robot.y] : null
}

/** A stable colour per kind (same kind, same colour) without knowing any kind in advance. */
export function kindColor(kind: string): string {
  let h = 0
  for (const ch of kind) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 65% 45%)`
}

/** The tooltip of a marker: name, kind and place. */
export const objectTitle = (o: MapObject): string =>
  [o.label, o.kind && o.kind !== o.label ? `(${o.kind})` : '', o.place ? `at ${o.place}` : '', o.held ? '· held by the robot' : '']
    .filter(Boolean).join(' ')

/** The marker nearest to a point within `radius` [m] (held ones are ignored), or null. */
export function nearestObject(objs: MapObject[], x: number, y: number, radius = 0.25): MapObject | null {
  let best: MapObject | null = null, bd = radius
  for (const o of objs) {
    if (o.held) continue
    const d = Math.hypot(o.x - x, o.y - y)
    if (d <= bd) { best = o; bd = d }
  }
  return best
}

/** The `read` call as a request: GET /agent/<agent>/get or POST /agent/<agent>/send with a body. */
export const readRequest = (c: MapObjectsConfig): { agent: string; send: Record<string, unknown> | null } =>
  ({ agent: c.agent, send: c.read?.method === 'send' ? (c.read.body ?? {}) : null })

/** Fill an action template. A lone "{x}" keeps its type (number / string); "{a}-{b}" is a string; unknown
 *  placeholders and values the caller did not give stay as written. */
export function fillCall(call: MapSkillCall, vars: CallVars): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const val = (n: string): string | number | undefined => {
    const v = (vars as Record<string, string | number | undefined>)[n]
    return typeof v === 'number' ? Number(v.toFixed(3)) : v
  }
  for (const [k, t] of Object.entries(call.params ?? {})) {
    const lone = /^\{(\w+)\}$/.exec(t)
    out[k] = lone && val(lone[1]) !== undefined ? val(lone[1])
      : String(t).replace(/\{(\w+)\}/g, (m, n: string) => (val(n) === undefined ? m : String(val(n))))
  }
  return out
}
