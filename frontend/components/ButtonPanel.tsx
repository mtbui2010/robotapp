'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/api'

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

interface BtnDef {
  id: string
  label: string
  plan: string
}

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

const emptyForm = { label: '', plan: '' }

export default function ButtonPanel({ onRun, refreshKey = 0 }: Props) {
  const [buttons, setButtons]   = useState<BtnDef[]>([])
  const [form, setForm]         = useState<{ label: string; plan: string } | null>(null)
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
      setUnreachable(false)
    } catch (e) {
      setButtons([])
      setUnreachable(true)
      setError((e as Error).message || 'Could not reach robot')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload, refreshKey])

  const openAdd  = () => { setEditId(null); setForm(emptyForm); setError(null) }
  const openEdit = (b: BtnDef) => { setEditId(b.id); setForm({ label: b.label, plan: b.plan }); setError(null) }
  const cancel   = () => { setForm(null); setEditId(null); setError(null) }

  const submit = async () => {
    if (!form || !form.label.trim()) return
    setError(null)
    try {
      if (editId) {
        const updated = await api.updateButton(editId, { label: form.label, plan: form.plan })
        setButtons(prev => prev.map(b => b.id === editId ? (updated as BtnDef) : b))
      } else {
        const created = await api.addButton(form.label, form.plan)
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
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return }
    const from = buttons.findIndex(b => b.id === dragId)
    const to   = buttons.findIndex(b => b.id === targetId)
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return }

    const optimistic = buttons.slice()
    const [moved] = optimistic.splice(from, 1)
    optimistic.splice(to, 0, moved)
    setButtons(optimistic)
    setDragId(null)
    setOverId(null)

    try {
      await api.reorderButtons(optimistic.map(b => b.id))
    } catch (e) {
      setError((e as Error).message || 'Reorder failed')
      void reload()  // revert from server
    }
  }

  const onDragEnd = () => {
    draggableRef.current = false
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Button grid */}
      {buttons.length > 0 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
          {buttons.map(b => (
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
                className="w-full h-11 px-1 py-1.5 bg-gray-100 hover:bg-blue-50 hover:border-blue-400 border border-gray-200 text-gray-800 text-xs rounded text-center leading-tight line-clamp-2 break-words"
              >
                {b.label}
              </button>
              <div className="absolute top-0 right-0 hidden group-hover:flex items-center">
                <span
                  onMouseDown={() => { draggableRef.current = true }}
                  onMouseUp={() => { draggableRef.current = false }}
                  title="Drag to reorder"
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
        </div>
      )}

      {/* Empty / error state */}
      {!loading && buttons.length === 0 && (
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
      ) : (
        <button
          onClick={openAdd}
          disabled={unreachable}
          className="self-start text-[11px] text-gray-400 hover:text-blue-500 disabled:text-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
          title={unreachable ? 'Robot unreachable' : undefined}
        >
          + add button
        </button>
      )}
    </div>
  )
}
