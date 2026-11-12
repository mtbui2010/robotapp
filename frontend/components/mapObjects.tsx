'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { callUses, drawnAt, fillCall, hasAction, kindColor, objectTitle, parseObjects, pollMs, readRequest, type MapObject } from '../lib/mapObjects'
import type { MapConfig } from '../lib/types'

// The Map tab's objects layer (only when the site's MAP config has `objects`): labelled markers, polled read-only
// (GET /agent/<agent>/get, or POST /agent/<agent>/send for a backend that answers a command). A click selects a
// marker; Move (then click the map, or pick a place) and Remove appear only for the actions the backend declared,
// Add (kind + place) only with `spawn`. All logic is in lib/mapObjects.ts.

type Pt = [number, number]

export function useMapObjects({ cfg, robot, places, setStatus, running }: {
  cfg: MapConfig | null; robot: { x: number; y: number } | null; places: string[]
  setStatus: (s: string) => void; running: boolean
}) {
  const oc = cfg?.objects
  const [objs, setObjs] = useState<MapObject[]>([])
  const [sel, setSel]   = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [kind, setKind] = useState('')
  const [place, setPlace] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!oc) { setObjs([]); return }
    let stop = false
    const tick = async () => {
      try {
        const rq = readRequest(oc)
        const reply = rq.send ? await api.agentSend(rq.agent, rq.send) : await api.agentGet(rq.agent)
        if (!stop) setObjs(parseObjects(reply, oc))
      } catch { /* backend not up yet */ }
    }
    tick()
    const id = setInterval(tick, pollMs(oc))
    return () => { stop = true; clearInterval(id) }
  }, [oc])

  const kinds = useMemo(() => Array.from(new Set(objs.map(o => o.kind).filter(Boolean))).sort(), [objs])
  const selected = objs.find(o => o.id === sel) ?? null

  const call = useCallback(async (a: 'spawn' | 'move' | 'remove', vars: Parameters<typeof fillCall>[1], what: string) => {
    const tpl = oc?.actions?.[a]
    if (!tpl) return
    if (running) { setStatus('A plan is running — stop it first.'); return }
    setBusy(true); setStatus(`${what}…`)
    try {
      const r = 'skill' in tpl ? await api.runSkill(tpl.skill, fillCall(tpl, vars)) : await api.agentSend(tpl.agent, fillCall(tpl, vars))
      setStatus(r.isdone === false || r.ok === false ? `${what} failed: ${String(r.msg ?? r.error ?? '')}` : `${what}: done`)
    } catch (e) { setStatus(`${what} failed: ${e instanceof Error ? e.message : e}`) }
    finally { setBusy(false) }
  }, [oc, running, setStatus])

  /** A map click while Move is armed puts the selected object there; true = the click was used. */
  const click = (w: Pt): boolean => {
    if (!moving || !selected) return false
    setMoving(false)
    void call('move', { id: selected.id, x: w[0], y: w[1], cls: selected.kind }, `move ${selected.label}`)
    return true
  }

  const overlay = (S: (x: number, y: number) => Pt) => !oc ? null : (
    <g>
      {objs.map(o => {
        const at = drawnAt(o, robot); if (!at) return null
        const [px, py] = S(at[0], at[1])
        const on = o.id === sel
        return (
          <g key={o.id} style={{ cursor: 'pointer' }} onClick={ev => { ev.stopPropagation(); setSel(o.id); setMoving(false) }}>
            <circle cx={px} cy={py} r={on ? 0.1 : 0.07} fill={kindColor(o.kind || o.label)} stroke={on ? 'rgb(30,30,30)' : 'white'} strokeWidth={on ? 0.03 : 0.02}>
              <title>{objectTitle(o)}</title>
            </circle>
            <text x={px + 0.1} y={py - 0.08} fontSize={0.11} fill="rgb(30,30,30)" stroke="white" strokeWidth={0.02} paintOrder="stroke" pointerEvents="none">{o.label}</text>
          </g>)
      })}
    </g>)

  const btn = 'px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40'
  const canMove = hasAction(oc, 'move'), canRemove = hasAction(oc, 'remove'), canAdd = hasAction(oc, 'spawn')
  const bar = !oc ? null : (
    <div data-testid="objects-bar" className="flex flex-wrap items-center gap-2 text-xs px-1 py-1">
      <span className="font-medium text-gray-700">Objects ({objs.length})</span>
      <span className="text-gray-500 truncate">{selected ? <b className="text-gray-800">{objectTitle(selected)}</b> : 'click a marker to select it'}</span>
      {selected && canMove && (
        <>
          <button className={btn} disabled={busy} onClick={() => { setMoving(m => !m); setStatus(moving ? '' : `click the map to put ${selected.label} there`) }}>{moving ? 'cancel move' : 'Move'}</button>
          {places.length > 0 && callUses(oc?.actions?.move, 'place') && (
            <select className="bg-white border border-gray-300 rounded px-1 py-0.5" value="" disabled={busy}
                    onChange={e => { if (e.target.value) void call('move', { id: selected.id, place: e.target.value, cls: selected.kind }, `move ${selected.label} to ${e.target.value}`) }}>
              <option value="">to a place…</option>
              {places.map(p => <option key={p} value={p}>{p}</option>)}
            </select>)}
        </>)}
      {selected && canRemove && (
        <button className={btn} disabled={busy}
                onClick={() => { if (window.confirm(`Remove ${selected.label}?`)) { void call('remove', { id: selected.id, cls: selected.kind }, `remove ${selected.label}`); setSel(null) } }}>Remove</button>)}
      {canAdd && (
        <>
          <input list="map-obj-kinds" className="bg-white border border-gray-300 rounded px-1 py-0.5 w-28" placeholder="kind" value={kind} onChange={e => setKind(e.target.value)} />
          <datalist id="map-obj-kinds">{kinds.map(k => <option key={k} value={k} />)}</datalist>
          <select className="bg-white border border-gray-300 rounded px-1 py-0.5" value={place} onChange={e => setPlace(e.target.value)}>
            <option value="">place…</option>
            {places.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className={btn} disabled={busy || !kind.trim() || !place}
                  onClick={() => void call('spawn', { cls: kind.trim(), place }, `add ${kind.trim()} at ${place}`)}>Add</button>
        </>)}
    </div>)

  return { enabled: !!oc, bar, overlay, click, moving }
}
