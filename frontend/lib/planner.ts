// The dashboard's planner choice (AgentPanel), shared with the Planner prompt panel.
export const LS_PLANNER = 'robotapp_planner'
export const PLANNER_EVENT = 'robotapp-planner'
export const DEFAULT_PLANNER = 'grace'   // AgentPanel's default when nothing is stored

export function storedPlanner(): string {
  try { return localStorage.getItem(LS_PLANNER) || DEFAULT_PLANNER } catch { return DEFAULT_PLANNER }
}
