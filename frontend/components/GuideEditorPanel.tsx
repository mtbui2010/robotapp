'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { GuideVersion } from '../lib/types'

// Versioned planner guide (the LLM prompt). The active version is what the
// backend plans with; an empty store falls back to the robot's guide modules.
// `refreshKey` is bumped by the parent when the active robot connects or the
// config location changes, so the live versions are refetched.
export default function GuideEditorPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [active,    setActive]    = useState<string | null>(null)
  const [versions,  setVersions]  = useState<GuideVersion[]>([])
  const [selected,  setSelected]  = useState<string>('')
  const [guideText, setGuideText] = useState('')
  const [formatText, setFormatText] = useState('')   // '' → freeform (FORMAT=null)
  const [dirty,     setDirty]     = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const [showFormat, setShowFormat] = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [savedAt,   setSavedAt]   = useState(0)

  const loadEditor = useCallback((v: GuideVersion | undefined) => {
    setGuideText(v?.guide ?? '')
    setFormatText(v?.format ? JSON.stringify(v.format, null, 2) : '')
    setDirty(false)
    setError('')
  }, [])

  const refresh = useCallback(async (keep?: string) => {
    try {
      const r = await api.listGuides()
      setActive(r.active)
      setVersions(r.versions)
      const pick = keep && r.versions.some(v => v.name === keep)
        ? keep
        : (r.active && r.versions.some(v => v.name === r.active) ? r.active : (r.versions[0]?.name ?? ''))
      setSelected(pick)
      loadEditor(r.versions.find(v => v.name === pick))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load guides')
    }
  }, [loadEditor])

  useEffect(() => { if (!collapsed) refresh(selected || undefined) }, [collapsed, refreshKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const selectVersion = (name: string) => {
    setSelected(name)
    loadEditor(versions.find(v => v.name === name))
  }

  const save = async () => {
    if (!selected) return
    let format: Record<string, unknown> | null = null
    if (formatText.trim()) {
      try { format = JSON.parse(formatText) } catch { setError('format is not valid JSON'); return }
    }
    setBusy(true); setError('')
    try {
      await api.updateGuide(selected, { guide: guideText, format })
      setDirty(false); setSavedAt(Date.now())
      await refresh(selected)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }

  const addVersion = async () => {
    const name = window.prompt('New guide version name:')?.trim()
    if (!name) return
    setBusy(true); setError('')
    try {
      await api.createGuide({ name, guide: '', format: null })
      await refresh(name)
      setShowFormat(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally { setBusy(false) }
  }

  const removeVersion = async () => {
    if (!selected || !window.confirm(`Delete guide version "${selected}"?`)) return
    setBusy(true); setError('')
    try {
      await api.deleteGuide(selected)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally { setBusy(false) }
  }

  const setActiveVersion = async () => {
    if (!selected || selected === active) return
    setBusy(true); setError('')
    try {
      await api.activateGuide(selected)
      await refresh(selected)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activate failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="text-gray-600 text-[10px] w-3 text-left"
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <h2 className="font-semibold text-gray-800 flex-1">Planner Guide</h2>
        {active && <span className="text-[10px] text-gray-400 font-mono">active: {active}</span>}
        {!collapsed && (
          <button type="button" onClick={() => refresh(selected || undefined)}
            title="Reload from agent"
            className="text-gray-400 hover:text-blue-500 text-[10px] leading-none">⟳</button>
        )}
      </div>

      {!collapsed && (
        <div className="border border-gray-200 rounded bg-white p-2 flex flex-col gap-2">
          {/* Version picker + actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <select
              value={selected}
              onChange={e => selectVersion(e.target.value)}
              className="flex-1 min-w-0 bg-white border border-gray-300 text-gray-800 text-[11px] rounded px-1.5 py-1"
            >
              {versions.length === 0 && <option value="">(no versions)</option>}
              {versions.map(v => (
                <option key={v.name} value={v.name}>
                  {v.name}{v.name === active ? ' ●' : ''}{v.format ? ' (struct)' : ''}
                </option>
              ))}
            </select>
            <button type="button" onClick={setActiveVersion} disabled={busy || !selected || selected === active}
              title="Use this version for planning"
              className="px-2 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded text-[10px]">
              Set active
            </button>
            <button type="button" onClick={addVersion} disabled={busy}
              className="px-2 py-1 border border-gray-300 hover:border-blue-400 text-gray-700 rounded text-[10px]">+ Add</button>
            <button type="button" onClick={removeVersion} disabled={busy || !selected}
              className="px-2 py-1 border border-gray-300 hover:border-red-400 text-red-500 rounded text-[10px]">Delete</button>
          </div>

          {selected ? (
            <>
              <textarea
                value={guideText}
                rows={14}
                spellCheck={false}
                placeholder="Guide / prompt text…"
                onChange={e => { setGuideText(e.target.value); setDirty(true) }}
                className="font-mono text-[11px] bg-white border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400"
              />

              <div>
                <button type="button" onClick={() => setShowFormat(s => !s)}
                  className="text-[10px] text-blue-400 hover:text-blue-600">
                  {showFormat ? '▾ format (JSON schema — empty = freeform)' : '▸ format (advanced)'}
                </button>
                {showFormat && (
                  <textarea
                    value={formatText}
                    rows={6}
                    spellCheck={false}
                    placeholder="empty → freeform (chat_guide); JSON schema → structured (chat)"
                    onChange={e => { setFormatText(e.target.value); setDirty(true) }}
                    className="mt-1 w-full font-mono text-[10px] bg-white border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={save} disabled={busy || !dirty}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-[11px]">
                  Save
                </button>
                {dirty && <span className="text-[10px] text-amber-600">unsaved</span>}
                {!dirty && savedAt > 0 && <span className="text-[10px] text-green-600">✓ saved</span>}
              </div>
            </>
          ) : (
            <p className="text-[11px] text-gray-400">No guide version. Add one, or the planner uses the robot&apos;s built-in guide.</p>
          )}

          {error && <span className="text-[10px] text-red-500">⚠ {error}</span>}
        </div>
      )}
    </div>
  )
}
