'use client'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cameraOptions, pickCamera, rememberChoice, tileMessage, tileState, type CamOption } from '../lib/fleetCams'
import type { FleetRobot } from '../lib/fleet_types'

// One tile of the Fleet tab's camera grid: the robot's own camera list (from ITS url, not the tab's active robot) and at
// most one camera stream. Reading cameras and streaming never start a run (rule 6). Nothing spins for ever: a read or a
// stream that gives nothing within the timeout says so.
const READ_MS = 5000
const FRAME_MS = 8000

export default function FleetCamTile({ robot, saved, badge, info }: { robot: FleetRobot; saved?: string; badge: React.ReactNode; info?: React.ReactNode }) {
  const [opts, setOpts] = useState<CamOption[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [cam, setCam] = useState<string | null>(null)
  const [src, setSrc] = useState('')
  const [streamErr, setStreamErr] = useState('')

  useEffect(() => {                                       // the robot's camera list
    const ac = new AbortController()
    let live = true                                       // false once this effect is cleaned up: its answer, or its abort, is not news
    const timer = setTimeout(() => ac.abort(), READ_MS)   // the timeout is an abort too, and it IS a failure (live stays true)
    setOpts(null); setFailed(false)
    api.listClientsAt(robot.url, ac.signal)
      .then(cs => { if (!live) return; const o = cameraOptions(cs); setOpts(o); setCam(pickCamera(o, saved)) })
      .catch(() => { if (live) setFailed(true) })
      .finally(() => clearTimeout(timer))
    return () => { live = false; clearTimeout(timer); ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot.url])

  useEffect(() => {                                       // one stream per robot: closed when the camera or the tile changes
    if (!cam) return
    let closed = false
    setSrc(''); setStreamErr('')
    const ws = api.cameraWsAt(robot.url, cam)
    const stall = setTimeout(() => { if (!closed) setStreamErr('No image from this camera.') }, FRAME_MS)
    ws.onopen = () => ws.send(JSON.stringify({ depth_mode: 'colored' }))
    ws.onmessage = e => {
      try {
        const d = JSON.parse(e.data)
        if (d.error) { setStreamErr(String(d.error)); return }
        const img = d.rgb ?? d.depth
        if (img) { clearTimeout(stall); setStreamErr(''); setSrc(`data:image/jpeg;base64,${img}`) }
      } catch { /* malformed frame */ }
    }
    ws.onerror = () => { if (!closed) setStreamErr('Camera connection error.') }
    return () => { closed = true; clearTimeout(stall); ws.onopen = ws.onmessage = ws.onerror = null; ws.close() }
  }, [robot.url, cam])

  const state = tileState(opts, failed)
  return (
    <div data-testid="fleet-cam-tile" className="flex flex-col gap-1 border border-gray-200 rounded p-1.5 bg-white">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{robot.id}</span>{badge}
        {state === 'ready' && opts && (
          <select value={cam ?? ''} aria-label={`camera of ${robot.id}`} className="ml-auto px-1 py-0.5 rounded border border-gray-300 bg-white"
            onChange={e => { setCam(e.target.value); rememberChoice(robot.id, e.target.value) }}>
            {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
      </div>
      <div className="aspect-video bg-gray-100 rounded flex items-center justify-center text-gray-500 overflow-hidden">
        {state !== 'ready' ? <span className={state === 'unreachable' ? 'text-red-700' : ''}>{tileMessage(state, robot.url)}</span>
          : src ? <img src={src} alt={`${robot.id} camera`} className="w-full h-full object-contain" />
          : <span className={streamErr ? 'text-amber-700' : ''}>{streamErr || 'Waiting for the first image...'}</span>}
      </div>
      {state === 'ready' && src && streamErr && <div className="text-amber-700">{streamErr}</div>}
      {info}
    </div>
  )
}
