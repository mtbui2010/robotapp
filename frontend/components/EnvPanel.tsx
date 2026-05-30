'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

// Proxies that aren't tied to a specific skill, exposed for global edit.
const PROXY_NAMES = ['ENV', 'HOME_LOC'] as const
type ProxyName = typeof PROXY_NAMES[number]

// `refreshKey` is bumped by the parent when the active robot connects or the
// location (config site) changes, so the live global-config values are refetched.
export default function EnvPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [texts,       setTexts]       = useState<Record<string, string>>({})
  const [loading,     setLoading]     = useState<Set<string>>(new Set(PROXY_NAMES))
  const [loadErrors,  setLoadErrors]  = useState<Record<string, string>>({})
  const [saveErrors,  setSaveErrors]  = useState<Record<string, string>>({})
  const [savedAt,     setSavedAt]     = useState<Record<string, number>>({})
  // Start with everything collapsed except ENV — keeps the panel compact.
  const [collapsed,   setCollapsed]   = useState<Set<string>>(
    new Set(PROXY_NAMES.filter(n => n !== 'ENV'))
  )

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

  useEffect(() => { PROXY_NAMES.forEach(fetchOne) }, [fetchOne, refreshKey])

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

  const toggle = (name: ProxyName) =>
    setCollapsed(s => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-semibold text-gray-800">Global Configs</h2>

      {PROXY_NAMES.map(name => {
        const isLoading   = loading.has(name)
        const loadErr     = loadErrors[name]
        const saveErr     = saveErrors[name]
        const justSaved   = savedAt[name] && !saveErr
        const text        = texts[name]
        const isCollapsed = collapsed.has(name)

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
            </div>

            {!isCollapsed && (
              <div className="p-2 flex flex-col gap-1">
                {loadErr ? (
                  <span className="text-[10px] text-red-600">⚠ {loadErr}</span>
                ) : isLoading || text === undefined ? (
                  <div className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-3 text-gray-400">
                    Loading live value…
                  </div>
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => save(name)}
                    disabled={isLoading || text === undefined || !!loadErr}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-[11px]"
                  >
                    Save
                  </button>
                  {saveErr && <span className="text-[10px] text-red-500">{saveErr}</span>}
                  {justSaved && <span className="text-[10px] text-green-600">✓ saved</span>}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
