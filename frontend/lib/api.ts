import type { ClientEntry, ClientType, SkillDef } from './types'

// ------------------------------------------------------------------
// Robot registry — multiple named robots, one active at a time.
// Stored in localStorage:
//   robotapp_robots         JSON: [{ name, url }, ...]
//   robotapp_active_robot   name of the currently active robot
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
  return localStorage.getItem(LS_ACTIVE)
}

function setActiveRobot(name: string): void {
  if (typeof window !== 'undefined')
    localStorage.setItem(LS_ACTIVE, name)
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

  async getStatus(): Promise<Record<string, boolean>> {
    const r = await fetch(`${getAgentUrl()}/connects/status`)
    if (!r.ok) return {}
    return r.json()
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
    return r.json()
  },

  // ── Skill Configs ────────────────────────────────────
  async getSkillConfig(name: string): Promise<Record<string, unknown> | null> {
    try {
      const r = await fetch(`${getAgentUrl()}/skill-configs/${encodeURIComponent(name)}`)
      if (!r.ok) return null
      return r.json()
    } catch { return null }
  },

  async updateSkillConfig(name: string, value: Record<string, unknown>) {
    const r = await fetch(`${getAgentUrl()}/skill-configs/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
    return r.json()
  },

  async updateSkill(name: string, data: Partial<SkillDef>) {
    const r = await fetch(`${getAgentUrl()}/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return r.json()
  },

  async deleteSkill(name: string) {
    await fetch(`${getAgentUrl()}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
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

  // ── WebSockets ───────────────────────────────────────────
  agentWs(): WebSocket {
    return new WebSocket(`${getWsBase()}/ws/agent`)
  },

  cameraWs(clientId: string): WebSocket {
    return new WebSocket(`${getWsBase()}/ws/camera/${clientId}`)
  },
}
