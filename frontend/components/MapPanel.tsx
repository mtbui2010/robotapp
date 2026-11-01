'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useSimEditor } from './mapSim'
import { MapSettings } from './MapSettings'
import { getPath, poseFrom } from '../lib/robotPose'
import type { ClientEntry, MapConfig, MapFrame, MapLayer, MapOrigin, MapSkillCall, MapSurface } from '../lib/types'

// Map tab: the site's map with the robot on it. Everything comes from the active site's `MAP`
// skill-config group (see MapConfig in lib/types.ts), so the panel works for any robot that has one.
//   • click a free spot  → goal skill (e.g. moveb::x=..,y=..) keeping the current heading
//   • ← / →              → rotate skill, ±step_deg (turns are batched while one is running)
//   • click a place dot  → move::<ENV name>   (kcare lifts to the place's height itself)
//   • after a goal       → lift to the nearest surface within reach (+ clearance), or the typed height
//   • hover              → x, y, z under the cursor; red = blocked for the base
//   • "Save as place"    → current pose + height as a new ENV entry
//   • origin             → the user's frame (MAP.origin): axes, 1 m grid, scale bar, robot heading arc;
//                          "Edit origin" drags / rotates it, then asks whether ENV places follow it
//   • "Keep area"        → draw a polygon on the robot's whole map; outside it the saved map is
//                          unknown (no clicks) and the picture is cropped to it (POST /map/snapshot keep)

type Pose = { x: number; y: number; yaw: number }          // yaw [rad], map frame
type Raster = { frame: MapFrame; data: Uint8ClampedArray; url: string; tintUrl?: string }
type EnvEntry = { loc?: { x: number; y: number; rz: number }; height?: number; default_mode?: string } & Record<string, unknown>

const DEG = Math.PI / 180
const ZERO: MapOrigin = { x: 0, y: 0, yaw_deg: 0 }

// map frame <-> the user's origin frame
function toUser(o: MapOrigin, x: number, y: number): [number, number] {
  const a = o.yaw_deg * DEG, dx = x - o.x, dy = y - o.y
  return [dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a)]
}
function toMap(o: MapOrigin, u: number, v: number): [number, number] {
  const a = o.yaw_deg * DEG
  return [o.x + u * Math.cos(a) - v * Math.sin(a), o.y + u * Math.sin(a) + v * Math.cos(a)]
}
const wrapDeg = (d: number) => ((d + 180) % 360 + 360) % 360 - 180


// "{x}" -> 1.23 (number); "x={x}" -> "x=1.23" (string)
function fill(call: MapSkillCall, vars: Record<string, number>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(call.params ?? {})) {
    const lone = /^\{(\w+)\}$/.exec(v)
    out[k] = lone && lone[1] in vars
      ? Number(vars[lone[1]].toFixed(3))
      : v.replace(/\{(\w+)\}/g, (_, n: string) => (n in vars ? vars[n].toFixed(3) : `{${n}}`))
  }
  return out
}

// world (x, y) <-> pixel (column, row) of a frame
const toPx = (f: MapFrame, x: number, y: number) => [(x - f.origin[0]) / f.resolution, f.height - (y - f.origin[1]) / f.resolution]

function sample(r: Raster | null, x: number, y: number): number | null {
  if (!r) return null
  const [c, row] = toPx(r.frame, x, y).map(Math.floor)
  if (c < 0 || row < 0 || c >= r.frame.width || row >= r.frame.height) return null
  return r.data[(row * r.frame.width + c) * 4]          // grey PNG -> R channel
}

async function loadRaster(layer: MapLayer | undefined): Promise<Raster | null> {
  if (!layer) return null
  // fetched blob: canvas stays untainted; no-store: "Update map" rewrites the same file
  const blob = await (await fetch(api.siteFileUrl(layer.file), { cache: 'no-store' })).blob()
  const bmp = await createImageBitmap(blob)
  const cv = document.createElement('canvas')
  cv.width = bmp.width; cv.height = bmp.height
  const ctx = cv.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height)
  const r: Raster = { frame: { ...layer.frame, width: bmp.width, height: bmp.height }, data: img.data, url: URL.createObjectURL(blob) }
  if (layer.values) {                                   // occupancy: a red overlay (inflated light, obstacles dark)
    const inf = layer.values.inflated ?? 128, occ = layer.values.occupied ?? 255
    const t = ctx.createImageData(bmp.width, bmp.height)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i]
      t.data[i] = 220; t.data[i + 1] = 38; t.data[i + 2] = 38
      t.data[i + 3] = v >= occ ? 170 : v >= inf ? 80 : 0
    }
    ctx.putImageData(t, 0, 0)
    r.tintUrl = await new Promise<string>(res => cv.toBlob(b => res(URL.createObjectURL(b!)), 'image/png'))
  }
  return r
}

// distance from p to a surface rectangle (0 inside)
function distToSurface(s: MapSurface, x: number, y: number): number {
  const a = s.yaw_deg * DEG, dx = x - s.centre[0], dy = y - s.centre[1]
  const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a)
  const ou = Math.max(0, Math.abs(u) - s.size[0] / 2), ov = Math.max(0, Math.abs(v) - s.size[1] / 2)
  return Math.hypot(ou, ov)
}

function surfaceCorners(s: MapSurface): [number, number][] {
  const a = s.yaw_deg * DEG, [d, w] = s.size
  return ([[-d / 2, -w / 2], [d / 2, -w / 2], [d / 2, w / 2], [-d / 2, w / 2]] as [number, number][])
    .map(([u, v]) => [s.centre[0] + u * Math.cos(a) - v * Math.sin(a), s.centre[1] + u * Math.sin(a) + v * Math.cos(a)])
}

// "Update map": save a SLAM map connection (ROS topic of nav_msgs/OccupancyGrid — kcare: /map
// from the Slamtec bridge) as this site's map files + MAP config (POST /map/snapshot).
function MapUpdater({ clients, current, onSaved }: { clients: ClientEntry[]; current?: string; onSaved: () => void }) {
  const maps = clients.filter(c => String((c.config as Record<string, unknown>)?.data_interface ?? '').includes('OccupancyGrid'))
  const [conn, setConn] = useState(current ?? '')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!conn && maps.length) setConn(current && maps.some(m => m.name === current) ? current : maps[0].name) },
            [maps, conn, current])
  if (!maps.length) return (
    <span className="text-gray-400" title="Add a ROS topic connection with data_interface nav_msgs/msg/OccupancyGrid">
      no SLAM map connection (Connections panel → ROS Topic, nav_msgs/msg/OccupancyGrid)
    </span>)
  const save = async () => {
    if (!window.confirm(`Replace this site's map with the current "${conn}" map? (the old one is kept in map/history/)`)) return
    setSaving(true); setMsg('saving…')
    try {
      const r = await api.mapSnapshot(conn)
      setMsg(`saved ${r.size_m[0]}×${r.size_m[1]} m` + (r.kept ? ' · keep area applied' : '') + (r.specks ? ` · ${r.specks} specks removed` : '')
             + (r.missing.length ? ` · view only until MAP has ${r.missing.join(' / ')}` : ''))
      onSaved()
    } catch (e) { setMsg(`failed: ${(e as Error).message}`) }
    finally { setSaving(false) }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select className="border border-gray-300 rounded px-1 py-0.5 bg-white" value={conn} onChange={e => setConn(e.target.value)}
              title="SLAM map connection (nav_msgs/OccupancyGrid)">
        {maps.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
      </select>
      <button className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40" disabled={saving || !conn} onClick={save}
              title="Save the connection's current map as this site's map (map/map.png, map/occupancy.png)">⟳ Update map</button>
      {msg && <span className="text-gray-500">{msg}</span>}
    </span>)
}

export default function MapPanel({ clients, running }: { clients: ClientEntry[]; running: boolean }) {
  const [cfg, setCfg]           = useState<MapConfig | null>(null)
  const [cfgError, setCfgError] = useState<string | null>(null)
  const [frameSrc, setFrameSrc] = useState('')                 // latest camera frame (data URL)
  const [occ, setOcc]           = useState<Raster | null>(null)
  const [bg, setBg]             = useState<Raster | null>(null)  // image.file: the saved map picture
  const [hgt, setHgt]           = useState<Raster | null>(null)
  const [env, setEnv]           = useState<Record<string, EnvEntry>>({})
  const [pose, setPose]         = useState<Pose | null>(null)
  const [trail, setTrail]       = useState<[number, number][]>([])
  const [hover, setHover]       = useState<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const [goal, setGoal]         = useState<[number, number] | null>(null)
  const [busy, setBusy]         = useState(false)
  const [status, setStatus]     = useState('')
  const [showSurfaces, setShowSurfaces] = useState(true)
  const [showBlocked, setShowBlocked]   = useState(false)
  const [autoLift, setAutoLift]         = useState(true)
  const [manualH, setManualH]           = useState('')        // typed target height [m]; empty = auto
  const [showAxes, setShowAxes]         = useState(true)
  const [showGrid, setShowGrid]         = useState(true)
  const [editOrigin, setEditOrigin]     = useState(false)
  const [draft, setDraft]               = useState<MapOrigin | null>(null)   // origin being edited
  const [drag, setDrag]                 = useState<'move' | 'rotate' | null>(null)
  const [askApply, setAskApply]         = useState(false)                     // "places follow?" popup
  const [previewShift, setPreviewShift] = useState(false)                     // hovering "move places": ghost dots
  const [undo, setUndo] = useState<{ origin: MapOrigin; env: Record<string, EnvEntry> | null } | null>(null)
  // keep area being drawn: the robot's whole map (not saved) and the polygon's corners (map frame)
  const [showSettings, setShowSettings] = useState(false)                      // ⚙ MAP settings
  const [keepEdit, setKeepEdit] = useState<{ img: string; frame: MapFrame; pts: [number, number][] } | null>(null)
  const svgRef  = useRef<SVGSVGElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const turnRef = useRef({ pending: 0, sending: false })

  // ── config, layers, places ──────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setCfgError(null)
    const c = (await api.getSkillConfig('MAP')) as MapConfig | null
    if (!c || !(c.image || c.layers?.occupancy)) { setCfg(null); setCfgError('This site has no MAP config.'); return }
    setCfg(c)
    loadRaster(c.layers?.occupancy).then(setOcc).catch(() => setOcc(null))
    loadRaster(c.image?.file ? { file: c.image.file, frame: c.image.frame } : undefined).then(setBg).catch(() => setBg(null))
    loadRaster(c.layers?.height).then(setHgt).catch(() => setHgt(null))
    if (c.places === 'ENV') setEnv(((await api.getSkillConfig('ENV')) ?? {}) as Record<string, EnvEntry>)
  }, [])
  useEffect(() => { reload() }, [reload])
  const sim = useSimEditor({ cfg, setStatus, reloadMap: reload, running, otherEdit: editOrigin || !!keepEdit })

  // the display frame: the whole map while drawing the keep area, else the camera picture's / occupancy layer's
  const view: MapFrame | null = keepEdit?.frame ?? cfg?.image?.frame ?? occ?.frame ?? null
  const camClient = useMemo(() => clients.find(c => c.name === cfg?.image?.connection), [clients, cfg])

  // ── camera picture (same protocol as CameraCell) ────────────────────────────
  useEffect(() => {
    if (!camClient) return
    let cancelled = false, timer: ReturnType<typeof setTimeout> | null = null, ws: WebSocket | null = null
    const connect = () => {
      if (cancelled) return
      ws = api.cameraWs(camClient.id)
      ws.onmessage = e => {
        try { const d = JSON.parse(e.data); if (d.rgb) setFrameSrc(`data:image/jpeg;base64,${d.rgb}`) } catch { /* ignore */ }
      }
      ws.onclose = () => { if (!cancelled) timer = setTimeout(connect, 1500) }
    }
    connect()
    return () => { cancelled = true; if (timer) clearTimeout(timer); ws?.close() }
  }, [camClient])

  // ── robot pose (read-only polling) ──────────────────────────────────────────
  useEffect(() => {
    if (!cfg?.pose) return
    const p = cfg.pose
    let stop = false
    const tick = async () => {
      try {
        const got = poseFrom(await api.agentGet(p.agent), p)
        if (!stop && got) {
          const { x, y } = got
          setPose(got)
          setTrail(t => {
            const last = t[t.length - 1]
            return !last || Math.hypot(last[0] - x, last[1] - y) > 0.05 ? [...t.slice(-400), [x, y]] : t
          })
        }
      } catch { /* robot not up yet */ }
    }
    tick()
    const id = setInterval(tick, (p.period_s ?? 0.5) * 1000)
    return () => { stop = true; clearInterval(id) }
  }, [cfg])

  // ── what is under a point ───────────────────────────────────────────────────
  const surfaceAt = useCallback((x: number, y: number) => (cfg?.surfaces ?? []).find(s => distToSurface(s, x, y) === 0) ?? null, [cfg])
  const probe = useCallback((x: number, y: number) => {
    const s = surfaceAt(x, y)
    const o = sample(occ, x, y)
    const v = cfg?.layers?.occupancy?.values ?? { inflated: 128, occupied: 255 }
    const blocked = o != null && o >= (v.inflated ?? 128)
    const h = sample(hgt, x, y)
    const hUnit = (hgt?.frame.unit ?? 'cm') === 'mm' ? 0.001 : 0.01
    return { surface: s, blocked, z: s ? s.height : h != null ? h * hUnit : null, zIsTop: !s && h != null && h > 0 }
  }, [surfaceAt, occ, hgt, cfg])

  // ── motions ─────────────────────────────────────────────────────────────────
  const motionAllowed = (what: string) => {
    if (running) { setStatus('A plan is running — stop it first.'); return false }
    if (cfg?.confirm_goal && !window.confirm(`${what}?`)) return false
    return true
  }

  const liftFor = useCallback(async (p: Pose) => {
    if (!cfg?.lift) return
    let h: number | null = manualH.trim() ? Number(manualH) : null
    let why = 'typed height'
    if (h == null && autoLift) {
      const reach = cfg.lift.reach_m ?? 0.8
      const near = (cfg.surfaces ?? []).map(s => ({ s, d: distToSurface(s, p.x, p.y) })).filter(o => o.d <= reach).sort((a, b) => a.d - b.d)[0]
      if (near) { h = near.s.height; why = near.s.name }
    }
    if (h == null || !Number.isFinite(h)) return
    const target = h + (cfg.lift.clearance ?? 0.1)
    setStatus(`lift to ${target.toFixed(2)} m (${why} ${h.toFixed(3)} m + clearance)…`)
    const r = await api.runSkill(cfg.lift.skill, fill(cfg.lift, { h: target }))
    setStatus(r.isdone === false ? `lift failed: ${String(r.msg ?? '')}` : `arrived · lift ${target.toFixed(2)} m for ${why}`)
  }, [cfg, manualH, autoLift])

  const goTo = useCallback(async (x: number, y: number) => {
    if (!cfg || busy) return
    if (!cfg.goal || !cfg.pose) { setStatus('View only: add "pose" and "goal" to the MAP config to move the robot from the map.'); return }
    const pr = probe(x, y)
    if (pr.blocked) { setStatus(`(${x.toFixed(2)}, ${y.toFixed(2)}) is blocked for the base — pick a free (green) spot.`); return }
    if (!motionAllowed(`Move the robot to (${x.toFixed(2)}, ${y.toFixed(2)})`)) return
    setGoal([x, y]); setBusy(true); setStatus(`moving to (${x.toFixed(2)}, ${y.toFixed(2)})…`)
    try {
      const rz = (pose?.yaw ?? 0) / DEG
      const r = await api.runSkill(cfg.goal.skill, fill(cfg.goal, { x, y, rz }))
      if (r.isdone === false) { setStatus(`move failed: ${String(r.msg ?? '')}`); return }
      const pc = cfg.pose
      const v = await api.agentGet(pc.agent).catch(() => null)
      const px = v ? Number(getPath(v, pc.x)) : x, py = v ? Number(getPath(v, pc.y)) : y
      if (Math.hypot(px - x, py - y) > 0.3) {          // kcare reports done even when navigation gave up — BACKEND-WORKAROUND(map-arrive-check)
        setStatus(`stopped ${Math.hypot(px - x, py - y).toFixed(2)} m short of the goal (no path?)`); return
      }
      setStatus('arrived')
      await liftFor({ x: px, y: py, yaw: pose?.yaw ?? 0 })
    } catch (e) { setStatus(`error: ${(e as Error).message}`) }
    finally { setBusy(false); setGoal(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, busy, probe, pose, liftFor, running])

  const goPlace = useCallback(async (name: string) => {
    if (busy || !motionAllowed(`Move the robot to ${name}`)) return
    setBusy(true); setStatus(`move::${name}…`)
    try {
      const r = await api.runSkill('move', { inputs: name })
      setStatus(r.isdone === false ? `move failed: ${String(r.msg ?? '')}` : `arrived at ${name}`)
    } catch (e) { setStatus(`error: ${(e as Error).message}`) }
    finally { setBusy(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, running, cfg])

  // ← / → : batch key presses into one rotate while a turn is running
  const flushTurn = useCallback(async () => {
    const t = turnRef.current
    if (!cfg?.rotate || t.sending || t.pending === 0) return
    const deg = t.pending; t.pending = 0; t.sending = true
    setStatus(`rotate ${deg > 0 ? '+' : ''}${deg}°…`)
    try {
      const r = await api.runSkill(cfg.rotate.skill, fill(cfg.rotate, { deg }))
      setStatus(r.isdone === false ? `rotate failed: ${String(r.msg ?? '')}` : `rotated ${deg > 0 ? '+' : ''}${deg}°`)
    } catch (e) { setStatus(`error: ${(e as Error).message}`) }
    finally { t.sending = false; if (t.pending) flushTurn() }
  }, [cfg])

  const onKey = (e: React.KeyboardEvent) => {
    if (keepEdit) {                                       // Backspace / Delete: drop the last corner; no robot turns
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); setKeepEdit({ ...keepEdit, pts: keepEdit.pts.slice(0, -1) }) }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()
      return
    }
    if (sim.key(e)) return
    if (editOrigin && draft && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {   // rotate the origin
      e.preventDefault()
      const d = (e.shiftKey ? 1 : 5) * (e.key === 'ArrowLeft' ? 1 : -1)
      setDraft({ ...draft, yaw_deg: wrapDeg(draft.yaw_deg + d) }); return
    }
    if (!cfg?.rotate || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    if (running) { setStatus('A plan is running — stop it first.'); return }
    if (busy) { setStatus('wait until the robot arrives'); return }
    const step = cfg.rotate.step_deg ?? 15
    turnRef.current.pending += e.key === 'ArrowLeft' ? step : -step     // left = counter-clockwise
    flushTurn()
  }

  const savePlace = async () => {
    if (!pose) return
    const name = window.prompt('Name of the new place (e.g. "sofa@living room"):')?.trim()
    if (!name) return
    const near = (cfg?.surfaces ?? []).map(s => ({ s, d: distToSurface(s, pose.x, pose.y) })).sort((a, b) => a.d - b.d)[0]
    const guess = manualH.trim() ? Number(manualH) : near && near.d <= (cfg?.lift?.reach_m ?? 0.8) ? near.s.height : 0.7
    const hs = window.prompt('Surface height there [m]:', guess.toFixed(3))
    if (hs == null || !Number.isFinite(Number(hs))) return
    const cur = ((await api.getSkillConfig('ENV')) ?? {}) as Record<string, EnvEntry>
    if (cur[name] && !window.confirm(`"${name}" exists — overwrite it?`)) return
    cur[name] = { default_mode: 'front', height: Number(hs), placepose: { dx: 0, dy: 0 }, source: 'map',
                  loc: { x: Number(pose.x.toFixed(3)), y: Number(pose.y.toFixed(3)), rz: Number((pose.yaw / DEG).toFixed(1)) } }
    await api.updateSkillConfig('ENV', cur)
    setEnv(cur); setStatus(`saved "${name}" — move::${name} brings the robot back here`)
  }

  // ── keep area ───────────────────────────────────────────────────────────────
  const startKeep = async () => {
    const conn = cfg?.source?.connection
    if (!conn) return
    if (sim.editing || editOrigin) { setStatus('finish the other edit first'); return }
    setStatus('loading the robot\'s whole map…')
    try {
      const r = await api.mapPreview(conn)
      setKeepEdit({ img: r.image, frame: r.frame, pts: (cfg?.source?.keep ?? []).map(p => [p[0], p[1]] as [number, number]) })
      setStatus('click the corners of the area to keep (the house) · Backspace removes the last one')
      wrapRef.current?.focus()
    } catch (e) { setStatus(`error: ${(e as Error).message}`) }
  }
  const applyKeep = async (keep: [number, number][]) => {
    const conn = cfg?.source?.connection
    if (!conn) return
    setStatus(keep.length ? 'saving the map cropped to the keep area…' : 'saving the whole map…')
    try {
      const r = await api.mapSnapshot(conn, { keep: keep.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))] as [number, number]) })
      setStatus(`saved ${r.size_m[0]}×${r.size_m[1]} m` + (r.kept ? ' · outside the keep area is blocked' : ' · whole map') + (r.specks ? ` · ${r.specks} specks removed` : ''))
      setKeepEdit(null); setTrail([]); reload()
    } catch (e) { setStatus(`error: ${(e as Error).message}`) }
  }

  // ── origin editing ──────────────────────────────────────────────────────────
  const startEdit = () => {
    if (sim.editing || keepEdit) { setStatus('finish the other edit first'); return } setDraft({ ...(cfg?.origin ?? ZERO) }); setEditOrigin(true); setStatus('drag the origin dot to move it, the red arrow tip to rotate it (← → 5°, Shift 1°)'); wrapRef.current?.focus() }
  const cancelEdit = () => { setEditOrigin(false); setDraft(null); setDrag(null); setAskApply(false); setStatus('') }
  const placesWithLoc = Object.values(env).filter(e => e.loc).length
  // where every place would go if it moved with the axes (old origin -> draft)
  const shiftedPlaces = (from: MapOrigin, to: MapOrigin) => Object.entries(env).filter(([, e]) => e.loc).map(([name, e]) => {
    const [u, v] = toUser(from, e.loc!.x, e.loc!.y), [x, y] = toMap(to, u, v)
    return { name, from: [e.loc!.x, e.loc!.y] as [number, number], to: [x, y] as [number, number], d: Math.hypot(x - e.loc!.x, y - e.loc!.y) }
  })

  const applyOrigin = async (placesFollow: boolean) => {
    if (!cfg || !draft) return
    const old = cfg.origin ?? ZERO
    const neu = { x: Number(draft.x.toFixed(3)), y: Number(draft.y.toFixed(3)), yaw_deg: Number(wrapDeg(draft.yaw_deg).toFixed(2)) }
    try {
      const before = placesFollow ? ((await api.getSkillConfig('ENV')) ?? {}) as Record<string, EnvEntry> : null
      if (placesFollow) {                    // keep every place's coordinates relative to the origin -> they move with it
        const cur = ((await api.getSkillConfig('ENV')) ?? {}) as Record<string, EnvEntry>
        for (const e of Object.values(cur)) {
          if (!e.loc) continue
          const [u, v] = toUser(old, e.loc.x, e.loc.y)
          const [x, y] = toMap(neu, u, v)
          e.loc = { ...e.loc, x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), rz: Number(wrapDeg(e.loc.rz - old.yaw_deg + neu.yaw_deg).toFixed(1)) }
        }
        await api.updateSkillConfig('ENV', cur)
        setEnv(cur)
      }
      const next = { ...cfg, origin: neu }
      await api.updateSkillConfig('MAP', next as unknown as Record<string, unknown>)
      setCfg(next)
      setUndo({ origin: old, env: before ? JSON.parse(JSON.stringify(before)) : null })
      setStatus(`axes moved to (${neu.x}, ${neu.y}) ${neu.yaw_deg}°` + (placesFollow ? ` · ${placesWithLoc} places moved with them` : ' · places unchanged'))
    } catch (e) { setStatus(`error: ${(e as Error).message}`) }
    setEditOrigin(false); setDraft(null); setAskApply(false); setPreviewShift(false)
  }

  const undoOrigin = async () => {
    if (!cfg || !undo) return
    try {
      if (undo.env) { await api.updateSkillConfig('ENV', undo.env); setEnv(undo.env) }
      const next = { ...cfg, origin: undo.origin }
      await api.updateSkillConfig('MAP', next as unknown as Record<string, unknown>)
      setCfg(next); setStatus('undone: axes' + (undo.env ? ' and places' : '') + ' are back as before')
    } catch (e) { setStatus(`error: ${(e as Error).message}`) }
    setUndo(null)
  }

  // ── pointer → world ─────────────────────────────────────────────────────────
  const toWorld = (e: React.MouseEvent): [number, number] | null => {
    const svg = svgRef.current
    if (!svg || !view) return null
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const m = svg.getScreenCTM(); if (!m) return null
    const p = pt.matrixTransform(m.inverse())          // svg units = metres from the frame's top-left
    return [view.origin[0] + p.x, view.origin[1] + view.height * view.resolution - p.y]
  }

  if (cfgError) return (
    <div className="text-sm text-gray-500 p-6 border border-dashed border-gray-300 rounded-lg">
      {cfgError} Save one from a SLAM map connection, or add a <code>MAP</code> group to the site&apos;s skill configs (see robotapp CLAUDE.md, &ldquo;Map tab&rdquo;).
      <button className="ml-3 text-blue-600 hover:underline" onClick={reload}>reload</button>
      <div className="mt-3"><MapUpdater clients={clients} onSaved={reload} /></div>
    </div>
  )
  if (!cfg || !view) return <div className="text-sm text-gray-400 p-6">loading map…</div>

  const Wm = view.width * view.resolution, Hm = view.height * view.resolution
  const S = (x: number, y: number): [number, number] => [x - view.origin[0], view.origin[1] + Hm - y]   // world -> svg
  const placeImg = (r: Raster | null, opacity: number, href?: string) => {
    if (!r) return null
    const [x0, y0] = S(r.frame.origin[0], r.frame.origin[1] + r.frame.height * r.frame.resolution)
    return <image href={href ?? r.url} x={x0} y={y0} width={r.frame.width * r.frame.resolution} height={r.frame.height * r.frame.resolution}
                  opacity={opacity} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />
  }
  const hv = hover ? probe(hover.x, hover.y) : null
  const robotR = 0.28
  const O = draft ?? cfg.origin ?? ZERO                  // the origin shown (the draft while editing)
  const oa = O.yaw_deg * DEG
  const hu = hover ? toUser(O, hover.x, hover.y) : null
  const pu = pose ? toUser(O, pose.x, pose.y) : null
  const prz = pose ? wrapDeg(pose.yaw / DEG - O.yaw_deg) : 0
  // 1 m grid of the origin frame over the whole view
  const gridLines = (() => {
    if (!showGrid) return []
    const corners = [[0, 0], [Wm, 0], [0, Hm], [Wm, Hm]].map(([sx, sy]) => toUser(O, view.origin[0] + sx, view.origin[1] + Hm - sy))
    const us = corners.map(c => c[0]), vs = corners.map(c => c[1])
    const [u0, u1, v0, v1] = [Math.floor(Math.min(...us)), Math.ceil(Math.max(...us)), Math.floor(Math.min(...vs)), Math.ceil(Math.max(...vs))]
    const L: { a: [number, number]; b: [number, number]; k: number; axis: 'u' | 'v' }[] = []
    for (let k = u0; k <= u1; k++) L.push({ a: toMap(O, k, v0), b: toMap(O, k, v1), k, axis: 'u' })
    for (let k = v0; k <= v1; k++) L.push({ a: toMap(O, u0, k), b: toMap(O, u1, k), k, axis: 'v' })
    return L
  })()
  const near = (p: [number, number], q: [number, number], r: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= r
  const xTip = toMap(O, 0.6, 0)

  return (
    <div className="flex flex-col gap-2">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span className="font-semibold text-gray-800">Map</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showSurfaces} onChange={e => setShowSurfaces(e.target.checked)} />surfaces</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showBlocked} onChange={e => setShowBlocked(e.target.checked)} />blocked areas</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showAxes} onChange={e => setShowAxes(e.target.checked)} />axes</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />grid</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={autoLift} onChange={e => setAutoLift(e.target.checked)} />auto lift</label>
        <label className="flex items-center gap-1">height
          <input className="w-16 border border-gray-300 rounded px-1 py-0.5" placeholder="auto" value={manualH} onChange={e => setManualH(e.target.value)} />m
        </label>
        <button className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40" disabled={!pose || busy} onClick={savePlace}>Save as place</button>
        <button className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700" onClick={() => { api.cancelRun(); setStatus('stop sent') }}>Stop</button>
        <button className="text-blue-600 hover:underline" onClick={() => { setTrail([]); reload() }}>reload</button>
        <button className={`px-2 py-1 rounded border hover:bg-gray-50 ${showSettings ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
                onClick={() => setShowSettings(v => !v)} title="The MAP config: robot pose, what a click / ← → / auto lift run">⚙ Settings</button>
        <MapUpdater clients={clients} current={cfg.source?.connection} onSaved={reload} />
        {cfg.source?.connection && (!keepEdit
          ? <button className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50" onClick={startKeep}
                    title="Draw the area to keep (the house): outside it is blocked and cut off the picture — lidar noise outside goes away. Applied again by every Update map.">
              ✂ Keep area{cfg.source.keep ? ' ✓' : ''}</button>
          : <span className="inline-flex items-center gap-1 bg-yellow-50 border border-yellow-300 rounded px-2 py-0.5">
              {keepEdit.pts.length} corners
              <button className="px-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40" disabled={!keepEdit.pts.length}
                      onClick={() => setKeepEdit({ ...keepEdit, pts: keepEdit.pts.slice(0, -1) })}>undo</button>
              <button className="px-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40" disabled={!keepEdit.pts.length}
                      onClick={() => setKeepEdit({ ...keepEdit, pts: [] })}>clear</button>
              <button className="px-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40" disabled={keepEdit.pts.length < 3}
                      onClick={() => applyKeep(keepEdit.pts)} title="Save the map cropped to this area (the old one goes to map/history/)">Apply</button>
              {cfg.source.keep && <button className="px-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50" onClick={() => applyKeep([])}
                                          title="Save the whole map again, no keep area">whole map</button>}
              <button className="px-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50" onClick={() => { setKeepEdit(null); setStatus('') }}>Cancel</button>
            </span>)}
        {!editOrigin
          ? <button className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50" onClick={startEdit} title="Move / rotate the origin of the coordinates shown on this map">✥ Edit origin</button>
          : draft && (
            <span className="inline-flex items-center gap-1 bg-yellow-50 border border-yellow-300 rounded px-2 py-0.5">
              origin x<input className="w-14 border border-gray-300 rounded px-1" value={draft.x.toFixed(2)} onChange={e => Number.isFinite(Number(e.target.value)) && setDraft({ ...draft, x: Number(e.target.value) })} />
              y<input className="w-14 border border-gray-300 rounded px-1" value={draft.y.toFixed(2)} onChange={e => Number.isFinite(Number(e.target.value)) && setDraft({ ...draft, y: Number(e.target.value) })} />
              yaw<input className="w-12 border border-gray-300 rounded px-1" value={draft.yaw_deg.toFixed(1)} onChange={e => Number.isFinite(Number(e.target.value)) && setDraft({ ...draft, yaw_deg: Number(e.target.value) })} />°
              <button className="px-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50" onClick={() => setDraft({ ...ZERO })} title="the robot map's own origin">map origin</button>
              <button className="px-1.5 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={() => setAskApply(true)}>Apply…</button>
              <button className="px-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50" onClick={cancelEdit}>Cancel</button>
            </span>)}
        <span className="ml-auto text-gray-500">click: go (keeps heading) · ← →: rotate {cfg.rotate?.step_deg ?? 15}° · dots: saved places</span>
      </div>

      {showSettings && <MapSettings cfg={cfg} onSaved={reload} onClose={() => setShowSettings(false)} />}

      {sim.bar}

      {/* map */}
      <div ref={wrapRef} tabIndex={0} onKeyDown={onKey}
           className="relative w-full rounded-lg overflow-hidden border border-gray-200 bg-gray-100 outline-none focus:ring-2 focus:ring-blue-300"
           style={{ aspectRatio: `${view.width} / ${view.height}` }}>
        <svg ref={svgRef} viewBox={`0 0 ${Wm} ${Hm}`} className="absolute inset-0 w-full h-full"
             style={{ cursor: keepEdit ? 'copy' : sim.editing ? (sim.dragging ? 'grabbing' : sim.adding ? 'copy' : 'default') : editOrigin ? (drag ? 'grabbing' : 'grab') : hv?.blocked ? 'not-allowed' : busy ? 'progress' : 'crosshair' }}
             onMouseDown={e => {
               const w = toWorld(e); if (!w) return
               if (sim.down(w)) { e.preventDefault(); return }    // no native image drag stealing the mouse
               if (!editOrigin || !draft) return
               if (near(w, xTip, 0.2)) { e.preventDefault(); setDrag('rotate') }
               else if (near(w, [draft.x, draft.y], 0.3)) { e.preventDefault(); setDrag('move') }
             }}
             onMouseUp={() => { sim.up(); setDrag(null) }}
             onMouseMove={e => { const w = toWorld(e); const r = wrapRef.current?.getBoundingClientRect()
                                 if (w && r) setHover({ x: w[0], y: w[1], sx: e.clientX - r.left, sy: e.clientY - r.top })
                                 if (w) sim.move(w)
                                 if (w && draft && drag === 'move') setDraft({ ...draft, x: w[0], y: w[1] })
                                 if (w && draft && drag === 'rotate') setDraft({ ...draft, yaw_deg: Math.atan2(w[1] - draft.y, w[0] - draft.x) / DEG }) }}
             onMouseLeave={() => { setHover(null); setDrag(null) }}
             onClick={e => { wrapRef.current?.focus(); const w = toWorld(e)
                             if (keepEdit) { if (w) setKeepEdit({ ...keepEdit, pts: [...keepEdit.pts, w] }); return }
                             if (w && sim.click(w)) return; if (editOrigin) return; if (w) goTo(w[0], w[1]) }}>
          {keepEdit
            ? <image href={keepEdit.img} x={0} y={0} width={Wm} height={Hm} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />
            : frameSrc
            ? <image href={frameSrc} x={0} y={0} width={Wm} height={Hm} preserveAspectRatio="none" />
            : bg ? placeImg(bg, 1) : placeImg(occ, 0.6)}
          {!keepEdit && showBlocked && occ?.tintUrl && placeImg(occ, 1, occ.tintUrl)}
          {gridLines.map(({ a, b, k, axis }) => {
            const [x1, y1] = S(...a), [x2, y2] = S(...b)
            return <line key={`${axis}${k}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={k === 0 ? 'rgba(60,60,60,0.45)' : 'rgba(60,60,60,0.16)'} strokeWidth={k === 0 ? 0.015 : 0.01} pointerEvents="none" />
          })}
          {showGrid && gridLines.filter(l => l.k !== 0).map(({ k, axis }) => {     // tick numbers along the axes
            const [tx, ty] = S(...(axis === 'u' ? toMap(O, k, -0.12) : toMap(O, 0.08, k)))
            return <text key={`t${axis}${k}`} x={tx} y={ty} fontSize={0.12} fill="rgba(60,60,60,0.75)" textAnchor={axis === 'u' ? 'middle' : 'start'} pointerEvents="none">{k}</text>
          })}
          {showSurfaces && (cfg.surfaces ?? []).map(s => {
            const pts = surfaceCorners(s).map(([x, y]) => S(x, y).join(',')).join(' ')
            const [lx, ly] = S(s.centre[0], s.centre[1])
            return (
              <g key={s.name} pointerEvents="none">
                <polygon points={pts} fill="rgba(42,120,214,0.12)" stroke="rgb(42,120,214)" strokeWidth={0.02} />
                <text x={lx} y={ly} fontSize={0.14} textAnchor="middle" fill="rgb(28,92,171)">{s.height.toFixed(2)} m</text>
              </g>)
          })}
          {trail.length > 1 && <polyline points={trail.map(([x, y]) => S(x, y).join(',')).join(' ')} fill="none" stroke="rgb(235,104,52)" strokeWidth={0.04} opacity={0.7} pointerEvents="none" />}
          {cfg.places === 'ENV' && Object.entries(env).map(([name, e]) => {
            if (!e.loc) return null
            const [px, py] = S(e.loc.x, e.loc.y), a = e.loc.rz * DEG
            return (
              <g key={name} style={{ cursor: 'pointer' }} pointerEvents={keepEdit ? 'none' : undefined} onClick={ev => { ev.stopPropagation(); goPlace(name) }}>
                <line x1={px} y1={py} x2={px + 0.22 * Math.cos(a)} y2={py - 0.22 * Math.sin(a)} stroke="rgb(27,175,122)" strokeWidth={0.03} />
                <circle cx={px} cy={py} r={0.08} fill="rgb(27,175,122)" stroke="white" strokeWidth={0.02}><title>{`move::${name}  (height ${e.height ?? '?'} m)`}</title></circle>
              </g>)
          })}
          {goal && (() => { const [gx, gy] = S(goal[0], goal[1]); return <circle cx={gx} cy={gy} r={0.12} fill="none" stroke="rgb(235,104,52)" strokeWidth={0.03} strokeDasharray="0.06 0.04" pointerEvents="none" /> })()}
          {pose && (() => {
            const [rx, ry] = S(pose.x, pose.y)
            return (
              <g pointerEvents="none">
                <circle cx={rx} cy={ry} r={robotR} fill="rgba(42,120,214,0.25)" stroke="rgb(42,120,214)" strokeWidth={0.03} />
                <line x1={rx} y1={ry} x2={rx + 0.45 * Math.cos(pose.yaw)} y2={ry - 0.45 * Math.sin(pose.yaw)} stroke="rgb(28,92,171)" strokeWidth={0.05} strokeLinecap="round" />
              </g>)
          })()}
          {pose && showAxes && Math.abs(prz) > 1 && (() => {      // heading arc: origin x axis -> robot heading
            const [rx, ry] = S(pose.x, pose.y), R = 0.42, a0 = oa, a1 = oa + prz * DEG
            const p0 = [rx + R * Math.cos(a0), ry - R * Math.sin(a0)], p1 = [rx + R * Math.cos(a1), ry - R * Math.sin(a1)]
            const am = (a0 + a1) / 2
            return (
              <g pointerEvents="none">
                <line x1={rx} y1={ry} x2={p0[0]} y2={p0[1]} stroke="rgba(220,38,38,0.6)" strokeWidth={0.015} strokeDasharray="0.04 0.03" />
                <path d={`M ${p0[0]} ${p0[1]} A ${R} ${R} 0 ${Math.abs(prz) > 180 ? 1 : 0} ${prz > 0 ? 0 : 1} ${p1[0]} ${p1[1]}`} fill="none" stroke="rgb(28,92,171)" strokeWidth={0.02} />
                <text x={rx + (R + 0.14) * Math.cos(am)} y={ry - (R + 0.14) * Math.sin(am)} fontSize={0.13} textAnchor="middle" fill="rgb(28,92,171)">{prz.toFixed(0)}°</text>
              </g>)
          })()}
          {sim.overlay(S)}
          {keepEdit && (() => {                                     // the keep area being drawn
            const pts = keepEdit.pts.map(([x, y]) => S(x, y))
            const tail = hover && pts.length ? [...pts, S(hover.x, hover.y)] : pts
            return (
              <g pointerEvents="none">
                {tail.length > 1 && <polygon points={tail.map(p => p.join(',')).join(' ')} fill="rgba(42,120,214,0.12)" stroke="rgb(42,120,214)" strokeWidth={0.05} strokeDasharray="0.15 0.08" />}
                {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 0 ? 0.14 : 0.09} fill={i === 0 ? 'rgb(250,204,21)' : 'rgb(42,120,214)'} stroke="white" strokeWidth={0.03} />)}
              </g>)
          })()}
          {askApply && previewShift && draft && shiftedPlaces(cfg.origin ?? ZERO, draft).map(p => {   // where places would go
            const [ax, ay] = S(...p.from), [bx, by] = S(...p.to)
            return (
              <g key={`ghost-${p.name}`} pointerEvents="none">
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke="rgb(234,88,12)" strokeWidth={0.02} strokeDasharray="0.06 0.04" />
                <circle cx={bx} cy={by} r={0.1} fill="rgba(234,88,12,0.55)" stroke="white" strokeWidth={0.02} />
              </g>)
          })}
          {showAxes && (() => {                                     // the origin and its axes
            const [ox, oy] = S(O.x, O.y), [xx, xy] = S(...toMap(O, 0.6, 0)), [yx, yy] = S(...toMap(O, 0, 0.6))
            const head = (tx: number, ty: number, ang: number, c: string) => {
              const l = 0.12, w = 0.06
              const bx = tx - l * Math.cos(ang), by = ty + l * Math.sin(ang)
              return <polygon points={`${tx},${ty} ${bx - w * Math.sin(ang)},${by - w * Math.cos(ang)} ${bx + w * Math.sin(ang)},${by + w * Math.cos(ang)}`} fill={c} />
            }
            return (
              <g pointerEvents="none">
                <line x1={ox} y1={oy} x2={xx} y2={xy} stroke="rgb(220,38,38)" strokeWidth={0.04} />{head(xx, xy, oa, 'rgb(220,38,38)')}
                <line x1={ox} y1={oy} x2={yx} y2={yy} stroke="rgb(22,163,74)" strokeWidth={0.04} />{head(yx, yy, oa + Math.PI / 2, 'rgb(22,163,74)')}
                <circle cx={ox} cy={oy} r={editOrigin ? 0.1 : 0.06} fill={editOrigin ? 'rgb(250,204,21)' : 'white'} stroke="rgb(30,30,30)" strokeWidth={0.02} />
                {editOrigin && <circle cx={xx} cy={xy} r={0.09} fill="none" stroke="rgb(220,38,38)" strokeWidth={0.025} strokeDasharray="0.04 0.03" />}
                <text x={xx + 0.08 * Math.cos(oa)} y={xy - 0.08 * Math.sin(oa) + 0.05} fontSize={0.15} fontWeight="bold" fill="rgb(220,38,38)">x</text>
                <text x={yx - 0.08 * Math.sin(oa) - 0.04} y={yy - 0.08 * Math.cos(oa)} fontSize={0.15} fontWeight="bold" fill="rgb(22,163,74)">y</text>
                <text x={ox + 0.1} y={oy + 0.2} fontSize={0.12} fill="rgb(30,30,30)">origin{editOrigin ? ` (${O.x.toFixed(2)}, ${O.y.toFixed(2)}) ${O.yaw_deg.toFixed(1)}°` : ''}</text>
              </g>)
          })()}
          <g pointerEvents="none">                                   {/* scale bar */}
            <rect x={0.25} y={Hm - 0.42} width={1.2} height={0.3} fill="rgba(255,255,255,0.75)" rx={0.04} />
            <line x1={0.35} y1={Hm - 0.2} x2={1.35} y2={Hm - 0.2} stroke="rgb(30,30,30)" strokeWidth={0.03} />
            <line x1={0.35} y1={Hm - 0.25} x2={0.35} y2={Hm - 0.15} stroke="rgb(30,30,30)" strokeWidth={0.02} />
            <line x1={1.35} y1={Hm - 0.25} x2={1.35} y2={Hm - 0.15} stroke="rgb(30,30,30)" strokeWidth={0.02} />
            <text x={0.85} y={Hm - 0.25} fontSize={0.12} textAnchor="middle" fill="rgb(30,30,30)">1 m</text>
          </g>
          {hover && (() => { const [hx, hy] = S(hover.x, hover.y); return <circle cx={hx} cy={hy} r={robotR} fill="none" stroke={hv?.blocked ? 'rgb(220,38,38)' : 'rgb(22,163,74)'} strokeWidth={0.025} pointerEvents="none" /> })()}
        </svg>

        {/* tooltip */}
        {hover && hv && (
          <div className="absolute pointer-events-none text-[11px] font-mono bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 shadow-sm"
               style={{ left: Math.min(hover.sx + 14, (wrapRef.current?.clientWidth ?? 600) - 230), top: hover.sy + 14 }}>
            <div>x {hu![0].toFixed(2)}  y {hu![1].toFixed(2)}  z {hv.z == null ? '?' : hv.z.toFixed(hv.surface ? 3 : 2)}{hv.zIsTop ? ' (top of obstacle)' : ''}</div>
            {hv.surface && <div className="text-blue-700">{hv.surface.name}</div>}
            {pose && <div className="text-gray-500">{Math.hypot(hover.x - pose.x, hover.y - pose.y).toFixed(2)} m from the robot</div>}
            <div className={hv.blocked ? 'text-red-600' : 'text-green-700'}>{hv.blocked ? 'blocked for the base' : 'reachable'}</div>
          </div>
        )}
      </div>

      {askApply && draft && (() => {
        const moves = shiftedPlaces(cfg.origin ?? ZERO, draft).sort((a, b) => b.d - a.d)
        const far = moves[0]
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setAskApply(false)}>
          <div className="bg-white rounded-lg shadow-xl p-5 max-w-md text-sm text-gray-700" onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-gray-900 mb-1">Move the axes here?</div>
            <p className="mb-3 text-gray-600">
              The axes go to ({draft.x.toFixed(2)}, {draft.y.toFixed(2)}), turned {wrapDeg(draft.yaw_deg).toFixed(0)}°.
              What should happen to your {placesWithLoc} saved places?
            </p>
            <div className="flex flex-col gap-2">
              <button className="text-left px-3 py-2 rounded border-2 border-blue-500 bg-blue-50 hover:bg-blue-100" onClick={() => applyOrigin(false)}>
                <b>Leave places where they are</b> <span className="text-xs font-medium text-blue-700">· recommended</span><br />
                <span className="text-xs text-gray-600">Every place stays at the same spot in the house, so the robot still goes to the same
                  places. Only the coordinates shown on this map change.</span>
              </button>
              <button className="text-left px-3 py-2 rounded border border-orange-300 hover:bg-orange-50"
                      onMouseEnter={() => setPreviewShift(true)} onMouseLeave={() => setPreviewShift(false)} onClick={() => applyOrigin(true)}>
                <b className="text-orange-700">Move places together with the axes</b><br />
                <span className="text-xs text-gray-600">Every place is shifted and turned like the axes
                  {far && far.d > 0.01 ? <> — <b>{far.name}</b> would move {far.d.toFixed(1)} m</> : null}.
                  Only use this if the map itself has moved (for example the robot re-mapped the house and
                  everything is offset). Hover to see where they would go.</span>
              </button>
              <button className="px-3 py-1.5 rounded text-gray-500 hover:bg-gray-100" onClick={() => { setAskApply(false); setPreviewShift(false) }}>Cancel</button>
            </div>
            <p className="mt-3 text-xs text-gray-400">The robot always navigates in its own map; the furniture outlines stay attached to the map. You can undo right after.</p>
          </div>
        </div>)
      })()}

      {/* status */}
      <div className="flex items-center gap-4 text-xs font-mono text-gray-600">
        <span>robot {pose && pu ? `x ${pu[0].toFixed(2)}  y ${pu[1].toFixed(2)}  rz ${prz.toFixed(1)}°` : '—'}{cfg.origin && (cfg.origin.x || cfg.origin.y || cfg.origin.yaw_deg) ? ' (origin frame)' : ''}</span>
        {undo && <button className="px-2 py-0.5 rounded border border-gray-300 font-sans hover:bg-gray-50" onClick={undoOrigin}>↶ Undo origin change</button>}
        <span className={status.startsWith('error') || status.includes('failed') || status.includes('blocked') || status.includes('short') ? 'text-red-600' : 'text-gray-800'}>{status}</span>
      </div>
    </div>
  )
}
