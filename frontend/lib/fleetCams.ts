// The Fleet tab's camera grid: pure logic (which cameras a robot offers, the default, the remembered choice, the tile state).
// No HTTP here: lib/api.ts reads each robot's cameras and opens the stream; the choice is a tab preference (lib/tabPref.ts).
import type { ClientEntry } from './types'
import { readTabPref, writeTabPref } from './tabPref'

export const LS_FLEET_CAMS = 'robotapp_fleet_cams'
export const LS_FLEET_COLS = 'robotapp_fleet_cols'

/** How many robot tiles the Fleet tab shows on one row: 1 to COLS_MAX, default 2 (anything else reads as the default). */
export const COLS_DEFAULT = 2
export const COLS_MAX = 6
export const clampCols = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, COLS_MAX) : COLS_DEFAULT
}
export const loadCols = (): number => clampCols(readTabPref(LS_FLEET_COLS))
export const saveCols = (n: number): void => writeTabPref(LS_FLEET_COLS, String(clampCols(n)))

export interface CamOption { id: string; label: string }

/** The cameras of a robot (GET /connects entries with is_camera), in the robot's own order. */
export const cameraOptions = (clients: ClientEntry[]): CamOption[] =>
  clients.filter(c => c.is_camera).map(c => ({ id: c.id, label: c.name || c.id }))

/** The Fleet tab's default view (owner, 2026-11-23): a camera that shows the robot from outside (its id or name says "overview"), else the
 *  head camera `head_rgb`, else the robot's first camera. These are naming conventions of the camera list, not robot facts: a robot without
 *  such a name keeps its own first camera. */
const OUTSIDE_VIEW = /overview/i
const HEAD_VIEW = 'head_rgb'
const defaultCamera = (opts: CamOption[]): CamOption | undefined =>
  opts.find(o => OUTSIDE_VIEW.test(o.id) || OUTSIDE_VIEW.test(o.label)) ?? opts.find(o => o.id === HEAD_VIEW) ?? opts[0]

/** The remembered camera when the robot still has it, else the default view (outside, then head_rgb, then the first camera), else null. */
export const pickCamera = (opts: CamOption[], saved?: string | null): string | null =>
  (saved && opts.some(o => o.id === saved) ? saved : defaultCamera(opts)?.id) ?? null

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
