'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { ClientEntry, ClientType, RosScanResult } from '../lib/types'
import type { Robot } from '../lib/api'
import TEMPLATES_RAW from '../lib/ros_templates.json'

interface RosTemplate {
  id: string
  label: string
  interfaces: string[]
  keywords: string[]
  conn_types: string[]
  builtin: boolean
  description: string
  encode_func: string | null
  decode_func: string | null
}

const TEMPLATES = TEMPLATES_RAW as RosTemplate[]

function recommendTemplates(iface: string, connType: string): RosTemplate[] {
  const scored = TEMPLATES
    .filter(t => t.conn_types.includes(connType))
    .map(t => {
      let score = 0
      if (t.interfaces.includes(iface)) score += 10
      t.keywords.forEach(kw => { if (iface.includes(kw)) score += 1 })
      return { t, score }
    })
    .filter(({ score, t }) => score > 0 || t.keywords.length === 0)
    .sort((a, b) => b.score - a.score)
  return scored.map(({ t }) => t)
}

const TYPE_LABELS: Record<ClientType, string> = {
  ros_service: 'ROS Service',
  ros_topic:   'ROS Topic',
  ros_action:  'ROS Action',
  webrtc:      'WebRTC',
  llm:         'LLM',
  tcp:         'TCP/IP',
}

type LLMProvider = 'llama' | 'chatgpt' | 'gemini'

interface FormFields {
  type: ClientType
  // ROS
  agentName: string
  connName: string
  dataInterface: string
  isCamera: boolean
  isClient: boolean
  encodeFuncCode: string
  decodeFuncCode: string
  selectedTemplateId: string | null
  // WebRTC / TCP
  host: string
  port: string
  // TCP server
  runFuncCode: string
  // LLM
  provider: LLMProvider
  url: string
  model: string
  apiKey: string
}

const DEFAULT_FORM: FormFields = {
  type: 'ros_service',
  agentName: '', connName: '', dataInterface: '', isCamera: false, isClient: true,
  encodeFuncCode: '', decodeFuncCode: '', selectedTemplateId: null,
  host: '192.168.1.10', port: '8443',
  runFuncCode: '',
  provider: 'llama', url: 'http://localhost:11434', model: '', apiKey: '',
}

interface Props {
  onClientsChange: (clients: ClientEntry[]) => void
  onAgentConnect?: () => void
}

function getHead(name: string): string {
  return name.replace(/^\//, '').split(/[/_]/)[0] || name
}

function groupItems(items: [string, string][]): { head: string; entries: [string, string][] }[] {
  const map = new Map<string, [string, string][]>()
  for (const item of items) {
    const head = getHead(item[0])
    if (!map.has(head)) map.set(head, [])
    map.get(head)!.push(item)
  }
  return Array.from(map.entries()).map(([head, entries]) => ({ head, entries }))
}

export default function DevicePanel({ onClientsChange, onAgentConnect }: Props) {
  const [clients, setClients]   = useState<ClientEntry[]>([])
  const [rosData, setRosData]   = useState<RosScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [pinging, setPinging]   = useState(false)
  const [showAdd, setShowAdd]   = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [quickPending, setQuickPending] = useState<{
    connName: string
    type: 'ros_service' | 'ros_topic' | 'ros_action'
    iface: string
    agentName: string
    isCamera: boolean
    isClient: boolean
    encodeFuncCode: string
    decodeFuncCode: string
    selectedTemplateId: string | null
  } | null>(null)
  const [form, setForm] = useState<FormFields>(DEFAULT_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [apiKeysSaved, setApiKeysSaved] = useState<Record<string, boolean>>({})

  // Robot registry (multi-robot)
  const [robots, setRobots]               = useState<Robot[]>([])
  const [activeRobot, setActiveRobotState] = useState<string>('')
  const [robotEditor, setRobotEditor]     = useState<
    { mode: 'add' } | { mode: 'edit'; original: string } | null
  >(null)
  const [robotNameInput, setRobotNameInput] = useState('')
  const [robotUrlInput,  setRobotUrlInput]  = useState('')
  const [robotEditorError, setRobotEditorError] = useState<string | null>(null)
  const [agentConnecting, setAgentConnecting] = useState(false)
  const [agentStatus, setAgentStatus] = useState<{ ok: boolean; skills: number; error?: string } | null>(null)
  const [connSearch, setConnSearch] = useState('')
  const [rosSearch, setRosSearch] = useState('')
  const [rosOpen, setRosOpen] = useState(false)
  const [connOpen, setConnOpen] = useState(true)

  // Location config profiles (per-robot, server-side)
  const [locations, setLocations]         = useState<string[]>([])
  const [activeLocation, setActiveLocation] = useState<string>('')
  const [locBusy, setLocBusy]             = useState(false)
  const [locError, setLocError]           = useState<string | null>(null)
  const [locEditor, setLocEditor]         = useState<
    { mode: 'add' } | { mode: 'rename'; original: string } | null
  >(null)
  const [locNameInput, setLocNameInput]   = useState('')
  const [locCopyFrom,  setLocCopyFrom]    = useState('')

  const reloadRobots = useCallback(() => {
    setRobots(api.listRobots())
    setActiveRobotState(api.getActiveRobotName() ?? '')
  }, [])

  const reloadLocations = useCallback(async () => {
    try {
      const { locations: locs, active } = await api.listLocations()
      setLocations(locs)
      setActiveLocation(active)
    } catch {
      setLocations([])
      setActiveLocation('')
    }
  }, [])

  useEffect(() => {
    reloadRobots()
    void reloadLocations()
    api.getApiKeys().then(setApiKeysSaved).catch(() => {})
  }, [reloadRobots, reloadLocations])

  const connectActiveRobot = async () => {
    setAgentConnecting(true)
    setAgentStatus(null)
    try {
      const skills = await api.listSkills()
      setAgentStatus({ ok: true, skills: skills.length })
      onAgentConnect?.()
      await refresh()
      await reloadLocations()
      return true
    } catch {
      setAgentStatus({ ok: false, skills: 0, error: 'Unreachable' })
      return false
    } finally {
      setAgentConnecting(false)
    }
  }

  // Switch active robot transactionally: commit to localStorage only if the
  // target is reachable. On failure, roll back to whatever was active before
  // so the rest of the UI (devices, skills, camera) keeps pointing at a robot
  // that actually answers.
  const switchActiveRobot = async (name: string) => {
    const previous = api.getActiveRobotName() ?? ''
    if (name === previous) return
    api.setActiveRobot(name)
    setActiveRobotState(name)
    setAgentStatus(null)
    const ok = await connectActiveRobot()
    if (!ok) {
      api.setActiveRobot(previous)
      setActiveRobotState(previous)
      setAgentStatus({
        ok: false,
        skills: 0,
        error: previous
          ? `"${name}" unreachable — kept "${previous}"`
          : `"${name}" unreachable`,
      })
      if (previous) void connectActiveRobot()  // restore badge + clients
    }
  }

  const openAddRobot = () => {
    setRobotEditor({ mode: 'add' })
    setRobotNameInput('')
    setRobotUrlInput(`http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8001`)
    setRobotEditorError(null)
  }

  const openEditRobot = () => {
    const r = robots.find(x => x.name === activeRobot)
    if (!r) return
    setRobotEditor({ mode: 'edit', original: r.name })
    setRobotNameInput(r.name)
    setRobotUrlInput(r.url)
    setRobotEditorError(null)
  }

  const closeRobotEditor = () => {
    setRobotEditor(null)
    setRobotEditorError(null)
  }

  const saveRobotEditor = () => {
    if (!robotEditor) return
    const res = robotEditor.mode === 'add'
      ? api.addRobot(robotNameInput, robotUrlInput)
      : api.updateRobot(robotEditor.original, robotNameInput, robotUrlInput)
    if (!res.ok) {
      setRobotEditorError(res.error ?? 'Could not save')
      return
    }
    if (robotEditor.mode === 'add') api.setActiveRobot(robotNameInput.trim())
    reloadRobots()
    closeRobotEditor()
    void connectActiveRobot()
  }

  const removeActiveRobot = () => {
    if (!activeRobot) return
    if (!confirm(`Remove robot "${activeRobot}"?`)) return
    api.removeRobot(activeRobot)
    reloadRobots()
    setAgentStatus(null)
  }

  // ── Location config profiles ────────────────────────────────
  // Switching is a backend hot-reload: it tears down the current device
  // connections and reconnects from the chosen site's connections.json +
  // global configs, so we refresh the device list right after.
  const switchLocation = async (name: string) => {
    if (!name || name === activeLocation) return
    setLocBusy(true)
    setLocError(null)
    try {
      const res = await api.activateLocation(name)
      setLocations(res.locations)
      setActiveLocation(res.active)
      onAgentConnect?.()
      await refresh()
    } catch (e) {
      setLocError(e instanceof Error ? e.message : 'Switch failed')
      void reloadLocations()
    } finally {
      setLocBusy(false)
    }
  }

  const openAddLocation = () => {
    setLocEditor({ mode: 'add' })
    setLocNameInput('')
    setLocCopyFrom(activeLocation || 'default')
    setLocError(null)
  }

  const openRenameLocation = () => {
    if (!activeLocation) return
    setLocEditor({ mode: 'rename', original: activeLocation })
    setLocNameInput(activeLocation)
    setLocError(null)
  }

  const closeLocEditor = () => {
    setLocEditor(null)
    setLocError(null)
  }

  const saveLocEditor = async () => {
    if (!locEditor) return
    const name = locNameInput.trim()
    if (!name) { setLocError('Name is required'); return }
    setLocBusy(true)
    setLocError(null)
    try {
      if (locEditor.mode === 'add') {
        const res = await api.createLocation(name, locCopyFrom || undefined)
        setLocations(res.locations)
        closeLocEditor()
        await switchLocation(name)   // activate the new site for convenience
      } else {
        const res = await api.renameLocation(locEditor.original, name)
        setLocations(res.locations)
        setActiveLocation(res.active)
        closeLocEditor()
      }
    } catch (e) {
      setLocError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setLocBusy(false)
    }
  }

  const removeLocation = async () => {
    const target = activeLocation
    if (!target) return
    if (target === 'default') { setLocError('Cannot delete the default location'); return }
    if (!confirm(`Delete location "${target}"? This removes its connections and global configs.`)) return
    setLocBusy(true)
    setLocError(null)
    try {
      // The backend refuses to delete the active site, so fall back to
      // 'default' first (also hot-reloads devices), then delete.
      await api.activateLocation('default')
      setActiveLocation('default')
      const res = await api.deleteLocation(target)
      setLocations(res.locations)
      setActiveLocation(res.active)
      onAgentConnect?.()
      await refresh()
    } catch (e) {
      setLocError(e instanceof Error ? e.message : 'Delete failed')
      void reloadLocations()
    } finally {
      setLocBusy(false)
    }
  }

  const refresh = useCallback(async () => {
    const data: ClientEntry[] = await api.listClients()
    setClients(data)
    onClientsChange(data)
  }, [onClientsChange])

  // Poll status every 10s
  useEffect(() => {
    refresh()
    const id = setInterval(async () => {
      const status = await api.getStatus()
      setClients(prev => {
        const next = prev.map(c => ({ ...c, connected: status[c.id] ?? c.connected }))
        onClientsChange(next)
        return next
      })
    }, 10_000)
    return () => clearInterval(id)
  }, [refresh])

  const pingAll = async () => {
    setPinging(true)
    try {
      const status = await api.getStatus()
      setClients(prev => {
        const next = prev.map(c => ({ ...c, connected: status[c.id] ?? c.connected }))
        onClientsChange(next)
        return next
      })
    } finally {
      setPinging(false)
    }
  }

  const scanRos = async () => {
    setScanning(true)
    try {
      setRosData(await api.scanRos())
      setRosOpen(true)
    } finally { setScanning(false) }
  }

  const quickConnect = async (connName: string, type: 'ros_service' | 'ros_topic' | 'ros_action', dataInterface: string) => {
    setQuickPending({
      connName, type, iface: dataInterface, agentName: '',
      isCamera: false, isClient: true,
      encodeFuncCode: '', decodeFuncCode: '', selectedTemplateId: null,
    })
  }

  const confirmQuickConnect = async () => {
    if (!quickPending) return
    const { connName, type, iface, agentName, isCamera, isClient, encodeFuncCode, decodeFuncCode } = quickPending
    const resolvedAgent = agentName.trim() || connName
    await api.addClient(type, resolvedAgent, {
      conn_name: connName,
      agent_name: resolvedAgent,
      conn_type: type,
      data_interface: iface,
      is_client: isClient,
      ...(isCamera && { is_camera: true }),
      ...(encodeFuncCode.trim() && { encode_func: encodeFuncCode.trim() }),
      ...(decodeFuncCode.trim() && { decode_func: decodeFuncCode.trim() }),
    })
    setQuickPending(null)
    await refresh()
  }

  const handleTypeChange = (type: ClientType) => {
    setForm(f => ({ ...f, type }))
  }

  const buildConfig = (f: FormFields): Record<string, unknown> => {
    if (f.type === 'ros_service' || f.type === 'ros_topic' || f.type === 'ros_action') {
      const cfg: Record<string, unknown> = {
        conn_name: f.connName,
        conn_type: f.type,
        is_client: f.isClient,
      }
      if (f.agentName.trim()) cfg.agent_name = f.agentName.trim()
      if (f.dataInterface.trim()) cfg.data_interface = f.dataInterface.trim()
      if (f.isCamera) cfg.is_camera = true
      if (f.encodeFuncCode.trim()) cfg.encode_func = f.encodeFuncCode.trim()
      if (f.decodeFuncCode.trim()) cfg.decode_func = f.decodeFuncCode.trim()
      return cfg
    }
    if (f.type === 'webrtc') {
      const cfg: Record<string, unknown> = { host: f.host, port: parseInt(f.port) || 8443 }
      if (f.agentName.trim()) cfg.agent_name = f.agentName.trim()
      if (f.isCamera) cfg.is_camera = true
      return cfg
    }
    if (f.type === 'tcp') {
      const cfg: Record<string, unknown> = {
        host: f.host,
        port: parseInt(f.port) || 8888,
        is_client: f.isClient,
      }
      if (f.agentName.trim()) cfg.agent_name = f.agentName.trim()
      if (!f.isClient && f.runFuncCode.trim()) cfg.run_func = f.runFuncCode.trim()
      return cfg
    }
    // llm — pyconnect expects "name" key; agent_name used as id
    const llmName = f.model.trim() || f.provider
    const cfg: Record<string, unknown> = { name: f.provider, agent_name: llmName }
    if (f.provider === 'llama') cfg.url = f.url
    if (f.model.trim()) cfg.model = f.model.trim()
    return cfg
  }

  const submitForm = async () => {
    // Save API key separately if provided
    if ((form.type === 'llm') && form.apiKey.trim() &&
        (form.provider === 'chatgpt' || form.provider === 'gemini')) {
      await api.setApiKey(form.provider, form.apiKey.trim())
      setApiKeysSaved(prev => ({ ...prev, [form.provider]: true }))
    }

    const config = buildConfig(form)
    const agentName = form.type === 'llm'
      ? (form.model.trim() || form.provider)
      : (form.agentName.trim() || form.connName.trim() || form.host)

    let result: { id: string; error: string }
    try {
      result = editId
        ? await api.updateClient(editId, agentName, config)
        : await api.addClient(form.type, agentName, config)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
      return
    }
    if (result?.error) {
      setFormError(result.error)
      return
    }
    setFormError(null)
    setEditId(null)
    setShowAdd(false)
    setForm(DEFAULT_FORM)
    await refresh()
  }

  const startEdit = (c: ClientEntry) => {
    const cfg = c.config as Record<string, unknown>
    const f: FormFields = { ...DEFAULT_FORM, type: c.type }
    if (c.type === 'ros_service' || c.type === 'ros_topic' || c.type === 'ros_action') {
      f.connName        = String(cfg.conn_name ?? '')
      f.agentName       = String(cfg.agent_name ?? '')
      f.dataInterface   = String(cfg.data_interface ?? '')
      f.isCamera        = Boolean(cfg.is_camera)
      f.isClient        = cfg.is_client !== false
      f.encodeFuncCode  = String(cfg.encode_func ?? '')
      f.decodeFuncCode  = String(cfg.decode_func ?? '')
    } else if (c.type === 'webrtc') {
      f.host      = String(cfg.host ?? '')
      f.port      = String(cfg.port ?? '8443')
      f.agentName = c.name
      f.isCamera  = Boolean(cfg.is_camera)
    } else if (c.type === 'tcp') {
      f.host        = String(cfg.host ?? 'localhost')
      f.port        = String(cfg.port ?? '8888')
      f.agentName   = String(cfg.agent_name ?? c.name)
      f.isClient    = cfg.is_client !== false
      f.runFuncCode = String(cfg.run_func ?? '')
    } else {
      f.provider = (cfg.name as LLMProvider) ?? (cfg.provider as LLMProvider) ?? 'llama'
      f.url      = String(cfg.url ?? '')
      f.model    = String(cfg.model ?? '')
    }
    setForm(f)
    setEditId(c.id)
    setShowAdd(true)
  }

  const cancelForm = () => {
    setShowAdd(false)
    setEditId(null)
    setForm(DEFAULT_FORM)
    setFormError(null)
  }

  const remove = async (id: string) => {
    await api.deleteClient(id)
    await refresh()
  }

  const setActive = async (id: string) => {
    await api.setActiveLlm(id)
    await refresh()
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Robot Agent — multi-robot picker */}
      <div className="flex flex-col gap-1.5 pb-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-700">Robot Agent</span>
          {agentStatus && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              agentStatus.ok
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-600 border-red-200'
            }`}>
              {agentStatus.ok ? `✓ ${agentStatus.skills} skills` : (agentStatus.error ?? 'Unreachable')}
            </span>
          )}
          {activeRobot && (
            <span className="ml-auto text-[10px] text-gray-500 font-mono truncate max-w-[260px]"
              title={robots.find(r => r.name === activeRobot)?.url ?? ''}>
              {robots.find(r => r.name === activeRobot)?.url ?? ''}
            </span>
          )}
        </div>

        <div className="flex gap-1.5 items-center">
          <select
            value={activeRobot}
            onChange={e => switchActiveRobot(e.target.value)}
            disabled={robots.length === 0}
            className="flex-1 bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 text-xs disabled:opacity-50"
          >
            {robots.length === 0 && <option value="">(no robots — click Add)</option>}
            {robots.map(r => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
          <button
            onClick={() => void connectActiveRobot()}
            disabled={agentConnecting || !activeRobot}
            className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded"
            title="Test connection to the active robot"
          >
            {agentConnecting ? '…' : 'Connect'}
          </button>
          <button
            onClick={openAddRobot}
            className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
          >
            + Add
          </button>
          <button
            onClick={openEditRobot}
            disabled={!activeRobot}
            className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-40 text-gray-700 rounded"
          >
            Edit
          </button>
          <button
            onClick={removeActiveRobot}
            disabled={!activeRobot}
            className="px-2.5 py-1 text-xs bg-red-100 hover:bg-red-200 disabled:opacity-40 text-red-700 rounded"
            title="Remove the active robot"
          >
            Remove
          </button>
        </div>

        {robotEditor && (
          <div className="border border-gray-200 rounded p-2 bg-gray-50 flex flex-col gap-1.5">
            <div className="text-[11px] font-medium text-gray-700">
              {robotEditor.mode === 'add' ? 'Add robot' : `Edit "${robotEditor.original}"`}
            </div>
            <input
              value={robotNameInput}
              onChange={e => setRobotNameInput(e.target.value)}
              placeholder="Name (e.g. kcare_lab, kcare_demo)"
              className="bg-white border border-gray-200 rounded px-2 py-1.5 text-xs"
            />
            <input
              value={robotUrlInput}
              onChange={e => setRobotUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveRobotEditor() }}
              placeholder="http://192.168.1.10:8001"
              className="bg-white border border-gray-200 rounded px-2 py-1.5 text-xs font-mono"
            />
            {robotEditorError && (
              <div className="text-[10px] text-red-600">{robotEditorError}</div>
            )}
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={closeRobotEditor}
                className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
              >
                Cancel
              </button>
              <button
                onClick={saveRobotEditor}
                className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Location — per-robot config profile (connections + global configs) */}
      <div className="flex flex-col gap-1.5 pb-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-700">Location</span>
          <span className="text-[10px] text-gray-400" title="Each location has its own connections + global configs. Switching hot-reloads the robot.">
            connections + global configs
          </span>
          {locBusy && <span className="ml-auto text-[10px] text-gray-500">switching…</span>}
        </div>

        <div className="flex gap-1.5 items-center">
          <select
            value={activeLocation}
            onChange={e => void switchLocation(e.target.value)}
            disabled={locBusy || locations.length === 0}
            className="flex-1 bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 text-xs disabled:opacity-50"
          >
            {locations.length === 0 && <option value="">(connect a robot)</option>}
            {locations.map(l => (
              <option key={l} value={l}>{l}{l === 'default' ? ' (default)' : ''}</option>
            ))}
          </select>
          <button
            onClick={openAddLocation}
            disabled={locBusy || locations.length === 0}
            className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-40 text-gray-700 rounded"
          >
            + Add
          </button>
          <button
            onClick={openRenameLocation}
            disabled={locBusy || !activeLocation}
            className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-40 text-gray-700 rounded"
          >
            Rename
          </button>
          <button
            onClick={() => void removeLocation()}
            disabled={locBusy || !activeLocation || activeLocation === 'default'}
            className="px-2.5 py-1 text-xs bg-red-100 hover:bg-red-200 disabled:opacity-40 text-red-700 rounded"
            title={activeLocation === 'default' ? 'The default location cannot be deleted' : 'Delete the active location'}
          >
            Delete
          </button>
        </div>

        {locEditor && (
          <div className="border border-gray-200 rounded p-2 bg-gray-50 flex flex-col gap-1.5">
            <div className="text-[11px] font-medium text-gray-700">
              {locEditor.mode === 'add' ? 'Add location' : `Rename "${locEditor.original}"`}
            </div>
            <input
              value={locNameInput}
              onChange={e => setLocNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void saveLocEditor() }}
              placeholder="Name (e.g. lab_seoul, home_busan)"
              className="bg-white border border-gray-200 rounded px-2 py-1.5 text-xs"
            />
            {locEditor.mode === 'add' && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                Copy configs from
                <select
                  value={locCopyFrom}
                  onChange={e => setLocCopyFrom(e.target.value)}
                  className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-xs"
                >
                  <option value="">(empty)</option>
                  {locations.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
            {locError && <div className="text-[10px] text-red-600">{locError}</div>}
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={closeLocEditor}
                className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveLocEditor()}
                disabled={locBusy}
                className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded"
              >
                Save
              </button>
            </div>
          </div>
        )}
        {locError && !locEditor && <div className="text-[10px] text-red-600">{locError}</div>}
      </div>

      {/* Connections panel */}
      <div className="border border-gray-200 rounded">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-t">
          <button
            onClick={() => setConnOpen(o => !o)}
            className="flex items-center gap-1.5 font-semibold text-gray-800 hover:text-gray-600 text-sm"
          >
            <span className="text-[10px]">{connOpen ? '▾' : '▸'}</span>
            Connections
          </button>
          <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
            {clients.filter(c => c.connected).length}/{clients.length}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={pingAll}
              disabled={pinging}
              className="px-2.5 py-1 text-xs bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded"
              title="Ping all connections now"
            >
              {pinging ? 'Pinging…' : 'Ping All'}
            </button>
            <button
              onClick={scanRos}
              disabled={scanning}
              className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded"
            >
              {scanning ? 'Scanning…' : 'Scan ROS'}
            </button>
            <button
              onClick={() => { setShowAdd(!showAdd); setEditId(null) }}
              className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
            >
              + Add
            </button>
          </div>
        </div>

      {connOpen && (<div className="p-2 flex flex-col gap-2">

      {/* Add/Edit form */}
      {showAdd && (
        <div className="bg-gray-50 border border-gray-200 rounded p-3 flex flex-col gap-2 text-xs">
          {/* Type selector */}
          <select value={form.type} onChange={e => handleTypeChange(e.target.value as ClientType)}
            className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5">
            {(Object.keys(TYPE_LABELS) as ClientType[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>

          {/* ROS fields */}
          {(form.type === 'ros_service' || form.type === 'ros_topic' || form.type === 'ros_action') && (() => {
            const iface = form.dataInterface.trim()
            const isBuiltin = iface.includes('SendStringData') || iface === ''
            const showEncode = !isBuiltin && (form.type !== 'ros_topic' || !form.isClient)
            const showDecode = !isBuiltin && (form.type !== 'ros_topic' || form.isClient)
            const recs = iface ? recommendTemplates(iface, form.type) : []
            const applyTemplate = (t: RosTemplate) =>
              setForm(f => ({ ...f, selectedTemplateId: t.id, encodeFuncCode: t.encode_func ?? '', decodeFuncCode: t.decode_func ?? '' }))
            return (<>
              <input placeholder="conn_name  e.g. /skill_pick" value={form.connName}
                onChange={e => setForm(f => ({ ...f, connName: e.target.value }))}
                className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
              <input placeholder="agent_name  (empty = conn_name)" value={form.agentName}
                onChange={e => setForm(f => ({ ...f, agentName: e.target.value }))}
                className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
              <input placeholder="data_interface  e.g. rosinterfaces/srv/SendStringData" value={form.dataInterface}
                onChange={e => setForm(f => ({ ...f, dataInterface: e.target.value, selectedTemplateId: null }))}
                className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={form.isCamera} className="accent-blue-600"
                    onChange={e => setForm(f => ({ ...f, isCamera: e.target.checked }))} />
                  <span className="text-gray-600">is_camera</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={form.isClient} className="accent-blue-600"
                    onChange={e => setForm(f => ({ ...f, isClient: e.target.checked }))} />
                  <span className="text-gray-600">is_client</span>
                </label>
              </div>
              {iface && isBuiltin && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                  <span className="text-green-600">✓</span>
                  <span className="text-green-700">SendStringData — encode/decode built-in</span>
                </div>
              )}
              {recs.length > 0 && !isBuiltin && (
                <div className="flex flex-wrap gap-1">
                  {recs.map(t => (
                    <button key={t.id} title={t.description} onClick={() => applyTemplate(t)}
                      className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                        form.selectedTemplateId === t.id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {showEncode && (
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500">encode_func</span>
                  <textarea value={form.encodeFuncCode} rows={5} spellCheck={false}
                    onChange={e => setForm(f => ({ ...f, encodeFuncCode: e.target.value, selectedTemplateId: null }))}
                    placeholder={"def encode_func(data, req):\n    ...\n    return req"}
                    className="font-mono text-[11px] bg-white border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400 placeholder-gray-300" />
                </div>
              )}
              {showDecode && (
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500">decode_func</span>
                  <textarea value={form.decodeFuncCode} rows={5} spellCheck={false}
                    onChange={e => setForm(f => ({ ...f, decodeFuncCode: e.target.value, selectedTemplateId: null }))}
                    placeholder={"def decode_func(msg):\n    return {'isdone': True}"}
                    className="font-mono text-[11px] bg-white border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400 placeholder-gray-300" />
                </div>
              )}
            </>)
          })()}

          {/* WebRTC fields */}
          {form.type === 'webrtc' && (<>
            <input placeholder="agent_name" value={form.agentName}
              onChange={e => setForm(f => ({ ...f, agentName: e.target.value }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            <input placeholder="host  e.g. 192.168.1.10" value={form.host}
              onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            <input placeholder="port  (default 8443)" value={form.port}
              onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.isCamera} className="accent-blue-600"
                onChange={e => setForm(f => ({ ...f, isCamera: e.target.checked }))} />
              <span className="text-gray-600">is_camera</span>
            </label>
          </>)}

          {/* TCP fields */}
          {form.type === 'tcp' && (<>
            <input placeholder="agent_name" value={form.agentName}
              onChange={e => setForm(f => ({ ...f, agentName: e.target.value }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            <input placeholder="host  e.g. localhost" value={form.host}
              onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            <input placeholder="port  (default 8888)" value={form.port}
              onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.isClient} className="accent-blue-600"
                onChange={e => setForm(f => ({ ...f, isClient: e.target.checked }))} />
              <span className="text-gray-600">is_client <span className="text-gray-400">(uncheck → server)</span></span>
            </label>
            {!form.isClient && (
              <div className="flex flex-col gap-1">
                <span className="text-gray-500">run_func</span>
                <textarea value={form.runFuncCode} rows={6} spellCheck={false}
                  onChange={e => setForm(f => ({ ...f, runFuncCode: e.target.value }))}
                  placeholder={"def run_func(**kwargs):\n    # process incoming dict\n    return {'ok': True}"}
                  className="font-mono text-[11px] bg-white border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400 placeholder-gray-300" />
              </div>
            )}
          </>)}

          {/* LLM fields */}
          {form.type === 'llm' && (<>
            <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value as LLMProvider }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5">
              <option value="llama">Llama (local)</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="gemini">Gemini</option>
            </select>
            {form.provider === 'llama' && (
              <input placeholder="url  e.g. http://localhost:11434" value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            )}
            <input placeholder="model  (optional)" value={form.model}
              onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
            {(form.provider === 'chatgpt' || form.provider === 'gemini') && (
              <div className="flex flex-col gap-1">
                <input
                  type="password"
                  placeholder={apiKeysSaved[form.provider] ? '••••••  (saved — leave blank to keep)' : 'API key'}
                  value={form.apiKey}
                  onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                  className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400" />
                {apiKeysSaved[form.provider] && (
                  <span className="text-[10px] text-green-600">✓ Key saved</span>
                )}
              </div>
            )}
          </>)}

          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded px-2 py-1.5 text-[11px] break-words">
              {formError}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={submitForm}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded">
              {editId ? 'Update' : 'Add'}
            </button>
            <button onClick={cancelForm}
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded">Cancel</button>
          </div>
        </div>
      )}

      {/* Client list */}
      <div className="flex flex-col gap-1">
        {clients.length > 0 && (
          <input
            value={connSearch}
            onChange={e => setConnSearch(e.target.value)}
            placeholder="Search connections…"
            className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1 text-xs placeholder-gray-400 mb-1"
          />
        )}
        {(() => {
          const filtered = clients.filter(c =>
            !connSearch || (c.name || c.id).toLowerCase().includes(connSearch.toLowerCase())
          )
          const groupMap = new Map<string, ClientEntry[]>()
          for (const c of filtered) {
            const head = getHead(c.name || c.id)
            if (!groupMap.has(head)) groupMap.set(head, [])
            groupMap.get(head)!.push(c)
          }
          const groups = Array.from(groupMap.entries()).map(([head, entries]) => ({ head, entries }))
          const searchOpen = connSearch.length > 0

          const renderRow = (c: ClientEntry) => (
            <div key={c.id} className="flex flex-col">
              <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 group">
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.connected ? 'bg-green-500' : 'bg-red-400'}`}
                  title={c.connected ? 'Connected' : (c.error || 'Not connected')}
                />
                {c.type === 'llm' && (
                  <input
                    type="radio"
                    name="llm-active"
                    checked={c.is_active}
                    onChange={() => setActive(c.id)}
                    className="accent-blue-600 flex-shrink-0 cursor-pointer"
                    title={c.is_active ? 'Active LLM (resolves dm.get_client("llm"))' : 'Set as active LLM'}
                  />
                )}
                <span className="text-xs text-gray-800 font-mono flex-1 truncate">{c.name || c.id}</span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{TYPE_LABELS[c.type]}</span>
                <button onClick={() => startEdit(c)}
                  className="text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 text-xs">edit</button>
                <button onClick={() => remove(c.id)}
                  className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 text-base leading-none">×</button>
              </div>
              {c.error && !c.connected && (
                <p className="text-[10px] text-red-500 px-2 pb-1 truncate" title={c.error}>{c.error}</p>
              )}
            </div>
          )

          return groups.map(({ head, entries }) => {
            const key = `conn:${head}`
            const userOpen = expandedGroups.has(key)
            const open = userOpen || searchOpen
            const connected = entries.filter(e => e.connected).length
            const toggle = () => setExpandedGroups(prev => {
              const next = new Set(prev)
              userOpen ? next.delete(key) : next.add(key)
              return next
            })
            return (
              <div key={head} className="flex flex-col">
                <button
                  onClick={toggle}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded text-left"
                >
                  <span className="text-[10px] text-gray-500">{open ? '▾' : '▸'}</span>
                  <span className="text-xs font-mono font-medium text-gray-700">{head}</span>
                  <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                    {connected}/{entries.length}
                  </span>
                </button>
                {open && (
                  <div className="flex flex-col gap-1 mt-0.5 pl-3">
                    {entries.map(renderRow)}
                  </div>
                )}
              </div>
            )
          })
        })()}
        {clients.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3">No connections yet</p>
        )}
      </div>

      </div>)} {/* end connOpen */}
      </div> {/* end connections border panel */}

      {/* Quick-connect popup */}
      {quickPending && (() => {
        const recs = recommendTemplates(quickPending.iface, quickPending.type)
        const isBuiltin = recs[0]?.builtin && recs[0].interfaces.includes(quickPending.iface)
        const showEncode = !isBuiltin && (quickPending.type !== 'ros_topic' || !quickPending.isClient)
        const showDecode = !isBuiltin && (quickPending.type !== 'ros_topic' || quickPending.isClient)
        const applyTemplate = (t: RosTemplate) => {
          setQuickPending(p => p && ({
            ...p,
            selectedTemplateId: t.id,
            encodeFuncCode: t.encode_func ?? '',
            decodeFuncCode: t.decode_func ?? '',
          }))
        }
        return (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-4 w-[500px] max-h-[90vh] overflow-y-auto flex flex-col gap-3 text-xs">
              <p className="text-sm font-semibold text-gray-800">Add ROS Connection</p>

              {/* Interface badge */}
              <div className="flex flex-col gap-1">
                <span className="text-gray-500 text-[10px] uppercase tracking-wide">data_interface</span>
                <span className="font-mono text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1 break-all">
                  {quickPending.iface}
                </span>
              </div>

              {/* conn_name */}
              <div className="flex flex-col gap-1">
                <span className="text-gray-500">conn_name</span>
                <span className="font-mono text-gray-800 bg-gray-50 border border-gray-200 rounded px-2 py-1">{quickPending.connName}</span>
              </div>

              {/* agent_name */}
              <div className="flex flex-col gap-1">
                <label className="text-gray-500">agent_name <span className="text-gray-400">(empty = conn_name)</span></label>
                <input
                  autoFocus
                  value={quickPending.agentName}
                  onChange={e => setQuickPending(p => p && ({ ...p, agentName: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Escape') setQuickPending(null) }}
                  placeholder={quickPending.connName}
                  className="bg-white border border-gray-300 rounded px-2 py-1.5 font-mono placeholder-gray-300 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Checkboxes */}
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={quickPending.isCamera} className="accent-blue-600"
                    onChange={e => setQuickPending(p => p && ({ ...p, isCamera: e.target.checked }))} />
                  <span className="text-gray-600">is_camera</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={quickPending.isClient} className="accent-blue-600"
                    onChange={e => setQuickPending(p => p && ({ ...p, isClient: e.target.checked }))} />
                  <span className="text-gray-600">is_client</span>
                </label>
              </div>

              {/* Built-in badge */}
              {isBuiltin ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded px-3 py-2">
                  <span className="text-green-600 text-base">✓</span>
                  <span className="text-green-700 font-medium">Built-in — no custom functions needed</span>
                </div>
              ) : (
                <>
                  {/* Template recommendations */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-gray-500 text-[10px] uppercase tracking-wide">Templates</span>
                    <div className="flex flex-wrap gap-1.5">
                      {recs.map(t => (
                        <button
                          key={t.id}
                          title={t.description}
                          onClick={() => applyTemplate(t)}
                          className={`px-2 py-1 rounded border text-[11px] transition-colors ${
                            quickPending.selectedTemplateId === t.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* encode_func */}
                  {showEncode && (
                    <div className="flex flex-col gap-1">
                      <span className="text-gray-500">encode_func</span>
                      <textarea
                        value={quickPending.encodeFuncCode}
                        onChange={e => setQuickPending(p => p && ({ ...p, encodeFuncCode: e.target.value, selectedTemplateId: null }))}
                        rows={5}
                        spellCheck={false}
                        placeholder={"def encode_func(data, req):\n    ...\n    return req"}
                        className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400 placeholder-gray-300"
                      />
                    </div>
                  )}

                  {/* decode_func */}
                  {showDecode && (
                    <div className="flex flex-col gap-1">
                      <span className="text-gray-500">decode_func</span>
                      <textarea
                        value={quickPending.decodeFuncCode}
                        onChange={e => setQuickPending(p => p && ({ ...p, decodeFuncCode: e.target.value, selectedTemplateId: null }))}
                        rows={5}
                        spellCheck={false}
                        placeholder={"def decode_func(msg):\n    return {'isdone': True}"}
                        className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400 placeholder-gray-300"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setQuickPending(null)}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded">Cancel</button>
                <button onClick={confirmQuickConnect}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded">Add</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ROS scan results */}
      {rosData && (
        <div className="border border-gray-200 rounded text-xs">
          {/* Collapsible header */}
          <button
            onClick={() => setRosOpen(o => !o)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-left"
          >
            <span className="text-[10px]">{rosOpen ? '▾' : '▸'}</span>
            <span className="font-medium text-gray-700">Scan Results</span>
            <div className="flex gap-1.5 ml-1">
              {(['service', 'topic', 'action'] as const).map(kind => {
                const count = (rosData[kind] ?? []).length
                if (count === 0) return null
                return (
                  <span key={kind} className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                    {kind}s {count}
                  </span>
                )
              })}
            </div>
            <button
              onClick={e => { e.stopPropagation(); setRosData(null); setRosOpen(false) }}
              className="ml-auto text-gray-400 hover:text-gray-600 text-base leading-none"
              title="Close"
            >×</button>
          </button>

          {/* Content */}
          {rosOpen && (
            <div className="flex flex-col gap-2 p-2">
              <input
                value={rosSearch}
                onChange={e => setRosSearch(e.target.value)}
                placeholder="Search…"
                className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1 placeholder-gray-400"
              />
              {(['service', 'topic', 'action'] as const).map(kind => {
                const allItems = rosData[kind] ?? []
                const items = rosSearch
                  ? allItems.filter(([name]: [string, string]) =>
                      name.toLowerCase().includes(rosSearch.toLowerCase()))
                  : allItems
                if (items.length === 0) return null
                const groups = groupItems(items)
                const rosType = `ros_${kind}` as 'ros_service' | 'ros_topic' | 'ros_action'

                const renderRow = ([name, iface]: [string, string], indent = false) => (
                  <div key={name} className={`flex items-center gap-1 group ${indent ? 'pl-3' : ''}`}>
                    <span className="font-mono text-gray-700 truncate">{name}</span>
                    <span className="text-[10px] text-gray-400 truncate flex-1">{iface}</span>
                    <button
                      onClick={() => quickConnect(name, rosType, iface)}
                      className="text-blue-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 text-[10px] flex-shrink-0"
                    >+ add</button>
                  </div>
                )

                return (
                  <div key={kind}>
                    <p className="text-gray-500 uppercase text-[10px] mb-1">{kind}s</p>
                    <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                      {groups.map(({ head, entries }) => {
                        if (entries.length === 1) return renderRow(entries[0])
                        const key = `${kind}:${head}`
                        const open = expandedGroups.has(key)
                        const toggle = () => setExpandedGroups(prev => {
                          const next = new Set(prev)
                          open ? next.delete(key) : next.add(key)
                          return next
                        })
                        return (
                          <div key={head}>
                            <button
                              onClick={toggle}
                              className="flex items-center gap-1 w-full text-left text-gray-600 hover:text-gray-900 py-0.5"
                            >
                              <span className="text-[10px]">{open ? '▾' : '▸'}</span>
                              <span className="font-mono font-medium">{head}</span>
                              <span className="text-gray-400 text-[10px]">({entries.length})</span>
                            </button>
                            {open && (
                              <div className="flex flex-col gap-0.5">
                                {entries.map(e => renderRow(e, true))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
