// The only client of the robot_fleet manager API (CLAUDE.md rule 1: robot_fleet's OpenAPI only through this file;
// robot_agent's stays in lib/api.ts). Routes: robot_fleet docs/SPEC.md section 6.
//
// The manager URL belongs to one browser tab, like the robot registry in lib/api.ts: each tab keeps its own in
// sessionStorage and the last one chosen seeds a new tab (lib/tabPref.ts). Default http://localhost:8100.
// Reading (robots, plans, plan, snapshot, subscribe) never starts anything; only submit / approve / answer /
// stopAll / releaseLock POST.
import { jsonCall } from './api'
import { readTabPref, writeTabPref } from './tabPref'
import type { CancelResult, FleetEvent, FleetPlan, FleetRobot, SubmitResult } from './fleet_types'

export const LS_FLEET_URL = 'robotapp_fleet_url'
export const DEFAULT_FLEET_URL = 'http://localhost:8100'

function getFleetUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_FLEET_URL
  return (readTabPref(LS_FLEET_URL) || DEFAULT_FLEET_URL).replace(/\/+$/, '')
}

function setFleetUrl(url: string): void {
  writeTabPref(LS_FLEET_URL, url.trim().replace(/\/+$/, '') || DEFAULT_FLEET_URL)
}

function getFleetWsBase(): string {
  return getFleetUrl().replace('https://', 'wss://').replace('http://', 'ws://')
}

const enc = encodeURIComponent
// A list the manager may send bare or wrapped ({robots: [...]}, {plans: [...]}, {results: [...]}).
const listOf = <T>(body: unknown, key: string): T[] => {
  if (Array.isArray(body)) return body as T[]
  const inner = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined
  return Array.isArray(inner) ? inner as T[] : []
}

/** Wait before reconnect attempt `n` (0-based): 1 s, 2 s, 4 s, 8 s, then 10 s. */
export const reconnectDelay = (n: number): number => Math.min(10_000, 1000 * 2 ** Math.max(0, n))

export type LiveStatus = 'connecting' | 'open' | 'closed'
export interface Subscription { close(): void }

/** WS /ws/fleet with reconnect until close(). Reading it never starts anything. */
function subscribe(onEvent: (e: FleetEvent) => void, onStatus: (s: LiveStatus) => void = () => {},
                   delay: (n: number) => number = reconnectDelay): Subscription {
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let tries = 0
  let stopped = false
  const open = () => {
    if (stopped) return
    onStatus('connecting')
    ws = new WebSocket(`${getFleetWsBase()}/ws/fleet`)
    ws.onopen = () => { tries = 0; onStatus('open') }
    ws.onmessage = m => {
      try { const e = JSON.parse(String(m.data)); if (e && typeof e.event === 'string') onEvent(e) } catch { /* not JSON: ignore */ }
    }
    ws.onclose = () => {
      ws = null
      onStatus('closed')
      if (!stopped) timer = setTimeout(open, delay(tries++))
    }
  }
  open()
  return { close() { stopped = true; if (timer) clearTimeout(timer); ws?.close() } }
}

export const fleet = {
  getFleetUrl,
  setFleetUrl,
  async robots(): Promise<FleetRobot[]> {
    return listOf<FleetRobot>(await jsonCall(`${getFleetUrl()}/fleet/robots`, 'GET'), 'robots')
  },
  // GET /fleet/plans is NOT in SPEC section 6 (only /fleet/plans/{id}): until the manager has it, an error here
  // means "no list"; the tab still shows the plans it submitted or saw on the WebSocket.
  async plans(): Promise<FleetPlan[]> {
    return listOf<FleetPlan>(await jsonCall(`${getFleetUrl()}/fleet/plans`, 'GET'), 'plans')
  },
  plan(id: string): Promise<FleetPlan> {
    return jsonCall<FleetPlan>(`${getFleetUrl()}/fleet/plans/${enc(id)}`, 'GET')
  },
  /** Everything the tab reads when it opens: GET only. A missing plan list is an empty list. */
  async snapshot(): Promise<{ robots: FleetRobot[]; plans: FleetPlan[] }> {
    const [robots, plans] = await Promise.all([fleet.robots(), fleet.plans().catch(() => [] as FleetPlan[])])
    return { robots, plans }
  },
  submit(text: string, lang?: string): Promise<SubmitResult> {
    return jsonCall<SubmitResult>(`${getFleetUrl()}/fleet/requests`, 'POST', lang ? { text, lang } : { text })
  },
  /** The ONLY call that starts motion (the manager releases goals to robots after it). */
  approve(id: string, operator: string): Promise<unknown> {
    return jsonCall(`${getFleetUrl()}/fleet/plans/${enc(id)}/approve`, 'POST', { operator })
  },
  answer(id: string, text: string): Promise<unknown> {
    return jsonCall(`${getFleetUrl()}/fleet/plans/${enc(id)}/answer`, 'POST', { text })
  },
  async stopAll(): Promise<CancelResult[]> {
    return listOf<CancelResult>(await jsonCall(`${getFleetUrl()}/fleet/stop`, 'POST'), 'results')
  },
  releaseLock(resource: string): Promise<unknown> {
    return jsonCall(`${getFleetUrl()}/fleet/locks/${enc(resource)}/release`, 'POST')
  },
  subscribe,
}
