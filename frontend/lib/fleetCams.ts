// The Fleet tab's camera grid: pure logic (which cameras a robot offers, the default, the remembered choice, the tile state).
// No HTTP here: lib/api.ts reads each robot's cameras and opens the stream; the choice is a tab preference (lib/tabPref.ts).
import type { ClientEntry } from './types'
import { readTabPref, writeTabPref } from './tabPref'

export const LS_FLEET_CAMS = 'robotapp_fleet_cams'

export interface CamOption { id: string; label: string }

/** The cameras of a robot (GET /connects entries with is_camera), in the robot's own order. */
export const cameraOptions = (clients: ClientEntry[]): CamOption[] =>
  clients.filter(c => c.is_camera).map(c => ({ id: c.id, label: c.name || c.id }))

/** The remembered camera when the robot still has it, else its first camera, else null. */
export const pickCamera = (opts: CamOption[], saved?: string | null): string | null =>
  (saved && opts.some(o => o.id === saved) ? saved : opts[0]?.id) ?? null

export type TileState = 'loading' | 'unreachable' | 'no_camera' | 'ready'

/** What a tile shows: `opts` null = the robot's camera list is not read yet; `failed` = the read failed or timed out. */
export const tileState = (opts: CamOption[] | null, failed: boolean): TileState =>
  failed ? 'unreachable' : opts === null ? 'loading' : opts.length === 0 ? 'no_camera' : 'ready'

export const tileMessage = (s: TileState, url: string): string =>
  s === 'unreachable' ? `Cannot reach the robot at ${url}.` : s === 'no_camera' ? 'This robot has no camera.' : s === 'loading' ? 'Reading the cameras...' : ''

/** The remembered choices, robot id -> camera id ({} when none or unreadable). */
export const loadChoices = (): Record<string, string> => {
  try {
    const v = JSON.parse(readTabPref(LS_FLEET_CAMS) ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

export const rememberChoice = (robot: string, cam: string): void => {
  try { writeTabPref(LS_FLEET_CAMS, JSON.stringify({ ...loadChoices(), [robot]: cam })) } catch { /* not remembered */ }
}
