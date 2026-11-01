import type { ClientEntry, ClientType, SkillDef, WorldState, PlannerPrompt, LlmInfo, LocationsInfo, PoolStatus } from './types'

// ------------------------------------------------------------------
// Robot registry — multiple named robots, one active at a time.
// Stored in localStorage:
//   robotapp_robots         JSON: [{ name, url }, ...]
//   robotapp_active_robot   name of the currently active robot — the default for a NEW tab; each tab keeps its
//                           own choice in sessionStorage (same key), so two tabs can drive two robots (2026-10-27:
//                           both tabs read the one localStorage key at every call, and the tab that picked a robot
//                           last sent the other tab's calls — skills, configs, Location — to its robot)
// Legacy single-URL `agent_url` is auto-migrated on first read.
// ------------------------------------------------------------------
export interface Robot { name: string; url: string }

const LS_ROBOTS = 'robotapp_robots'
const LS_ACTIVE = 'robotapp_active_robot'
const LS_LEGACY = 'agent_url'

function readRobots(): Robot[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_ROBOTS)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter(r => r && r.name && r.url)
    }
  } catch { /* fall through */ }

  // Legacy migration: build a single-robot list from the old `agent_url` key.
  const legacy = localStorage.getItem(LS_LEGACY)
  if (legacy) {
    const list: Robot[] = [{ name: 'default', url: legacy.replace(/\/+$/, '') }]
    localStorage.setItem(LS_ROBOTS, JSON.stringify(list))
    localStorage.setItem(LS_ACTIVE, 'default')
    return list
  }
  return []
}

function writeRobots(list: Robot[]): void {
  if (typeof window !== 'undefined')
    localStorage.setItem(LS_ROBOTS, JSON.stringify(list))
}

function listRobots(): Robot[] {
  return readRobots()
}

function getActiveRobotName(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const own = sessionStorage.getItem(LS_ACTIVE)
    if (own !== null) return own
    // first read in this tab: adopt the last choice, and keep it even when another tab picks another robot
    const last = localStorage.getItem(LS_ACTIVE)
    if (last !== null) sessionStorage.setItem(LS_ACTIVE, last)
    return last
  } catch {
    return localStorage.getItem(LS_ACTIVE)
  }
}

function setActiveRobot(name: string): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(LS_ACTIVE, name) } catch { /* no session storage: shared choice only */ }
  localStorage.setItem(LS_ACTIVE, name)       // the default for tabs opened later
}

function addRobot(name: string, url: string): { ok: boolean; error?: string } {
  name = name.trim()
  url = url.trim().replace(/\/+$/, '')
  if (!name) return { ok: false, error: 'Name is required' }
  if (!url)  return { ok: false, error: 'URL is required' }
  const list = readRobots()
  if (list.some(r => r.name === name))
    return { ok: false, error: `Robot "${name}" already exists` }
  list.push({ name, url })
  writeRobots(list)
  if (!getActiveRobotName()) setActiveRobot(name)
  return { ok: true }
}

function updateRobot(name: string, newName: string, newUrl: string): { ok: boolean; error?: string } {
  newName = newName.trim()
  newUrl = newUrl.trim().replace(/\/+$/, '')
  if (!newName) return { ok: false, error: 'Name is required' }
  if (!newUrl)  return { ok: false, error: 'URL is required' }
  const list = readRobots()
  const idx = list.findIndex(r => r.name === name)
  if (idx < 0) return { ok: false, error: `Robot "${name}" not found` }
  if (newName !== name && list.some(r => r.name === newName))
    return { ok: false, error: `Robot "${newName}" already exists` }
  list[idx] = { name: newName, url: newUrl }
  writeRobots(list)
  if (getActiveRobotName() === name) setActiveRobot(newName)
  return { ok: true }
}

function removeRobot(name: string): void {
  const list = readRobots().filter(r => r.name !== name)
  writeRobots(list)
  if (getActiveRobotName() === name)
    setActiveRobot(list[0]?.name ?? '')
}

// Returns the URL of the active robot. Falls back to same-host :8001 when no
// robot is configured yet (preserves the legacy default).
function getAgentUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:8001'
  const active = getActiveRobotName()
  if (active) {
    const r = readRobots().find(x => x.name === active)
    if (r) return r.url
  }
  return `http://${window.location.hostname}:8001`
}

// Update the active robot's URL (or seed one named 'default' if no robots yet).
function setAgentUrl(url: string): void {
  if (typeof window === 'undefined') return
  url = url.replace(/\/+$/, '')
  const list = readRobots()
  const active = getActiveRobotName()
  if (active) {
    const idx = list.findIndex(r => r.name === active)
    if (idx >= 0) {
      list[idx] = { name: active, url }
      writeRobots(list)
      return
    }
  }
  // No active robot yet — seed one.
  list.push({ name: 'default', url })
  writeRobots(list)
  setActiveRobot('default')
}

function getWsBase(): string {
  return getAgentUrl().replace('https://', 'wss://').replace('http://', 'ws://')
}

// Body of a skill add / update, or throw with the backend's reason — a plan
// skill naming an unknown skill, or calling itself, is refused with a 400.
async function skillResponse(r: Response) {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const detail = (body as { detail?: unknown }).detail
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${r.status}`)
  }
  return body
}

async function mapPost(body: Record<string, unknown>) {
  const r = await fetch(`${getAgentUrl()}/map/snapshot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof b?.detail === 'string' ? b.detail : `HTTP ${r.status}`)
  return b
}

export const api = {
  // Agent URL helpers (used by DevicePanel)
  getAgentUrl,
  setAgentUrl,
  // Multi-robot helpers
  listRobots,
  addRobot,
  updateRobot,
  removeRobot,
  getActiveRobotName,
  setActiveRobot,

  // ── Devices ──────────────────────────────────────────────
  async scanRos() {
    const r = await fetch(`${getAgentUrl()}/ros/scan`)
    return r.json()
  },

  async listClients(): Promise<ClientEntry[]> {
    const r = await fetch(`${getAgentUrl()}/connects`)
    if (!r.ok) return []
    const data = await r.json()
    return Array.isArray(data) ? data : []
  },

  async getStatus(fresh = false): Promise<Record<string, boolean>> {
    const r = await fetch(`${getAgentUrl()}/connects/status${fresh ? '?fresh=1' : ''}`)
    if (!r.ok) return {}
    return r.json()
  },

  // Per AI-server connection: level + each server's state (what the backend knows; nothing is probed).
  async getServers(): Promise<Record<string, PoolStatus>> {
    try {
      const r = await fetch(`${getAgentUrl()}/connects/servers`)
      if (!r.ok) return {}
      return r.json()
    } catch { return {} }
  },

  async addClient(type: ClientType, name: string, config: Record<string, unknown>) {
    const r = await fetch(`${getAgentUrl()}/connects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name, config }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = (body as { detail?: unknown }).detail
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map(d => (d as { msg?: string }).msg ?? JSON.stringify(d)).join('; ')
          : `HTTP ${r.status}`
      return { id: '', error: msg }
    }
    return body as { id: string; error: string }
  },

  async deleteClient(id: string) {
    await fetch(`${getAgentUrl()}/connects/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async updateClient(id: string, name: string, config: Record<string, unknown>) {
    const r = await fetch(`${getAgentUrl()}/connects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = (body as { detail?: unknown }).detail
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map(d => (d as { msg?: string }).msg ?? JSON.stringify(d)).join('; ')
          : `HTTP ${r.status}`
      return { id, error: msg }
    }
    return body as { id: string; error: string }
  },

  async setActiveLlm(id: string) {
    const r = await fetch(`${getAgentUrl()}/connects/${encodeURIComponent(id)}/set_active`, {
      method: 'POST',
    })
    return r.json() as Promise<{ ok: boolean }>
  },

  // ── Skills ───────────────────────────────────────────────
  async listSkills(): Promise<SkillDef[]> {
    const r = await fetch(`${getAgentUrl()}/skills`)
    if (!r.ok) return []
    const data = await r.json()
    return Array.isArray(data) ? data : []
  },

  async getSkillsStatus(): Promise<Record<string, { ok: boolean; error: string }>> {
    try {
      const r = await fetch(`${getAgentUrl()}/skills/status`)
      if (!r.ok) return {}
      return r.json()
    } catch { return {} }
  },

  async addSkill(skill: Partial<SkillDef>) {
    const r = await fetch(`${getAgentUrl()}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skill),
    })
    return skillResponse(r)
  },

  // ── Skill Configs ────────────────────────────────────
  async getSkillConfig(name: string): Promise<Record<string, unknown> | null> {
    try {
      const r = await fetch(`${getAgentUrl()}/skill-configs/${encodeURIComponent(name)}`)
      if (!r.ok) return null
      return r.json()
    } catch { return null }
  },

  /** Names of every skill-config group the agent serves (GET /skill-configs). */
  async listSkillConfigNames(): Promise<string[]> {
    try {
      const r = await fetch(`${getAgentUrl()}/skill-configs`)
      if (!r.ok) return []
      return Object.keys(await r.json())
    } catch { return [] }
  },

  async updateSkillConfig(name: string, value: Record<string, unknown>) {
    const r = await fetch(`${getAgentUrl()}/skill-configs/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      // e.g. an ENV alias that already names another location (400 + detail)
      const detail = (body as { detail?: unknown }).detail
      throw new Error(typeof detail === 'string' ? detail : `HTTP ${r.status}`)
    }
    return body
  },

  /** Save only what changed since `base` (the group as loaded): PATCH /skill-configs/<name> merges
   *  per top-level entry (per location for ENV), so another machine's newer entries are kept.
   *  Returns the group as saved. */
  async mergeSkillConfig(name: string, base: Record<string, unknown>, value: Record<string, unknown>):
      Promise<Record<string, unknown>> {
    const r = await fetch(`${getAgentUrl()}/skill-configs/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base, value }),
    })
    if (r.status === 405) {          // a backend from before 2026-10-26: plain PUT of the whole group
      await api.updateSkillConfig(name, value)
      return value
    }
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = (body as { detail?: unknown }).detail
      throw new Error(typeof detail === 'string' ? detail : `HTTP ${r.status}`)
    }
    return (body as { value: Record<string, unknown> }).value
  },

  async updateSkill(name: string, data: Partial<SkillDef>) {
    const r = await fetch(`${getAgentUrl()}/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return skillResponse(r)
  },

  async deleteSkill(name: string) {
    const r = await fetch(`${getAgentUrl()}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    return skillResponse(r)      // refused while a plan skill still calls it
  },

  async reloadSkills(): Promise<{ ok: boolean; count: number }> {
    const r = await fetch(`${getAgentUrl()}/skills/reload`, { method: 'POST' })
    return r.json()
  },

  async setLlmConfig(config: Record<string, unknown>) {
    const r = await fetch(`${getAgentUrl()}/agent/llm-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    })
    return r.json()
  },

  async getLlmConfig(): Promise<LlmInfo> {
    try {
      const r = await fetch(`${getAgentUrl()}/agent/llm-config`)
      if (!r.ok) return {}
      return r.json()
    } catch { return {} }
  },

  async setApiKey(provider: string, key: string) {
    const r = await fetch(`${getAgentUrl()}/agent/api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    })
    return r.json()
  },

  async getApiKeys(): Promise<Record<string, boolean>> {
    const r = await fetch(`${getAgentUrl()}/agent/api-keys`)
    if (!r.ok) return {}
    return r.json()
  },

  // ── World state (persistent symbolic belief) ───────────────
  async getWorld(): Promise<WorldState> {
    const r = await fetch(`${getAgentUrl()}/agent/world`)
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  // Transcript for a pending HRI listen request from a running skill
  // (kcare hri.reply / hri.ask with source='dashboard'). A 404 just means
  // the skill stopped waiting; nothing to do about it here.
  /** A recorded phrase for a listen with capture='whisper'; the robot
   *  transcribes it and returns the text ('' for none). */
  async answerListenAudio(id: string, blob: Blob | null, mime: string, note?: string): Promise<string> {
    const q = note ? `?note=${encodeURIComponent(note)}` : ''
    const r = await fetch(`${getAgentUrl()}/agent/listen/${encodeURIComponent(id)}/audio${q}`, {
      method: 'POST',
      headers: { 'Content-Type': mime || 'audio/webm' },
      body: blob ?? new Blob([]),
    })
    if (!r.ok) return ''
    return String((await r.json().catch(() => ({})))?.text ?? '')
  },

  async answerListen(id: string, text: string, error?: string, note?: string): Promise<void> {
    await fetch(`${getAgentUrl()}/agent/listen/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, error: error ?? null, note: note ?? null }),
    })
  },

  // Stop the robot: the backend cancels every ROS command in flight and ends
  // the run. Closing the agent WebSocket alone does not reach the robot — the
  // plan keeps executing in a backend thread.
  async cancelRun(): Promise<void> {
    await fetch(`${getAgentUrl()}/agent/cancel`, { method: 'POST' })
  },

  /** End the running `qa` conversation as a stop word would ("End Q&A"): the
   *  skill says goodbye and succeeds, the plan goes on. Throws the backend's
   *  detail when no qa is running (409). */
  async endQa(): Promise<void> {
    const r = await fetch(`${getAgentUrl()}/agent/qa/end`, { method: 'POST' })
    if (!r.ok) {
      let detail = `HTTP ${r.status}`
      try { detail = (await r.json()).detail ?? detail } catch { /* not json */ }
      throw new Error(detail)
    }
  },

  async setWorld(patch: Partial<WorldState>): Promise<WorldState> {
    const r = await fetch(`${getAgentUrl()}/agent/world`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  // ── Planner prompt (read-only; built by the backend from the robot each time it plans) ──
  // `planner`: the dashboard's planner choice, so the answer says whether that planner uses it.
  async plannerPrompt(command: string, planner?: string): Promise<PlannerPrompt> {
    const q = new URLSearchParams({ command })
    if (planner) q.set('planner', planner)
    const r = await fetch(`${getAgentUrl()}/planner/prompt?${q.toString()}`)
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      throw new Error((b as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  // ── Shortcut Buttons (per-robot, server-side) ───────────────
  async listButtons(): Promise<{ id: string; label: string; plan: string }[]> {
    const r = await fetch(`${getAgentUrl()}/buttons`)
    if (!r.ok) return []
    const data = await r.json()
    return Array.isArray(data) ? data : []
  },

  async addButton(label: string, plan: string) {
    const r = await fetch(`${getAgentUrl()}/buttons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, plan }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json() as Promise<{ id: string; label: string; plan: string }>
  },

  async updateButton(id: string, fields: { label?: string; plan?: string }) {
    const r = await fetch(`${getAgentUrl()}/buttons/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  async deleteButton(id: string) {
    const r = await fetch(`${getAgentUrl()}/buttons/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
  },

  async reorderButtons(ids: string[]) {
    const r = await fetch(`${getAgentUrl()}/buttons/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
  },

  async bulkAddButtons(items: { label: string; plan: string }[]) {
    const r = await fetch(`${getAgentUrl()}/buttons/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json() as Promise<{ added: { id: string; label: string; plan: string }[]; count: number }>
  },

  // ── Location config profiles (per-robot, server-side) ──────
  // Each robot backend stores one config folder per deployment site (its own
  // connections + global configs). One site is active at a time; switching is
  // a live hot-reload on the backend.
  async listLocations(): Promise<LocationsInfo> {
    try {
      const r = await fetch(`${getAgentUrl()}/config/locations`)
      if (!r.ok) return { locations: [], active: '' }
      return r.json()
    } catch { return { locations: [], active: '' } }
  },

  async activateLocation(name: string): Promise<LocationsInfo> {
    const r = await fetch(`${getAgentUrl()}/config/locations/${encodeURIComponent(name)}/activate`, {
      method: 'POST',
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  async createLocation(name: string, copyFrom?: string): Promise<LocationsInfo> {
    const r = await fetch(`${getAgentUrl()}/config/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, copy_from: copyFrom ?? null }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  async renameLocation(name: string, newName: string): Promise<LocationsInfo> {
    const r = await fetch(`${getAgentUrl()}/config/locations/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  async deleteLocation(name: string): Promise<LocationsInfo> {
    const r = await fetch(`${getAgentUrl()}/config/locations/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
    }
    return r.json()
  },

  // ── WebSockets ───────────────────────────────────────────
  // Run one skill with keyword params (POST /skill/<name>); resolves with the skill's result dict.
  async runSkill(name: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const r = await fetch(`${getAgentUrl()}/skill/${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },

  // Send data straight to a device agent (POST /agent/<name>/send) — e.g. the simulation's sim_command.
  async agentSend(name: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await fetch(`${getAgentUrl()}/agent/${encodeURIComponent(name)}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },

  // Latest value of a device agent, read-only (GET /agent/<name>/get) — unlike runSkill it never
  // clears a pending cancel, so it is safe to poll.
  async agentGet(name: string): Promise<unknown> {
    const r = await fetch(`${getAgentUrl()}/agent/${encodeURIComponent(name)}/get`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return (await r.json()).value
  },

  // URL of a static file of the active site (map layers), GET /config/locations/_active/files/<path>.
  /** Save a SLAM map connection (nav_msgs/OccupancyGrid) as the active site's map files and
   *  update its MAP config (POST /map/snapshot). Throws with the backend's reason. */
  async mapSnapshot(connection: string, opts: { keep?: [number, number][]; inflate_m?: number } = {}): Promise<{
    ok: boolean; frame: { origin: [number, number]; resolution: number; width: number; height: number }
    size_m: [number, number]; cells: { known: number; occupied: number; unknown: number }; missing: string[]
    kept: boolean; specks: number }> {
    return mapPost({ connection, inflate_m: opts.inflate_m ?? 0.3, ...(opts.keep ? { keep: opts.keep } : {}) })
  },

  /** The connection's whole map as a PNG data URL, untidied and not saved (Map tab → Keep area). */
  async mapPreview(connection: string): Promise<{ image: string; frame: { origin: [number, number]; resolution: number; width: number; height: number } }> {
    return mapPost({ connection, preview: true })
  },

  siteFileUrl(path: string): string {
    return `${getAgentUrl()}/config/locations/_active/files/${path.split('/').map(encodeURIComponent).join('/')}`
  },

  agentWs(): WebSocket {
    return new WebSocket(`${getWsBase()}/ws/agent`)
  },

  cameraWs(clientId: string): WebSocket {
    return new WebSocket(`${getWsBase()}/ws/camera/${clientId}`)
  },
}
