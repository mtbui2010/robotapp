'use client'
import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import type { SkillDef } from '../lib/types'
import SKILL_CONFIGS_RAW from '../lib/skill_configs.json'
import { ConfigFieldsEditor, type ConfigView } from './ConfigFields'
import { PlanSkillEditor, checkPlan } from './PlanSkillEditor'
import PanelSearch from './PanelSearch'
import { SkillAliasesEditor } from './SkillAliasesEditor'

const SKILL_CONFIG_MAP = SKILL_CONFIGS_RAW.skill_config_map as Record<string, string[]>

function groupSkills(skills: SkillDef[]): { key: string; label: string; entries: SkillDef[] }[] {
  const map = new Map<string, SkillDef[]>()
  for (const s of skills) {
    const key = s.type === 'plan' ? '__plan__' : (s.module_path || `__ext__${s.url}`)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return Array.from(map.entries()).map(([key, entries]) => {
    const label = key === '__plan__' ? 'plan skills'
      : key.startsWith('__ext__')
      ? (entries[0].url || 'external')
      : key.split('.').pop() || key
    return { key, label, entries }
  })
}

const INPUT_CLS = 'bg-white border border-gray-200 text-gray-800 rounded px-2 py-1 font-mono placeholder-gray-400 text-xs w-full'

export default function SkillPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [skills, setSkills]     = useState<SkillDef[]>([])
  const [status, setStatus]     = useState<Record<string, { ok: boolean; error: string }>>({})
  const [open, setOpen]         = useState(false)   // folded on load; the search box stays visible
  const [showAdd, setShowAdd]   = useState(false)
  const [reloading, setReloading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editName, setEditName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<SkillDef>>({})
  const [search, setSearch]     = useState('')
  // config editing state: {config_name: json_text} — only present after a successful live fetch
  const [editConfigs, setEditConfigs] = useState<Record<string, string>>({})
  const [loadingConfigs, setLoadingConfigs] = useState<Set<string>>(new Set())
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({})
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({})
  // per-config view toggle: 'fields' (form) | 'json' (raw textarea). Default fields.
  const [configView, setConfigView] = useState<Record<string, ConfigView>>({})

  const EMPTY_FORM = {
    name: '',
    type: 'internal' as SkillDef['type'],
    description: '',
    module_path: '',
    func_name: '',
    url: '',
    plan: '',
  }
  const [form, setForm] = useState(EMPTY_FORM)
  const [addError, setAddError]   = useState('')
  const [editError, setEditError] = useState('')
  const [listError, setListError] = useState('')
  // Names a plan may call: skill names and their aliases.
  const known = skills.flatMap(s => [s.name, ...(s.aliases ?? [])])

  const refresh = useCallback(async () => {
    const [skills, status] = await Promise.all([api.listSkills(), api.getSkillsStatus()])
    setSkills(skills)
    setStatus(status)
  }, [])

  useEffect(() => { refresh() }, [refresh, refreshKey])

  // When a skill edit opens, fetch live config values from the agent.
  // No static seed — the textarea is blank/loading until the live value arrives,
  // so the user never edits stale defaults that aren't actually used at runtime.
  useEffect(() => {
    setEditConfigs({})
    setLoadErrors({})
    setConfigErrors({})
    if (!editName) { setLoadingConfigs(new Set()); return }
    const configNames = SKILL_CONFIG_MAP[editName] ?? []
    if (configNames.length === 0) { setLoadingConfigs(new Set()); return }

    setLoadingConfigs(new Set(configNames))
    configNames.forEach(cn => {
      api.getSkillConfig(cn)
        .then(live => {
          setEditConfigs(prev => ({ ...prev, [cn]: JSON.stringify(live, null, 2) }))
        })
        .catch(err => {
          setLoadErrors(prev => ({ ...prev, [cn]: err?.message || 'Failed to load' }))
        })
        .finally(() => {
          setLoadingConfigs(prev => { const next = new Set(prev); next.delete(cn); return next })
        })
    })
  }, [editName])

  const reload = async () => {
    setReloading(true)
    try { await api.reloadSkills() } finally { setReloading(false) }
    await refresh()
  }

  const submit = async () => {
    if (!form.name) return
    if (form.type === 'plan' && checkPlan(form.name, form.plan, known).errors.length) {
      setAddError('Fix the plan first'); return
    }
    try {
      await api.addSkill(form)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Add failed'); return
    }
    setAddError('')
    setShowAdd(false)
    setForm(EMPTY_FORM)
    await refresh()
  }

  const remove = async (name: string) => {
    try {
      await api.deleteSkill(name)
      setListError('')
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Delete failed')
    }
    await refresh()
  }

  const startEdit = (s: SkillDef) => {
    setEditName(s.name)
    setEditForm(s.type === 'plan'
      ? { name: s.name, description: s.description, plan: s.plan ?? '' }
      : { description: s.description, module_path: s.module_path, func_name: s.func_name, url: s.url })
    setEditError('')
  }

  const cancelEdit = () => { setEditName(null); setEditForm({}); setEditError('') }

  const submitEdit = async () => {
    if (!editName) return
    // Don't save while any config is still loading or errored — would silently drop those configs.
    if (loadingConfigs.size > 0 || Object.keys(loadErrors).length > 0) return

    // validate config JSON
    const errors: Record<string, string> = {}
    for (const [cn, text] of Object.entries(editConfigs)) {
      try { JSON.parse(text) } catch { errors[cn] = 'Invalid JSON' }
    }
    if (Object.keys(errors).length > 0) { setConfigErrors(errors); return }

    // save skill def; a refused plan (unknown skill, calls itself) keeps the form open
    try {
      await api.updateSkill(editName, editForm)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed'); return
    }

    // save each config (only the ones that loaded successfully); a refused
    // save (e.g. a duplicate ENV alias) keeps the form open with its message
    const failed: Record<string, string> = {}
    await Promise.all(
      Object.entries(editConfigs).map(([cn, text]) =>
        api.updateSkillConfig(cn, JSON.parse(text)).catch(err => {
          failed[cn] = err instanceof Error ? err.message : 'Save failed'
        })
      )
    )
    if (Object.keys(failed).length > 0) { setConfigErrors(failed); return }
    cancelEdit()
    await refresh()
  }

  const reloadConfig = (cn: string) => {
    setLoadErrors(prev => { const next = { ...prev }; delete next[cn]; return next })
    setEditConfigs(prev => { const next = { ...prev }; delete next[cn]; return next })
    setLoadingConfigs(prev => { const next = new Set(prev); next.add(cn); return next })
    api.getSkillConfig(cn)
      .then(live => setEditConfigs(prev => ({ ...prev, [cn]: JSON.stringify(live, null, 2) })))
      .catch(err => setLoadErrors(prev => ({ ...prev, [cn]: err?.message || 'Failed to load' })))
      .finally(() => setLoadingConfigs(prev => { const next = new Set(prev); next.delete(cn); return next }))
  }

  const renderConfigSection = (skillName: string, actions: ReactNode) => {
    const configNames = SKILL_CONFIG_MAP[skillName] ?? []
    if (configNames.length === 0) return null

    return (
      <div className="flex flex-col gap-2 mt-1">
        <div className="flex items-center justify-between">
          <span className="text-gray-500 font-medium">Configs</span>
          {actions}
        </div>
        {configNames.map(cn => {
          const loading = loadingConfigs.has(cn)
          const loadErr = loadErrors[cn]
          const text    = editConfigs[cn]
          const view    = configView[cn] ?? 'fields'
          const setView = (v: ConfigView) => setConfigView(prev => ({ ...prev, [cn]: v }))
          return (
            <div key={cn} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-mono text-[11px]">{cn}</span>
                {loading && <span className="text-gray-400 text-[10px]">loading…</span>}
                {!loading && (
                  <button
                    type="button"
                    onClick={() => reloadConfig(cn)}
                    title="Reload from agent"
                    className="text-gray-400 hover:text-blue-500 text-[10px] leading-none"
                  >⟳</button>
                )}
                {!loading && !loadErr && text !== undefined && (
                  <div className="ml-auto inline-flex rounded border border-gray-200 overflow-hidden text-[10px]">
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
              </div>
              {loadErr ? (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  <span className="text-red-600 text-[10px]">⚠ Could not load from agent — {loadErr}</span>
                </div>
              ) : loading || text === undefined ? (
                <div className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-3 text-gray-400">
                  Loading live value…
                </div>
              ) : view === 'fields' ? (
                <ConfigFieldsEditor
                  text={text}
                  onChange={t => setEditConfigs(prev => ({ ...prev, [cn]: t }))}
                />
              ) : (
                <textarea
                  value={text}
                  rows={8}
                  spellCheck={false}
                  onChange={e => setEditConfigs(prev => ({ ...prev, [cn]: e.target.value }))}
                  className={`font-mono text-[11px] bg-white border rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400 ${
                    configErrors[cn] ? 'border-red-400' : 'border-gray-200'
                  }`}
                />
              )}
              {configErrors[cn] && (
                <span className="text-[10px] text-red-500">{configErrors[cn]}</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const renderEditForm = (s: SkillDef) => (
    <div className="ml-3 mb-1 bg-gray-50 border border-gray-200 rounded p-2 flex flex-col gap-1.5 text-xs max-h-[70vh] overflow-y-auto">
      {s.type === 'plan' ? (
        <>
          <input
            value={editForm.name ?? s.name}
            onChange={e => setEditForm(f => ({ ...f, name: e.target.value.trim() }))}
            placeholder="skill name"
            title="Rename: plan skills that call it are updated; shortcut buttons and guides keep the old name"
            className={INPUT_CLS}
          />
          {editForm.name && editForm.name !== s.name && (
            <span className="text-[10px] text-amber-600">
              Renaming {s.name} → {editForm.name}: plan skills calling it are updated; shortcut buttons and guides still say “{s.name}”.
            </span>
          )}
          <PlanSkillEditor
            name={editForm.name || s.name}
            plan={editForm.plan ?? ''}
            known={known.filter(k => k !== s.name).concat(editForm.name || s.name)}
            onChange={plan => setEditForm(f => ({ ...f, plan }))}
          />
        </>
      ) : s.type === 'internal' ? (
        <>
          <input
            placeholder="module_path  e.g. kcare_robot.skills.pick"
            value={editForm.module_path ?? ''}
            onChange={e => setEditForm(f => ({ ...f, module_path: e.target.value }))}
            className={INPUT_CLS}
          />
          <input
            placeholder="func_name  (blank = same as skill name)"
            value={editForm.func_name ?? ''}
            onChange={e => setEditForm(f => ({ ...f, func_name: e.target.value }))}
            className={INPUT_CLS}
          />
        </>
      ) : (
        <input
          placeholder="URL  e.g. http://192.168.1.10:8001/skill/pick"
          value={editForm.url ?? ''}
          onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))}
          className={INPUT_CLS}
        />
      )}
      <input
        placeholder="Description (optional)"
        value={editForm.description ?? ''}
        onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
        className={INPUT_CLS}
      />
      {editError && <span className="text-[10px] text-red-500">⚠ {editError}</span>}
      {(() => {
        const actions = (
          <div className="flex gap-2">
            <button
              onClick={submitEdit}
              disabled={loadingConfigs.size > 0 || Object.keys(loadErrors).length > 0}
              title={
                loadingConfigs.size > 0 ? 'Wait for configs to load' :
                Object.keys(loadErrors).length > 0 ? 'Fix config load errors first' : ''
              }
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-xs">Save</button>
            <button onClick={cancelEdit}
              className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-xs">Cancel</button>
          </div>
        )
        const hasConfigs = (SKILL_CONFIG_MAP[s.name] ?? []).length > 0
        return hasConfigs
          ? renderConfigSection(s.name, actions)
          : <div className="pt-0.5">{actions}</div>
      })()}
    </div>
  )

  const renderRow = (s: SkillDef, indent = false) => (
    <div key={s.name}>
      <div
        className={`flex items-center gap-2 px-2 py-1 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 group ${indent ? 'ml-3' : ''}`}>
        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
          s.type === 'internal' ? 'bg-gray-200 text-gray-600'
            : s.type === 'plan' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-600'
        }`}>
          {s.type === 'internal' ? 'int' : s.type === 'plan' ? 'plan' : 'ext'}
        </span>
        <span className="text-xs text-gray-800 font-mono flex-1 truncate flex items-center gap-1.5"
          title={s.type === 'plan' ? [s.description, s.plan].filter(Boolean).join('\n\n') : (s.description || undefined)}>
          {s.type === 'internal' && (
            <span
              title={status[s.name]?.error || (status[s.name]?.ok ? 'ok' : 'not checked')}
              className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                !(s.name in status) ? 'bg-gray-300' :
                status[s.name].ok ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
          )}
          {s.name}
          {(s.aliases?.length ?? 0) > 0 && (
            <span className="text-[10px] text-blue-500 font-sans truncate" title={`aliases: ${s.aliases!.join(', ')}`}>
              · {s.aliases!.join(', ')}
            </span>
          )}
        </span>
        <span className="text-[10px] text-gray-400 truncate max-w-28">
          {s.type === 'plan' ? `${checkPlan(s.name, s.plan ?? '', known).steps} steps` : (s.url || s.func_name)}
        </span>
        <button
          onClick={() => editName === s.name ? cancelEdit() : startEdit(s)}
          className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 text-xs"
        >
          {editName === s.name ? 'cancel' : 'edit'}
        </button>
        {s.type !== 'internal' && (
          <button onClick={() => remove(s.name)} title={`Delete ${s.name}`}
            className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 text-base leading-none">×</button>
        )}
      </div>
      {editName === s.name && renderEditForm(s)}
    </div>
  )

  return (
    <div className="border border-gray-200 rounded text-xs">
      {/* Collapsible header */}
      <div className="flex items-center px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-t">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <span className="text-[10px]">{open || search ? '▾' : '▸'}</span>
          <span className="font-medium text-gray-700">Skills</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">{skills.length}</span>
        </button>
        <button
          onClick={reload}
          disabled={reloading}
          title="Reload skills from skills_config"
          className="px-2 py-0.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded disabled:opacity-50"
        >
          {reloading ? '…' : '⟳'}
        </button>
        <button
          onClick={() => { setShowAdd(v => !v); setOpen(true) }}
          className="px-2 py-0.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
        >
          + Add
        </button>
      </div>

      {skills.length > 0 && (
        <div className="px-2 pt-2">
          <PanelSearch value={search} onChange={setSearch} placeholder="Search skills…" />
        </div>
      )}

      {/* Content */}
      {(open || search) && (
        <div className="flex flex-col gap-2 p-2">
          {showAdd && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  placeholder="skill_name"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="flex-1 min-w-0 bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400"
                />
                <select
                  value={form.type}
                  onChange={e => { setAddError(''); setForm(f => ({ ...f, type: e.target.value as SkillDef['type'] })) }}
                  title="Internal: Python function · External: REST URL · Plan: a sequence of skills"
                  className="flex-shrink-0 w-24 bg-white border border-gray-200 text-gray-800 rounded px-1 py-1.5"
                >
                  <option value="internal">Internal</option>
                  <option value="external">External</option>
                  <option value="plan">Plan</option>
                </select>
              </div>

              {form.type === 'plan' ? (
                <PlanSkillEditor
                  name={form.name}
                  plan={form.plan}
                  known={known}
                  onChange={plan => setForm(f => ({ ...f, plan }))}
                />
              ) : form.type === 'internal' ? (
                <>
                  <input
                    placeholder="module_path  e.g. kcare_robot.skills.pick"
                    value={form.module_path}
                    onChange={e => setForm(f => ({ ...f, module_path: e.target.value }))}
                    className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400"
                  />
                  <input
                    placeholder="func_name  e.g. pick  (blank = same as skill name)"
                    value={form.func_name}
                    onChange={e => setForm(f => ({ ...f, func_name: e.target.value }))}
                    className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400"
                  />
                </>
              ) : (
                <input
                  placeholder="URL  e.g. http://192.168.1.10:8001/skill/pick"
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 font-mono placeholder-gray-400"
                />
              )}

              <input
                placeholder="Description (optional)"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="bg-white border border-gray-200 text-gray-800 rounded px-2 py-1.5 placeholder-gray-400"
              />

              {addError && <span className="text-[10px] text-red-500">⚠ {addError}</span>}
              <div className="flex gap-2">
                <button onClick={submit}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded">Add</button>
                <button onClick={() => { setShowAdd(false); setAddError('') }}
                  className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded">Cancel</button>
              </div>
            </div>
          )}

          {listError && <span className="text-[10px] text-red-500">⚠ {listError}</span>}
          <SkillAliasesEditor
            skills={skills}
            filter={search}
            onSave={async (name, aliases) => {
              try {
                await api.updateSkill(name, { aliases })   // throws with the backend's reason (400)
              } catch (e) {
                return e instanceof Error ? e.message : String(e)
              }
              await refresh()
              return null
            }}
          />
          <div className="max-h-[60vh] overflow-y-auto flex flex-col gap-1">
            {(() => {
              const q = search.trim().toLowerCase()
              const matches = (s: SkillDef) =>
                !q ||
                s.name.toLowerCase().includes(q) ||
                (s.aliases ?? []).some(a => a.toLowerCase().includes(q)) ||
                (s.description ?? '').toLowerCase().includes(q)
              return groupSkills(skills)
                .map(g => ({ ...g, entries: g.entries.filter(matches) }))
                .filter(g => g.entries.length > 0)
                .map(({ key, label, entries }) => {
                  if (entries.length === 1) return renderRow(entries[0])

                  const userOpen = expanded.has(key)
                  const isOpen = userOpen || q.length > 0
                  const toggle = () => setExpanded(prev => {
                    const next = new Set(prev)
                    userOpen ? next.delete(key) : next.add(key)
                    return next
                  })
                  return (
                    <div key={key}>
                      <button onClick={toggle}
                        className="flex items-center gap-1 w-full text-left text-gray-600 hover:text-gray-900 py-0.5">
                        <span className="text-[10px]">{isOpen ? '▾' : '▸'}</span>
                        <span className="font-mono font-medium">{label}</span>
                        <span className="text-gray-400 text-[10px]">({entries.length})</span>
                      </button>
                      {isOpen && <div className="flex flex-col gap-1">{entries.map(s => renderRow(s, true))}</div>}
                    </div>
                  )
                })
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
