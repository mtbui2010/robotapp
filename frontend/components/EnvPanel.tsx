'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { ConfigFieldsEditor, type ConfigView } from './ConfigFields'
import { EnvNamesEditor } from './EnvNamesEditor'
import PanelSearch from './PanelSearch'
import SKILL_CONFIGS_RAW from '../lib/skill_configs.json'

// Config groups that aren't tied to a specific skill, exposed for global edit:
// ENV and HOME_LOC first, then every other group the agent serves that no skill
// edits in the Skill panel (lib/skill_configs.json) — MAP, HRI_CONFIGS,
// QA_CONFIGS, KR2EN … Used to be just ENV / HOME_LOC, which left those groups
// with no place in the UI at all.
const FIRST_NAMES = ['ENV', 'HOME_LOC']
const SKILL_GROUPS = new Set(Object.values(
  (SKILL_CONFIGS_RAW as { skill_config_map: Record<string, string[] | string> }).skill_config_map,
).flatMap(v => (Array.isArray(v) ? v : [v])))
type ProxyName = string

// ENV params the Location aliases block edits (`<location>.aliases`).
const isNameLeaf = (path: string) => /^[^.]*\.aliases$/.test(path)

const parseObject = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null
  } catch { return null }
}

// `refreshKey` is bumped by the parent when the active robot connects or the
// location (config site) changes, so the live global-config values are refetched.
export default function EnvPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [texts,       setTexts]       = useState<Record<string, string>>({})
  const [names,       setNames]       = useState<string[]>(FIRST_NAMES)
  const [loading,     setLoading]     = useState<Set<string>>(new Set(FIRST_NAMES))
  const [loadErrors,  setLoadErrors]  = useState<Record<string, string>>({})
  const [saveErrors,  setSaveErrors]  = useState<Record<string, string>>({})
  const [savedAt,     setSavedAt]     = useState<Record<string, number>>({})
  // per-config view toggle: 'fields' (form) | 'json' (raw textarea). Default fields.
  const [configView,  setConfigView]  = useState<Record<string, ConfigView>>({})
  // The whole block, and each config in it, start folded; the search box under
  // the header stays visible and opens the configs holding a match.
  const [open,        setOpen]        = useState<Set<string>>(new Set())
  const [panelOpen,   setPanelOpen]   = useState(false)
  const [search,      setSearch]      = useState('')
  const q = search.trim().toLowerCase()

  const fetchOne = useCallback((name: ProxyName) => {
    setLoading(s => { const n = new Set(s); n.add(name); return n })
    setLoadErrors(e => { const n = { ...e }; delete n[name]; return n })
    api.getSkillConfig(name)
      .then(live => {
        if (live === null) {
          setLoadErrors(p => ({ ...p, [name]: 'Not found on agent' }))
          return
        }
        setTexts(prev => ({ ...prev, [name]: JSON.stringify(live, null, 2) }))
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : 'Failed to load'
        setLoadErrors(p => ({ ...p, [name]: msg }))
      })
      .finally(() => {
        setLoading(s => { const n = new Set(s); n.delete(name); return n })
      })
  }, [])

  useEffect(() => {
    let stale = false
    api.listSkillConfigNames().then(all => {
      if (stale) return
      const extra = all.filter(n => !FIRST_NAMES.includes(n) && !SKILL_GROUPS.has(n)).sort()
      const list = [...FIRST_NAMES, ...extra]
      setNames(list)
      list.forEach(fetchOne)
    })
    return () => { stale = true }
  }, [fetchOne, refreshKey])

  const save = async (name: ProxyName) => {
    const text = texts[name]
    if (text === undefined) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setSaveErrors(p => ({ ...p, [name]: 'Invalid JSON' }))
      return
    }
    setSaveErrors(p => { const n = { ...p }; delete n[name]; return n })
    try {
      await api.updateSkillConfig(name, parsed as Record<string, unknown>)
      setSavedAt(p => ({ ...p, [name]: Date.now() }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      setSaveErrors(p => ({ ...p, [name]: msg }))
    }
  }

  // every config starts folded
  const toggle = (name: ProxyName) =>
    setOpen(s => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setPanelOpen(o => !o)}
        className="flex items-center gap-2 text-left">
        <span className="text-gray-600 text-[10px] w-3">{panelOpen || q ? '▾' : '▸'}</span>
        <h2 className="font-semibold text-gray-800">Global Configs</h2>
      </button>
      <PanelSearch value={search} onChange={setSearch} placeholder="Search configs… (name, location, field)" />

      {(panelOpen || q) && names.map(name => {
        const isLoading   = loading.has(name)
        const loadErr     = loadErrors[name]
        const saveErr     = saveErrors[name]
        const justSaved   = savedAt[name] && !saveErr
        const text        = texts[name]
        // While searching, show only the configs whose name or text matches, unfolded.
        if (q && !name.toLowerCase().includes(q) && !(text ?? '').toLowerCase().includes(q)) return null
        const isCollapsed = q ? false : !open.has(name)
        const view        = configView[name] ?? 'fields'
        const setView     = (v: ConfigView) => setConfigView(prev => ({ ...prev, [name]: v }))

        return (
          <div key={name} className="border border-gray-200 rounded bg-white">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
              <button
                type="button"
                onClick={() => toggle(name)}
                className="text-gray-600 text-[10px] w-3 text-left"
              >
                {isCollapsed ? '▸' : '▾'}
              </button>
              <span className="font-mono text-[11px] text-gray-700 flex-1">{name}</span>
              {isLoading && <span className="text-gray-400 text-[10px]">loading…</span>}
              {!isLoading && (
                <button
                  type="button"
                  onClick={() => fetchOne(name)}
                  title="Reload from agent"
                  className="text-gray-400 hover:text-blue-500 text-[10px] leading-none"
                >⟳</button>
              )}
              {!isCollapsed && !isLoading && !loadErr && text !== undefined && (
                <div className="inline-flex rounded border border-gray-200 overflow-hidden text-[10px]">
                  {(['fields', 'json'] as ConfigView[]).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      className={`px-1.5 py-0.5 ${
                        view === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
                      }`}
                    >{v === 'fields' ? 'Fields' : 'JSON'}</button>
                  ))}
                </div>
              )}
              {!isCollapsed && (
                <>
                  {saveErr && <span className="text-[10px] text-red-500">{saveErr}</span>}
                  {justSaved && <span className="text-[10px] text-green-600">✓ saved</span>}
                  <button
                    type="button"
                    onClick={() => save(name)}
                    disabled={isLoading || text === undefined || !!loadErr}
                    className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-[10px]"
                  >
                    Save
                  </button>
                </>
              )}
            </div>

            {!isCollapsed && (
              <div className="p-2 flex flex-col gap-1">
                {loadErr ? (
                  <span className="text-[10px] text-red-600">⚠ {loadErr}</span>
                ) : isLoading || text === undefined ? (
                  <div className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-3 text-gray-400">
                    Loading live value…
                  </div>
                ) : view === 'fields' ? (
                  <>
                    {name === 'ENV' && parseObject(text) && (
                      <EnvNamesEditor
                        filter={q}
                        env={parseObject(text)!}
                        onChange={env => setTexts(prev => ({ ...prev, ENV: JSON.stringify(env, null, 2) }))}
                      />
                    )}
                    <ConfigFieldsEditor
                      text={text}
                      onChange={t => setTexts(prev => ({ ...prev, [name]: t }))}
                      skipLeaf={name === 'ENV' ? isNameLeaf : undefined}
                      filter={q && !name.toLowerCase().includes(q) ? q : undefined}
                    />
                  </>
                ) : (
                  <textarea
                    value={text}
                    rows={10}
                    spellCheck={false}
                    onChange={e =>
                      setTexts(prev => ({ ...prev, [name]: e.target.value }))
                    }
                    className={`font-mono text-[11px] bg-white border rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400 ${
                      saveErr ? 'border-red-400' : 'border-gray-200'
                    }`}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
