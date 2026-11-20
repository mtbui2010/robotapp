// Pure logic of the fleet selector and editor (docs/features/fleet.md): the selector's options, validation of a
// fleet, the diff between a fleet and the manager's config, and keeping fleets right when a registry robot is
// renamed or deleted. No storage, no HTTP (tests: scripts/test_fleet.mjs).
import type { FleetConfig, FleetDef, FleetMember, FleetRobotBody } from './fleet_types'

export interface SelectorOption { group: 'Robots' | 'Fleets'; value: string; label: string }
export type Selection = { kind: 'robot' | 'fleet'; name: string } | null

/** Options of the one drop-down: the registry robots, then (second group) the fleets. */
export function selectorOptions(robots: { name: string }[], fleets: { name: string }[]): SelectorOption[] {
  return [
    ...robots.map(r => ({ group: 'Robots' as const, value: `robot:${r.name}`, label: r.name })),
    ...fleets.map(f => ({ group: 'Fleets' as const, value: `fleet:${f.name}`, label: f.name })),
  ]
}

export function parseSelection(value: string): Selection {
  const m = /^(robot|fleet):(.+)$/.exec(value)
  return m ? { kind: m[1] as 'robot' | 'fleet', name: m[2] } : null
}

/** A draft member: `real` is null until the operator chooses. */
export interface DraftMember { name: string; real: boolean | null }
export interface FleetDraft { name: string; url: string; members: DraftMember[] }

/** Why the draft cannot be saved (null = it can): a name, a URL, a unique name, and a real/sim choice per member. */
export function draftProblem(d: FleetDraft, fleets: FleetDef[], original: string | null): string | null {
  const name = d.name.trim()
  if (!name) return 'Name is required'
  if (!d.url.trim()) return 'Manager URL is required'
  if (fleets.some(f => f.name === name && f.name !== original)) return `Fleet "${name}" already exists`
  const open = d.members.filter(m => m.real === null).map(m => m.name)
  if (open.length) return `Choose real or simulated for: ${open.join(', ')}`
  return null
}

/** The draft as a stored fleet (call only when draftProblem is null). */
export function draftToFleet(d: FleetDraft): FleetDef {
  return {
    name: d.name.trim(),
    url: d.url.trim().replace(/\/+$/, ''),
    members: d.members.map(m => ({ name: m.name, real: m.real === true })),
  }
}

export function fleetToDraft(f: FleetDef | null, defaultUrl: string): FleetDraft {
  return f ? { name: f.name, url: f.url, members: f.members.map(m => ({ ...m })) }
           : { name: '', url: defaultUrl, members: [] }
}

/** Tick / untick a robot in the draft (a newly ticked one has no real/sim choice yet). */
export function toggleMember(d: FleetDraft, name: string): FleetDraft {
  const has = d.members.some(m => m.name === name)
  return { ...d, members: has ? d.members.filter(m => m.name !== name) : [...d.members, { name, real: null }] }
}

export function setMemberReal(d: FleetDraft, name: string, real: boolean): FleetDraft {
  return { ...d, members: d.members.map(m => (m.name === name ? { ...m, real } : m)) }
}

export interface SyncPlan { put: { id: string; body: FleetRobotBody }[]; del: string[] }

/** What to send so the manager matches the fleet: PUT every member (a robot's url comes from the registry), DELETE
 *  the robots the manager has that are not members. A member with no registry URL is reported in `missing`. */
export function diffConfig(f: FleetDef, config: FleetConfig, urlOf: (robot: string) => string | undefined):
    SyncPlan & { missing: string[] } {
  const put: SyncPlan['put'] = []
  const missing: string[] = []
  for (const m of f.members) {
    const url = urlOf(m.name)
    if (url) put.push({ id: m.name, body: { url, real: m.real } })
    else missing.push(m.name)
  }
  const keep = new Set(f.members.map(m => m.name))
  const del = (config.robots ?? []).map(r => r.id).filter(id => !keep.has(id))
  return { put, del, missing }
}

/** Fleets that work with the robot (for the warning before it is removed from the registry). */
export const fleetsUsing = (fleets: FleetDef[], robot: string): string[] =>
  fleets.filter(f => f.members.some(m => m.name === robot)).map(f => f.name)

/** The fleets without the robot. */
export const dropRobot = (fleets: FleetDef[], robot: string): FleetDef[] =>
  fleets.map(f => ({ ...f, members: f.members.filter(m => m.name !== robot) }))

/** The fleets with the robot renamed. */
export const renameRobot = (fleets: FleetDef[], from: string, to: string): FleetDef[] =>
  fleets.map(f => ({ ...f, members: f.members.map((m: FleetMember) => (m.name === from ? { ...m, name: to } : m)) }))
