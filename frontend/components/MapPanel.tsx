'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ClientEntry, MapConfig, MapFrame, MapLayer, MapSkillCall, MapSurface } from '../lib/types'

// Map tab: the site's map with the robot on it. Everything comes from the active site's `MAP`
// skill-config group (see MapConfig in lib/types.ts), so the panel works for any robot that has one.
//   • click a free spot  → goal skill (e.g. moveb::x=..,y=..) keeping the current heading
//   • ← / →              → rotate skill, ±step_deg (turns are batched while one is running)
//   • click a place dot  → move::<ENV name>   (kcare lifts to the place's height itself)
//   • after a goal       → lift to the nearest surface within reach (+ clearance), or the typed height
//   • hover              → x, y, z under the cursor; red = blocked for the base
//   • "Save as place"    → current pose + height as a new ENV entry

type Pose = { x: number; y: number; yaw: number }          // yaw [rad], map frame
type Raster = { frame: MapFrame; data: Uint8ClampedArray; url: string; tintUrl?: string }
type EnvEntry = { loc?: { x: number; y: number; rz: number }; height?: number; default_mode?: string } & Record<string, unknown>

const DEG = Math.PI / 180

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

function quatYaw(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
}

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
      setMsg(`saved ${r.size_m[0]}×${r.size_m[1]} m` + (r.missing.length ? ` · view only until MAP has ${r.missing.join(' / ')}` : ''))
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

  // the display frame: the camera picture's, else the occupancy layer's
  const view: MapFrame | null = cfg?.image?.frame ?? occ?.frame ?? null
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
        const v = await api.agentGet(p.agent)
        const x = Number(getPath(v, p.x)), y = Number(getPath(v, p.y))
        let yaw = 0
        if (p.orientation) yaw = quatYaw(getPath(v, p.orientation) as { x: number; y: number; z: number; w: number })
        else if (p.yaw) yaw = Number(getPath(v, p.yaw)) * (p.angle === 'deg' ? DEG : 1)
        if (!stop && Number.isFinite(x) && Number.isFinite(y)) {
          setPose({ x, y, yaw })
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
      if (Math.hypot(px - x, py - y) > 0.3) {          // kcare reports done even when navigation gave up
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

  return (
    <div className="flex flex-col gap-2">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span className="font-semibold text-gray-800">Map</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showSurfaces} onChange={e => setShowSurfaces(e.target.checked)} />surfaces</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showBlocked} onChange={e => setShowBlocked(e.target.checked)} />blocked areas</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={autoLift} onChange={e => setAutoLift(e.target.checked)} />auto lift</label>
        <label className="flex items-center gap-1">height
          <input className="w-16 border border-gray-300 rounded px-1 py-0.5" placeholder="auto" value={manualH} onChange={e => setManualH(e.target.value)} />m
        </label>
        <button className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40" disabled={!pose || busy} onClick={savePlace}>Save as place</button>
        <button className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700" onClick={() => { api.cancelRun(); setStatus('stop sent') }}>Stop</button>
        <button className="text-blue-600 hover:underline" onClick={() => { setTrail([]); reload() }}>reload</button>
        <MapUpdater clients={clients} current={cfg.source?.connection} onSaved={reload} />
        <span className="ml-auto text-gray-500">click: go (keeps heading) · ← →: rotate {cfg.rotate?.step_deg ?? 15}° · dots: saved places</span>
      </div>

      {/* map */}
      <div ref={wrapRef} tabIndex={0} onKeyDown={onKey}
           className="relative w-full rounded-lg overflow-hidden border border-gray-200 bg-gray-100 outline-none focus:ring-2 focus:ring-blue-300"
           style={{ aspectRatio: `${view.width} / ${view.height}` }}>
        <svg ref={svgRef} viewBox={`0 0 ${Wm} ${Hm}`} className="absolute inset-0 w-full h-full"
             style={{ cursor: hv?.blocked ? 'not-allowed' : busy ? 'progress' : 'crosshair' }}
             onMouseMove={e => { const w = toWorld(e); const r = wrapRef.current?.getBoundingClientRect()
                                 if (w && r) setHover({ x: w[0], y: w[1], sx: e.clientX - r.left, sy: e.clientY - r.top }) }}
             onMouseLeave={() => setHover(null)}
             onClick={e => { wrapRef.current?.focus(); const w = toWorld(e); if (w) goTo(w[0], w[1]) }}>
          {frameSrc
            ? <image href={frameSrc} x={0} y={0} width={Wm} height={Hm} preserveAspectRatio="none" />
            : bg ? placeImg(bg, 1) : placeImg(occ, 0.6)}
          {showBlocked && occ?.tintUrl && placeImg(occ, 1, occ.tintUrl)}
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
              <g key={name} style={{ cursor: 'pointer' }} onClick={ev => { ev.stopPropagation(); goPlace(name) }}>
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
          {hover && (() => { const [hx, hy] = S(hover.x, hover.y); return <circle cx={hx} cy={hy} r={robotR} fill="none" stroke={hv?.blocked ? 'rgb(220,38,38)' : 'rgb(22,163,74)'} strokeWidth={0.025} pointerEvents="none" /> })()}
        </svg>

        {/* tooltip */}
        {hover && hv && (
          <div className="absolute pointer-events-none text-[11px] font-mono bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 shadow-sm"
               style={{ left: Math.min(hover.sx + 14, (wrapRef.current?.clientWidth ?? 600) - 230), top: hover.sy + 14 }}>
            <div>x {hover.x.toFixed(2)}  y {hover.y.toFixed(2)}  z {hv.z == null ? '?' : hv.z.toFixed(hv.surface ? 3 : 2)}{hv.zIsTop ? ' (top of obstacle)' : ''}</div>
            {hv.surface && <div className="text-blue-700">{hv.surface.name}</div>}
            {pose && <div className="text-gray-500">{Math.hypot(hover.x - pose.x, hover.y - pose.y).toFixed(2)} m from the robot</div>}
            <div className={hv.blocked ? 'text-red-600' : 'text-green-700'}>{hv.blocked ? 'blocked for the base' : 'reachable'}</div>
          </div>
        )}
      </div>

      {/* status */}
      <div className="flex items-center gap-4 text-xs font-mono text-gray-600">
        <span>robot {pose ? `x ${pose.x.toFixed(2)}  y ${pose.y.toFixed(2)}  rz ${(pose.yaw / DEG).toFixed(1)}°` : '—'}</span>
        <span className={status.startsWith('error') || status.includes('failed') || status.includes('blocked') || status.includes('short') ? 'text-red-600' : 'text-gray-800'}>{status}</span>
      </div>
    </div>
  )
}
