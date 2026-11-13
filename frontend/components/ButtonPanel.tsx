'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/api'
import { CLOSED, OTHER, buttonsOf, groupTabs, openGroup, reorderBefore, reorderGroupIds, type BtnDef, type BtnGroup } from '../lib/buttonGroups'

const LS_OPEN_GROUP = 'robotapp_button_group'     // the group whose tray is open ('-' = none)

// Legacy key — buttons used to live entirely in localStorage. We migrate them
// to the server on first load, then delete the key so it can never replay.
const LEGACY_LS_KEY = 'robotapp_buttons'
const MIGRATED_LS_KEY = 'robotapp_buttons_migrated'

// Module-level guard: React 18 Strict Mode (and rapid refreshKey bumps) can
// mount the effect twice in quick succession. Both invocations see
// serverBtns.length === 0 + flag !== '1' and both POST /buttons/bulk → the
// localStorage list ends up imported twice. This in-flight flag dedupes
// within the same JS context; the localStorage flag persists across reloads.
let __migrationInFlight = false

interface Props {
  onRun: (plan: string) => void
  /** Bumped whenever the active robot (re)connects — triggers a refetch. */
  refreshKey?: number
}

function readLegacy(): BtnDef[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(b => b && b.label) : []
  } catch { return [] }
}

const emptyForm = { label: '', plan: '', group: OTHER }

export default function ButtonPanel({ onRun, refreshKey = 0 }: Props) {
  const [buttons, setButtons]   = useState<BtnDef[]>([])
  const [groups, setGroups]   = useState<BtnGroup[]>([])
  const [stored, setStored]     = useState<string | null>(null)      // the open tray as chosen (read after mount)
  const [dragGroup, setDragGroup] = useState<string | null>(null)
  const [overGroup, setOverGroup] = useState<string | null>(null)
  const [form, setForm]         = useState<{ label: string; plan: string; group: string } | null>(null)
  const [editId, setEditId]     = useState<string | null>(null)
  const [dragId, setDragId]     = useState<string | null>(null)
  const [overId, setOverId]     = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const draggableRef = useRef(false)

  // Fetch from server; if there's legacy localStorage data and the server has
  // none, push the legacy data up *once* and then delete the localStorage key
  // so it can never replay (e.g. on a fresh deployment or after server reset).
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let serverBtns = await api.listButtons()
      const legacy = readLegacy()
      const alreadyMigrated = localStorage.getItem(MIGRATED_LS_KEY) === '1'

      if (legacy.length > 0 && serverBtns.length === 0
          && !alreadyMigrated && !__migrationInFlight) {
        __migrationInFlight = true
        // Set the flag BEFORE the POST: if React Strict-Mode runs this effect
        // twice in quick succession, the second pass sees the flag and bails.
        localStorage.setItem(MIGRATED_LS_KEY, '1')
        try {
          const result = await api.bulkAddButtons(
            legacy.map(b => ({ label: b.label, plan: b.plan }))
          )
          if (result.count > 0) serverBtns = await api.listButtons()
          // Now drop the legacy key entirely so it can never be re-imported.
          localStorage.removeItem(LEGACY_LS_KEY)
        } catch {
          // Migration failed — unset the flag so the user can retry next load.
          localStorage.removeItem(MIGRATED_LS_KEY)
        } finally {
          __migrationInFlight = false
        }
      }
      setButtons(serverBtns)
      setGroups(await api.listButtonGroups().catch(() => []))
      setUnreachable(false)
    } catch (e) {
      setButtons([])
      setGroups([])
      setUnreachable(true)
      setError((e as Error).message || 'Could not reach robot')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload, refreshKey])
  useEffect(() => { try { setStored(localStorage.getItem(LS_OPEN_GROUP)) } catch { /* no storage */ } }, [])

  const tabs = groupTabs(groups, buttons)
  const open = openGroup(stored, tabs)
  const chooseOpen = (id: string) => {
    const next = open === id ? CLOSED : id          // a second click on the open group closes its tray
    setStored(next)
    try { localStorage.setItem(LS_OPEN_GROUP, next) } catch { /* no storage */ }
  }

  const openAdd  = () => { setEditId(null); setForm({ ...emptyForm, group: open === CLOSED ? OTHER : open }); setError(null) }
  const openEdit = (b: BtnDef) => { setEditId(b.id); setForm({ label: b.label, plan: b.plan, group: b.group ?? OTHER }); setError(null) }
  const cancel   = () => { setForm(null); setEditId(null); setError(null) }

  const submit = async () => {
    if (!form || !form.label.trim()) return
    setError(null)
    try {
      if (editId) {
        const updated = await api.updateButton(editId, { label: form.label, plan: form.plan, group: form.group })
        setButtons(prev => prev.map(b => b.id === editId ? (updated as BtnDef) : b))
      } else {
        const created = await api.addButton(form.label, form.plan, form.group)
        setButtons(prev => [...prev, created])
      }
      cancel()
    } catch (e) {
      setError((e as Error).message || 'Save failed')
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await api.deleteButton(id)
      setButtons(prev => prev.filter(b => b.id !== id))
    } catch (e) {
      setError((e as Error).message || 'Delete failed')
    }
  }

  const onDragStart = (e: React.DragEvent, id: string) => {
    if (!draggableRef.current) { e.preventDefault(); return }
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onDragOver = (e: React.DragEvent, id: string) => {
    if (!dragId || dragId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overId !== id) setOverId(id)
  }

  const onDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const optimistic = dragId ? reorderBefore(buttons, dragId, targetId) : null
    setDragId(null)
    setOverId(null)
    if (!optimistic) return
    setButtons(optimistic)
    try {
      await api.reorderButtons(optimistic.map(b => b.id))
    } catch (e) {
      setError((e as Error).message || 'Reorder failed')
      void reload()  // revert from server
    }
  }

  // ── groups ──
  const addGroup = async () => {
    const name = window.prompt('New group name:')?.trim()
    if (!name) return
    setError(null)
    try {
      const g = await api.addButtonGroup(name)
      setGroups(prev => [...prev, g])
      setStored(g.id); try { localStorage.setItem(LS_OPEN_GROUP, g.id) } catch { /* no storage */ }
    } catch (e) { setError((e as Error).message || 'Could not add the group') }
  }
  const renameGroup = async (g: BtnGroup) => {
    const name = window.prompt(`Rename group "${g.name}" to:`, g.name)?.trim()
    if (!name || name === g.name) return
    setError(null)
    try {
      const upd = await api.renameButtonGroup(g.id, name)
      setGroups(prev => prev.map(x => x.id === g.id ? upd : x))
    } catch (e) { setError((e as Error).message || 'Could not rename the group') }
  }
  const removeGroup = async (g: BtnGroup) => {
    const n = buttonsOf(buttons, groups, g.id).length
    if (!window.confirm(`Delete group "${g.name}"?${n ? ` Its ${n} button${n > 1 ? 's' : ''} move to Other.` : ''}`)) return
    setError(null)
    try {
      await api.deleteButtonGroup(g.id)
      setGroups(prev => prev.filter(x => x.id !== g.id))
      setButtons(prev => prev.map(b => b.group === g.id ? { ...b, group: OTHER } : b))
    } catch (e) { setError((e as Error).message || 'Could not delete the group') }
  }
  const dropOnGroup = async (e: React.DragEvent, groupId: string) => {
    e.preventDefault()
    setOverGroup(null)
    if (dragGroup) {                                  // a group dragged onto another: reorder the groups
      const ids = reorderGroupIds(groups, dragGroup, groupId)
      setDragGroup(null)
      if (!ids) return
      setGroups(ids.map(id => groups.find(g => g.id === id) as BtnGroup))
      try { await api.reorderButtonGroups(ids) } catch (er) { setError((er as Error).message || 'Reorder failed'); void reload() }
      return
    }
    if (!dragId) return                               // a button dropped on a group chip: it moves there
    const id = dragId
    setDragId(null); setOverId(null)
    try {
      const upd = await api.updateButton(id, { group: groupId })
      setButtons(prev => prev.map(b => b.id === id ? (upd as BtnDef) : b))
    } catch (er) { setError((er as Error).message || 'Could not move the button') }
  }

  const onDragEnd = () => {
    draggableRef.current = false
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Group bar: one chip per group (+ Other when it has buttons), a click opens that group's tray under it */}
      {!unreachable && (
        <div className="flex flex-wrap items-center gap-[3px]" data-testid="button-groups">
          {tabs.map(t => {
            const g = groups.find(x => x.id === t.id)
            const draggable = !!g
            return (
              <div key={t.id} className={`relative group ${dragGroup === t.id ? 'opacity-40' : ''}`}
                draggable={draggable}
                onDragStart={draggable ? e => { setDragGroup(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id) } : undefined}
                onDragOver={e => { if (dragGroup ? dragGroup !== t.id && draggable : !!dragId) { e.preventDefault(); if (overGroup !== t.id) setOverGroup(t.id) } }}
                onDragLeave={() => setOverGroup(prev => prev === t.id ? null : prev)}
                onDrop={e => void dropOnGroup(e, t.id)}
                onDragEnd={() => { setDragGroup(null); setOverGroup(null) }}>
                <button type="button" onClick={() => chooseOpen(t.id)} data-testid={`group-${t.id || 'other'}`}
                  title={`${t.name} · ${t.count} button${t.count === 1 ? '' : 's'}${draggable ? ' · drag to reorder, drop a button here to move it' : ''}`}
                  className={`px-1.5 py-0.5 text-[11px] rounded-full border whitespace-nowrap transition-colors ${
                    open === t.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'
                  } ${overGroup === t.id ? 'ring-2 ring-blue-400' : ''}`}>
                  {t.name}
                </button>
                {g && (
                  <div className="absolute -top-1.5 -right-1 hidden group-hover:flex items-center bg-white/90 rounded">
                    <button type="button" onClick={() => void renameGroup(g)} title="Rename the group"
                      className="text-[9px] px-0.5 text-gray-400 hover:text-blue-500 leading-none">✎</button>
                    <button type="button" onClick={() => void removeGroup(g)} title="Delete the group (its buttons move to Other)"
                      className="text-[9px] px-0.5 text-gray-400 hover:text-red-500 leading-none">×</button>
                  </div>
                )}
              </div>
            )
          })}
          <button type="button" onClick={() => void addGroup()} title="New group" data-testid="group-add"
            className="px-1 py-0.5 text-[11px] rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-blue-500 hover:border-blue-400">＋</button>
        </div>
      )}

      {/* The open group's tray */}
      {open !== CLOSED && !unreachable && (
        <div className="grid gap-1.5" data-testid="button-tray"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))' }}>
          {buttonsOf(buttons, groups, open).map(b => (
            <div
              key={b.id}
              className={`relative group ${dragId === b.id ? 'opacity-40' : ''} ${overId === b.id ? 'ring-2 ring-blue-400 rounded' : ''}`}
              draggable
              onDragStart={e => onDragStart(e, b.id)}
              onDragOver={e => onDragOver(e, b.id)}
              onDrop={e => onDrop(e, b.id)}
              onDragEnd={onDragEnd}
            >
              <button
                onClick={() => onRun(b.plan)}
                title={b.plan}
                className="w-full h-[30px] px-0.5 py-0 bg-gray-100 hover:bg-blue-50 hover:border-blue-400 border border-gray-200 text-gray-800 text-[11px] rounded text-center leading-tight overflow-hidden"
              >
                {b.label}
              </button>
              <div className="absolute top-0 right-0 hidden group-hover:flex items-center">
                <span
                  onMouseDown={() => { draggableRef.current = true }}
                  onMouseUp={() => { draggableRef.current = false }}
                  title="Drag to reorder (or onto a group above to move it)"
                  className="text-[9px] px-0.5 text-gray-400 hover:text-gray-700 leading-none cursor-grab active:cursor-grabbing select-none"
                >⋮⋮</span>
                <button
                  onClick={() => openEdit(b)}
                  className="text-[9px] px-0.5 text-gray-400 hover:text-blue-500 leading-none"
                >✎</button>
                <button
                  onClick={() => remove(b.id)}
                  className="text-[9px] px-0.5 text-gray-400 hover:text-red-500 leading-none"
                >×</button>
              </div>
            </div>
          ))}
          {form === null && (
            <button type="button" onClick={openAdd} title="Add a button to this group" data-testid="button-add"
              className="h-[30px] text-[13px] rounded border border-dashed border-gray-300 text-gray-400 hover:text-blue-500 hover:border-blue-400">＋</button>
          )}
        </div>
      )}

      {/* Empty / error state */}
      {!loading && buttons.length === 0 && groups.length === 0 && (
        <p className="text-[11px] text-gray-400">
          {unreachable
            ? 'Robot unreachable — connect a robot to load buttons.'
            : 'No shortcut buttons yet — click "+ add button" below.'}
        </p>
      )}

      {/* Error message (shown above form / + add) */}
      {error && (
        <p className="text-[11px] text-red-500">{error}</p>
      )}

      {/* Add/Edit form */}
      {form !== null ? (
        <div className="flex flex-col gap-1.5 bg-gray-50 border border-gray-200 rounded p-2 text-xs">
          <input
            autoFocus
            placeholder="Label"
            value={form.label}
            onChange={e => setForm(f => f && ({ ...f, label: e.target.value }))}
            className="bg-white border border-gray-200 rounded px-2 py-1 text-gray-800 placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <label className="flex items-center gap-1.5 text-gray-500">
            group
            <select value={form.group} onChange={e => setForm(f => f && ({ ...f, group: e.target.value }))}
              className="flex-1 bg-white border border-gray-200 rounded px-1 py-0.5 text-gray-800">
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value={OTHER}>Other</option>
            </select>
          </label>
          <textarea
            placeholder={'find::apple\nnavigate::kitchen'}
            value={form.plan}
            onChange={e => setForm(f => f && ({ ...f, plan: e.target.value }))}
            rows={3}
            className="bg-white border border-gray-200 rounded px-2 py-1 text-gray-800 font-mono placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={submit}
              disabled={unreachable}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded"
              title={unreachable ? 'Robot unreachable' : undefined}
            >
              {editId ? 'Update' : 'Add'}
            </button>
            <button onClick={cancel}
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded">Cancel</button>
          </div>
        </div>
      ) : open === CLOSED || unreachable ? (
        <button
          onClick={openAdd}
          disabled={unreachable}
          className="self-start text-[11px] text-gray-400 hover:text-blue-500 disabled:text-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
          title={unreachable ? 'Robot unreachable' : undefined}
        >
          + add button
        </button>
      ) : null}
    </div>
  )
}
