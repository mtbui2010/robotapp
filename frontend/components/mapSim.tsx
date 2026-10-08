'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { MapConfig, SimFurniture, SimObject, SimState } from '../lib/types'

// The Map tab's "Sim" bar (simulation only: MAP.sim = {agent}). Talks to kcare-sim's /sim/command through
// robot_agent (POST /agent/<agent>/send):
//   • Reset: objects / objects + drawers / everything (robot back at the start too)
//   • Scenes: load, save as (live object poses included), delete
//   • Objects mode: drag an object to put it there (instant); Del removes; pick from the catalog + click adds
//   • Furniture mode: drag a piece, ← → turn it 15°, Del removes, catalog + click adds
// Removing / adding anything, and every furniture change, is collected as a draft and applied with one rebuild
// of the house ("Apply changes", a few seconds; the robot stays where it is); kcare's ENV / MAP are then
// refreshed with what the rebuild produced.

type Scene = {
  furniture?: Record<string, { pos?: [number, number]; yaw_deg?: number; remove?: boolean }>
  add?: { id: string; type: string; pos: [number, number]; yaw_deg?: number }[]
  objects?: { name: string; ycb: string; at?: number[]; quat?: number[]; surface?: string; offset?: number[]; yaw_deg?: number }[]
  [k: string]: unknown
}
type Pt = [number, number]
type Drag = { kind: 'obj' | 'furn'; name: string; off: Pt; cur: Pt; start: Pt }

const DEG = Math.PI / 180
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? {}))

function inRect(c: Pt, size: Pt, yawDeg: number, p: Pt): boolean {
  const a = yawDeg * DEG, dx = p[0] - c[0], dy = p[1] - c[1]
  const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(u) <= size[0] / 2 && Math.abs(v) <= size[1] / 2
}

function rectPts(c: Pt, size: Pt, yawDeg: number): Pt[] {
  const a = yawDeg * DEG, [d, w] = size
  return ([[-d / 2, -w / 2], [d / 2, -w / 2], [d / 2, w / 2], [-d / 2, w / 2]] as Pt[])
    .map(([u, v]) => [c[0] + u * Math.cos(a) - v * Math.sin(a), c[1] + u * Math.sin(a) + v * Math.cos(a)])
}

const prettyYcb = (id: string) => id.replace(/^\d+(-[a-z])?_/, '').replace(/_/g, ' ')

export function useSimEditor({ cfg, setStatus, reloadMap, running, otherEdit }: {
  cfg: MapConfig | null; setStatus: (s: string) => void; reloadMap: () => Promise<void> | void
  running: boolean; otherEdit: boolean
}) {
  const agent = cfg?.sim?.agent
  const [st, setSt]         = useState<SimState | null>(null)
  const [mode, setMode]     = useState<'off' | 'objects' | 'furniture'>('off')
  const [draft, setDraft]   = useState<Scene | null>(null)
  const [sel, setSel]       = useState<string | null>(null)
  const [drag, setDrag_]    = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)                // the handlers read the ref: mouse events can outrun a re-render
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDrag_(d) }
  const [adding, setAdding] = useState('')                 // catalog key to place with the next click
  const [busy, setBusy]     = useState<string | null>(null)
  const [pick, setPick]     = useState('')                 // scene picked in the dropdown
  const busyRef = useRef(false)
  const pickInit = useRef(false)                           // the dropdown starts at the scene that is loaded

  const send = useCallback(async (cmd: Record<string, unknown>) => {
    if (!agent) throw new Error('no sim agent')
    return api.agentSend(agent, cmd) as Promise<Record<string, unknown>>
  }, [agent])

  const refresh = useCallback(async () => {
    if (!agent || busyRef.current) return
    try { const s = (await send({ cmd: 'state' })) as unknown as SimState; if (s.ok) setSt(s) } catch { /* sim not up */ }
  }, [agent, send])
  useEffect(() => {
    if (!agent) return
    refresh()
    const id = setInterval(refresh, mode === 'off' ? 3000 : 1000)
    return () => clearInterval(id)
  }, [agent, refresh, mode])
  useEffect(() => { if (st && !pickInit.current) { pickInit.current = true; setPick(st.scene === '_working' ? '' : st.scene || '') } }, [st])

  // ── the draft (structural changes, applied with one rebuild) ─────────────────
  const base = (st?.scene_def ?? {}) as Scene
  const cur: Scene = draft ?? base
  const pending = !!draft && JSON.stringify(draft) !== JSON.stringify(base)
  const draftRef = useRef<Scene | null>(null)               // latest draft, also between two renders
  draftRef.current = draft
  const edit = (fn: (s: Scene) => void) => {
    const s = clone(draftRef.current ?? base)
    fn(s)
    draftRef.current = s
    setDraft(s)
  }
  const explicitObjects = (s: Scene) => {                  // the scene lists its objects once we edit them
    // untouched objects keep their surface (so they follow a moved table); hand-moved ones keep their live pose
    if (!s.objects) s.objects = (st?.objects ?? []).filter(o => o.ycb).map(o => o.spec && !o.moved
      ? { name: o.name, ycb: o.ycb!, ...o.spec }
      : { name: o.name, ycb: o.ycb!, at: o.pos, quat: o.quat })
    return s.objects
  }
  const furnPose = (name: string, f: SimFurniture): { pos: Pt; yaw: number } | null => {
    const add = cur.add?.find(a => a.id === name)
    if (add) return { pos: add.pos, yaw: add.yaw_deg ?? 0 }
    const o = cur.furniture?.[name]
    if (o?.remove) return null
    return { pos: (o?.pos ?? f.pos) as Pt, yaw: o?.yaw_deg ?? f.yaw_deg }
  }
  const footprint = (name: string, f: SimFurniture, p: { pos: Pt; yaw: number }) => {
    if (!f.footprint) return { c: p.pos, size: [0.5, 0.5] as Pt, yaw: p.yaw }
    const da = (p.yaw - f.yaw_deg) * DEG, dx = f.footprint.centre[0] - f.pos[0], dy = f.footprint.centre[1] - f.pos[1]
    return { c: [p.pos[0] + dx * Math.cos(da) - dy * Math.sin(da), p.pos[1] + dx * Math.sin(da) + dy * Math.cos(da)] as Pt,
             size: f.footprint.size, yaw: f.footprint.yaw_deg + (p.yaw - f.yaw_deg) }
  }
  // pieces added in the draft but not built yet
  const draftAdds = (cur.add ?? []).filter(a => !st?.furniture[a.id])
  const draftObjects = cur.objects ? cur.objects.filter(o => !st?.objects.some(s => s.name === o.name)) : []
  const removedObjects = new Set(cur.objects ? (st?.objects ?? []).filter(o => !cur.objects!.some(c => c.name === o.name)).map(o => o.name) : [])

  const moveFurn = (name: string, pos: Pt, yaw?: number) => edit(s => {
    const a = s.add?.find(x => x.id === name)
    if (a) { a.pos = [Number(pos[0].toFixed(3)), Number(pos[1].toFixed(3))]; if (yaw != null) a.yaw_deg = yaw; return }
    s.furniture = s.furniture ?? {}
    const f = st!.furniture[name], prev = s.furniture[name] ?? {}
    s.furniture[name] = { pos: [Number(pos[0].toFixed(3)), Number(pos[1].toFixed(3))], yaw_deg: yaw ?? prev.yaw_deg ?? f.yaw_deg }
  })
  const removeSel = () => {
    if (!sel || !st) return
    if (mode === 'objects') edit(s => { s.objects = explicitObjects(s).filter(o => o.name !== sel) })
    else if (mode === 'furniture') edit(s => {
      if (s.add?.some(a => a.id === sel)) s.add = s.add.filter(a => a.id !== sel)
      else { s.furniture = s.furniture ?? {}; s.furniture[sel] = { remove: true } }
    })
    setStatus(`removed ${sel} (apply to rebuild)`); setSel(null)
  }
  const addAt = (p: Pt) => {
    if (!adding || !st) return
    if (mode === 'objects') edit(s => {
      const objs = explicitObjects(s), base0 = prettyYcb(adding)
      let name = base0, k = 2
      while (objs.some(o => o.name === name) || st.objects.some(o => o.name === name)) name = `${base0} ${k++}`
      objs.push({ name, ycb: adding, at: [Number(p[0].toFixed(3)), Number(p[1].toFixed(3))], yaw_deg: 0 })
      setStatus(`added ${name} (apply to rebuild)`)
    })
    else if (mode === 'furniture') edit(s => {
      s.add = s.add ?? []
      let k = 1
      const stem = adding.replace(/ /g, '_')
      while (s.add.some(a => a.id === `${stem}_${k}`) || st.furniture[`${stem}_${k}`]) k++
      s.add.push({ id: `${stem}_${k}`, type: adding, pos: [Number(p[0].toFixed(3)), Number(p[1].toFixed(3))], yaw_deg: 0 })
      setStatus(`added ${stem}_${k} (apply to rebuild)`)
    })
  }

  // after a rebuild: kcare gets the regenerated ENV / MAP (places, surfaces, layers)
  const afterRebuild = async (r: Record<string, unknown>) => {
    if (r.env) await api.updateSkillConfig('ENV', r.env as Record<string, unknown>)
    if (r.map) await api.updateSkillConfig('MAP', r.map as Record<string, unknown>)
    setDraft(null); setSel(null); setAdding('')
    await reloadMap()
  }
  const run = async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(label)
    try { await fn() } catch (e) { setStatus(`error: ${(e as Error).message}`) }
    finally { busyRef.current = false; setBusy(null); refresh() }
  }
  const apply = () => run('rebuilding the house…', async () => {
    const r = await send({ cmd: 'apply', scene: draft ?? {} })
    if (!r.ok) { setStatus(`apply failed: ${String(r.msg)}`); return }
    await afterRebuild(r)
    setStatus(`${String(r.msg)}${(r.skipped as string[] | undefined)?.length ? ' · ' + (r.skipped as string[]).join('; ') : ''}`)
  })
  const load = () => run(`loading ${pick || 'the base house'}…`, async () => {
    if (pending && !window.confirm('Discard the changes that are not applied yet?')) return
    const r = pick ? await send({ cmd: 'load', name: pick }) : await send({ cmd: 'apply', scene: {} })
    if (!r.ok) { setStatus(`load failed: ${String(r.msg)}`); return }
    await afterRebuild(r); setStatus(`loaded ${pick || 'the base house'} (${String(r.msg)})`)
  })
  const save = () => {
    if (pending) { setStatus('apply the pending changes first, then save'); return }
    const name = window.prompt('Save the scene as (letters, digits, - _):', st?.scene && st.scene !== '_working' ? st.scene : '')?.trim()
    if (!name) return
    if (st?.scenes.includes(name) && !window.confirm(`Overwrite scene "${name}"?`)) return
    run('saving…', async () => { const r = await send({ cmd: 'save', name }); setStatus(String(r.msg)); setPick(name) })
  }
  const del = () => {
    if (!pick || !window.confirm(`Delete scene "${pick}"? (the house as it is now stays)`)) return
    run('deleting…', async () => { const r = await send({ cmd: 'delete', name: pick }); setStatus(String(r.msg)); setPick('') })
  }
  const reset = (what: 'objects' | 'scene' | 'all') => {
    if (running) { setStatus('A plan is running — stop it first.'); return }
    if (what === 'all' && !window.confirm('Reset everything? The robot jumps back to its start pose.')) return
    run('resetting…', async () => {
      const r = await send({ cmd: 'reset', what })
      if (what === 'all') await api.setWorld({ holding: null, found: null, opened: [] }).catch(() => null)
      setStatus(String(r.msg))
    })
  }

  // ── pointer / keys (return true when consumed) ──────────────────────────────
  const editing = mode !== 'off'
  const hitObject = (p: Pt) => (st?.objects ?? []).filter(o => !removedObjects.has(o.name))
    .map(o => ({ o, d: Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) })).filter(x => x.d < 0.15).sort((a, b) => a.d - b.d)[0]?.o
  const hitFurn = (p: Pt) => {
    for (const [name, f] of Object.entries(st?.furniture ?? {})) {
      if (!f.editable) continue
      const pose = furnPose(name, f); if (!pose) continue
      const fp = footprint(name, f, pose)
      if (inRect(fp.c, fp.size, fp.yaw, p)) return { name, pose }
    }
    const a = draftAdds.find(x => Math.hypot(x.pos[0] - p[0], x.pos[1] - p[1]) < 0.3)
    return a ? { name: a.id, pose: { pos: a.pos, yaw: a.yaw_deg ?? 0 } } : null
  }
  const down = (p: Pt): boolean => {
    if (!editing || busy) return false
    if (mode === 'objects') {
      const o = hitObject(p)
      if (o) { setSel(o.name); setDrag({ kind: 'obj', name: o.name, off: [o.pos[0] - p[0], o.pos[1] - p[1]], cur: [o.pos[0], o.pos[1]], start: [o.pos[0], o.pos[1]] }); return true }
    } else {
      const h = hitFurn(p)
      if (h) { setSel(h.name); setDrag({ kind: 'furn', name: h.name, off: [h.pose.pos[0] - p[0], h.pose.pos[1] - p[1]], cur: h.pose.pos, start: h.pose.pos }); return true }
    }
    return false
  }
  const move = (p: Pt) => { const d = dragRef.current; if (d) setDrag({ ...d, cur: [p[0] + d.off[0], p[1] + d.off[1]] }) }
  const up = async () => {
    const d = dragRef.current
    if (!d) return
    setDrag(null)
    if (Math.hypot(d.cur[0] - d.start[0], d.cur[1] - d.start[1]) < 0.01) return     // a click only selects
    if (d.kind === 'furn') { moveFurn(d.name, d.cur); setStatus(`${d.name} moved (apply to rebuild)`); return }
    const o = st?.objects.find(x => x.name === d.name)
    if (!o) return
    if (cur.objects && draftObjects.some(x => x.name === d.name)) return
    const r = await send({ cmd: 'move_object', body: o.body, x: d.cur[0], y: d.cur[1] })
    setStatus(String(r.msg)); refresh()
  }
  const click = (p: Pt): boolean => {
    if (!editing) return false
    if (adding && !busy) { addAt(p); return true }
    return true                                              // no robot moves while editing the scene
  }
  const key = (e: React.KeyboardEvent): boolean => {
    if (!editing) return false
    if (!sel) return ['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(e.key)   // never turn the robot while editing
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); return true }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const d = e.key === 'ArrowLeft' ? 15 : -15
      if (mode === 'furniture' && st) {
        const f = st.furniture[sel], pose = f ? furnPose(sel, f) : draftAdds.find(a => a.id === sel) ? { pos: draftAdds.find(a => a.id === sel)!.pos, yaw: draftAdds.find(a => a.id === sel)!.yaw_deg ?? 0 } : null
        if (pose) { const yaw = ((pose.yaw + d + 540) % 360) - 180; moveFurn(sel, pose.pos, yaw); setStatus(`${sel} at (${pose.pos[0].toFixed(2)}, ${pose.pos[1].toFixed(2)}) turned to ${yaw}° (apply to rebuild)`) }
      } else if (mode === 'objects') {
        const o = st?.objects.find(x => x.name === sel)
        if (o) send({ cmd: 'move_object', body: o.body, x: o.pos[0], y: o.pos[1], yaw_deg: o.yaw_deg + d }).then(() => refresh())
      }
      return true
    }
    return false
  }

  // ── drawing (S: world -> svg) ───────────────────────────────────────────────
  const overlay = (S: (x: number, y: number) => Pt) => {
    if (!st || !editing) return null
    const poly = (pts: Pt[]) => pts.map(p => S(...p).join(',')).join(' ')
    if (mode === 'objects') return (
      <g>
        {st.objects.filter(o => !removedObjects.has(o.name)).map(o => {
          const p: Pt = drag?.kind === 'obj' && drag.name === o.name ? drag.cur : [o.pos[0], o.pos[1]]
          const [x, y] = S(...p), on = sel === o.name
          return (
            <g key={o.body} style={{ cursor: 'grab' }}>
              <circle cx={x} cy={y} r={on ? 0.09 : 0.065} fill={on ? 'rgb(250,204,21)' : 'rgb(168,85,247)'} stroke="white" strokeWidth={0.02} />
              <text x={x + 0.09} y={y - 0.06} fontSize={0.11} fill="rgb(88,28,135)" pointerEvents="none">{o.name}{o.pos[2] < 0.05 && o.surface ? ' (on the floor)' : ''}</text>
            </g>)
        })}
        {draftObjects.map(o => { const [x, y] = S(o.at![0], o.at![1]); return (
          <g key={`new-${o.name}`} pointerEvents="none">
            <circle cx={x} cy={y} r={0.07} fill="none" stroke="rgb(168,85,247)" strokeWidth={0.02} strokeDasharray="0.04 0.03" />
            <text x={x + 0.09} y={y - 0.06} fontSize={0.11} fill="rgb(88,28,135)">{o.name} (new)</text>
          </g>) })}
      </g>)
    return (
      <g>
        {Object.entries(st.furniture).map(([name, f]) => {
          const pose0 = furnPose(name, f)
          if (!pose0) {                                       // removed in the draft
            if (!f.footprint) return null
            return <polygon key={name} points={poly(rectPts(f.footprint.centre, f.footprint.size, f.footprint.yaw_deg))} fill="rgba(220,38,38,0.12)" stroke="rgb(220,38,38)" strokeWidth={0.02} strokeDasharray="0.05 0.04" pointerEvents="none" />
          }
          const pose = drag?.kind === 'furn' && drag.name === name ? { ...pose0, pos: drag.cur } : pose0
          const fp = footprint(name, f, pose), on = sel === name
          const moved = pose.pos[0] !== f.pos[0] || pose.pos[1] !== f.pos[1] || pose.yaw !== f.yaw_deg
          const [lx, ly] = S(...fp.c)
          return (
            <g key={name} style={{ cursor: f.editable ? 'grab' : 'not-allowed' }}>
              <polygon points={poly(rectPts(fp.c, fp.size, fp.yaw))}
                       fill={on ? 'rgba(250,204,21,0.25)' : f.editable ? 'rgba(14,165,233,0.10)' : 'rgba(120,120,120,0.10)'}
                       stroke={on ? 'rgb(202,138,4)' : moved ? 'rgb(234,88,12)' : f.editable ? 'rgb(14,116,144)' : 'rgb(120,120,120)'}
                       strokeWidth={0.02} strokeDasharray={moved ? '0.06 0.04' : undefined} />
              {(on || moved) && <text x={lx} y={ly} fontSize={0.11} textAnchor="middle" fill="rgb(30,30,30)" pointerEvents="none">{name}</text>}
            </g>)
        })}
        {draftAdds.map(a => {
          const pose = drag?.kind === 'furn' && drag.name === a.id ? drag.cur : a.pos
          const [lx, ly] = S(...pose)
          return (
            <g key={`add-${a.id}`}>
              <polygon points={poly(rectPts(pose, [0.6, 0.6], a.yaw_deg ?? 0))} fill="rgba(234,88,12,0.12)" stroke="rgb(234,88,12)" strokeWidth={0.02} strokeDasharray="0.06 0.04" />
              <text x={lx} y={ly} fontSize={0.11} textAnchor="middle" fill="rgb(154,52,18)" pointerEvents="none">{a.type} (new)</text>
            </g>)
        })}
      </g>)
  }

  // ── the bar ─────────────────────────────────────────────────────────────────
  const btn = 'px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40'
  const bar = agent ? (
    <div className="text-xs text-gray-600 bg-violet-50 border border-violet-200 rounded px-2 py-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-violet-800">Sim</span>
        <button className={btn} disabled={!!busy} onClick={() => reset('objects')} title="every object back where the scene put it">↺ objects</button>
        <button className={btn} disabled={!!busy} onClick={() => reset('scene')} title="objects + drawers closed">↺ + drawers</button>
        <button className={btn} disabled={!!busy} onClick={() => reset('all')} title="+ the robot back at its start pose">↺ everything</button>
        <span className="ml-2">scene</span>
        <select className="border border-gray-300 rounded px-1 py-0.5 bg-white" value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">base house</option>
          {(st?.scenes ?? []).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className={btn} disabled={!!busy} onClick={load}>Load</button>
        <button className={btn} disabled={!!busy} onClick={save}>Save as…</button>
        <button className={btn} disabled={!!busy || !pick} onClick={del}>Delete</button>
        <span className="text-gray-500">now: <b>{st?.scene ? (st.scene === '_working' ? 'unsaved edit' : st.scene) : 'base house'}</b>{st?.dirty ? ' · objects moved' : ''}</span>
        {busy && <span className="text-violet-700 animate-pulse">{busy}</span>}
      </div>
      {/* one fixed-height row: selecting / editing must not move the map under the mouse */}
      <div className="flex items-center gap-2 h-6 whitespace-nowrap overflow-hidden">
        {(['objects', 'furniture'] as const).map(m => (
          <button key={m} className={`${btn} ${mode === m ? '!bg-violet-600 !text-white !border-violet-600' : ''}`} disabled={otherEdit}
                  onClick={() => { setMode(mode === m ? 'off' : m); setSel(null); setAdding('') }}>✎ {m}</button>))}
        {editing ? (
          <>
            <select className="border border-gray-300 rounded px-1 py-0.5 bg-white w-44" value={adding} onChange={e => setAdding(e.target.value)}
                    title="pick one, then click on the map to place it">
              <option value="">+ add {mode === 'objects' ? 'object' : 'furniture'}…</option>
              {mode === 'objects'
                ? (st?.catalog.objects ?? []).map(k => <option key={k} value={k}>{prettyYcb(k)}</option>)
                : Object.entries(st?.catalog.furniture ?? {}).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button className={btn} disabled={!sel || !!busy} onClick={removeSel} title={sel ? `remove ${sel}` : 'select something first'}>remove</button>
            {pending && (
              <>
                <button className="px-2 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40" disabled={!!busy} onClick={apply}>Apply changes</button>
                <button className={btn} disabled={!!busy} onClick={() => { setDraft(null); setSel(null); setStatus('changes discarded') }}>Discard</button>
              </>)}
            <span className="text-gray-500 truncate">
              {sel ? <b className="text-violet-800">{sel} · </b> : null}
              {mode === 'objects' ? 'drag = put there now · ← → turn · Del remove' : 'drag = move · ← → turn 15° · Del remove'}
            </span>
          </>
        ) : (
          <>
            {pending && (
              <>
                <button className="px-2 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40" disabled={!!busy} onClick={apply}>Apply changes</button>
                <button className={btn} disabled={!!busy} onClick={() => { setDraft(null); setSel(null); setStatus('changes discarded') }}>Discard</button>
              </>)}
            <span className="text-gray-500 truncate">edit the scene: move / add / remove objects or furniture, then Save as…</span>
          </>)}
      </div>
    </div>
  ) : null

  return { enabled: !!agent, editing, bar, overlay, down, move, up, click, key, dragging: !!drag, adding: !!adding }
}
