import { readTabPref } from './tabPref'

// The dashboard's planner choice (the chat's header select), shared with the Planner prompt panel. The planner and "plan only" belong to ONE tab
// (sessionStorage, lib/tabPref.ts); localStorage holds the last choice as the default of a new tab, so another tab cannot change this one.
export const LS_PLANNER = 'robotapp_planner'
export const PLANNER_EVENT = 'robotapp-planner'
export const DEFAULT_PLANNER = 'sage'    // SAGE + assist when nothing is stored
export type PlannerMethod = 'grace' | 'direct' | 'sage'

export const LS_PLAN_ONLY = 'robotapp_plan_only'   // '1' = plan only (default when nothing is stored)
export function storedPlanOnly(): boolean {
  const v = readTabPref(LS_PLAN_ONLY)
  return v === null ? true : v === '1'
}

export function storedPlanner(): string {
  return readTabPref(LS_PLANNER) || DEFAULT_PLANNER
}
