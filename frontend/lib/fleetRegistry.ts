// The fleets the dashboard knows, kept in the browser like the robot registry in lib/api.ts (no HTTP here).
//   localStorage robotapp_fleets        JSON: [{ name, url, members: [{ name, real }] }]  (shared by all tabs)
//   robotapp_active_fleet               the fleet this tab works with ('' = none, a robot is selected): per tab in
//                                       sessionStorage, the last choice seeds a new tab (lib/tabPref.ts), the same
//                                       pattern as robotapp_active_robot, so two tabs can show two fleets.
import { readTabPref, writeTabPref } from './tabPref'
import { dropRobot, renameRobot } from './fleetEdit'
import type { FleetDef } from './fleet_types'

export const LS_FLEETS = 'robotapp_fleets'
export const LS_ACTIVE_FLEET = 'robotapp_active_fleet'
/** Fired (on window) when this tab's fleet changes (the Fleet tab re-reads its manager URL). */
export const FLEET_CHANGED_EVENT = 'robotapp:fleet-changed'

export function listFleets(): FleetDef[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_FLEETS) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter(f => f && f.name && f.url).map(f => ({ ...f, members: Array.isArray(f.members) ? f.members : [] }))
      : []
  } catch { return [] }
}

function writeFleets(list: FleetDef[]): void {
  try { localStorage.setItem(LS_FLEETS, JSON.stringify(list)) } catch { /* no storage: nothing saved */ }
}

export const getActiveFleetName = (): string => readTabPref(LS_ACTIVE_FLEET) || ''

export function setActiveFleet(name: string): void {
  if (typeof window === 'undefined') return
  writeTabPref(LS_ACTIVE_FLEET, name)
  window.dispatchEvent(new Event(FLEET_CHANGED_EVENT))
}

export function activeFleet(): FleetDef | null {
  const n = getActiveFleetName()
  return (n && listFleets().find(f => f.name === n)) || null
}

/** Add (original null) or replace a fleet; the name is unique. The caller validated it (fleetEdit.draftProblem). */
export function saveFleet(original: string | null, def: FleetDef): void {
  const list = listFleets()
  const i = original === null ? -1 : list.findIndex(f => f.name === original)
  if (i >= 0) list[i] = def; else list.push(def)
  writeFleets(list)
  if (original !== null && original !== def.name && getActiveFleetName() === original) setActiveFleet(def.name)
}

export function removeFleet(name: string): void {
  writeFleets(listFleets().filter(f => f.name !== name))
  if (getActiveFleetName() === name) setActiveFleet('')
}

export function setFleetUrlOf(name: string, url: string): void {
  writeFleets(listFleets().map(f => (f.name === name ? { ...f, url } : f)))
}

/** A registry robot was deleted: take it out of every fleet. */
export const forgetRobot = (robot: string): void => writeFleets(dropRobot(listFleets(), robot))
/** A registry robot was renamed: follow it in every fleet. */
export const followRobot = (from: string, to: string): void => writeFleets(renameRobot(listFleets(), from, to))
