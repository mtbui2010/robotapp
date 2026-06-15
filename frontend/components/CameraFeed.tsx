'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import type { ClientEntry } from '../lib/types'
import CameraCell from './CameraCell'

type Channel = 'rgb' | 'depth'
type DepthMode = 'colored' | 'raw'
type Layout = 'tab' | 'grid'

const LOG_TAB = '__log_image__'
const OBSERVE_TAB = '__observe__'
const TAB_ORDER_KEY = 'cameraTabOrder'
const WEBCAM_DEVICE_KEY = 'robotapp_webcam_device'

interface RawDepth {
  data: Uint16Array
  w: number
  h: number
}

interface DepthMeta {
  dmin: number
  dmax: number
  mode: DepthMode
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

// ── Decompress zlib base64 → Uint16Array (little-endian) ────────────────────
async function decompressDepth(b64: string): Promise<Uint8Array> {
  const compressed = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const stream = new Blob([compressed as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

// Simple JET-like colormap, t in [0,1] → [r,g,b]
function jet(t: number): [number, number, number] {
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)))
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)))
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)))
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

export default function CameraFeed({ clients, logImage, onClearLog }: { clients: ClientEntry[]; logImage?: string | null; onClearLog?: () => void }) {
  const cameras = clients.filter(c => c.is_camera)
  const [selectedId, setSelectedId] = useState<string>('')

  // ── Tab ordering (drag-and-drop, persisted to localStorage) ───────────────
  const [tabOrder, setTabOrder]     = useState<string[]>([])
  const [dragId, setDragId]         = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const tabOrderLoaded = useRef(false)

  // Load persisted order once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TAB_ORDER_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setTabOrder(parsed.filter((v): v is string => typeof v === 'string'))
        }
      }
    } catch { /* ignore */ }
    tabOrderLoaded.current = true
  }, [])

  // Persist on change (skip until load completes so we don't clobber stored value with [])
  useEffect(() => {
    if (!tabOrderLoaded.current) return
    try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(tabOrder)) } catch { /* ignore */ }
  }, [tabOrder])

  // Apply order; unknown cameras (not yet in tabOrder) append at end in source order
  const orderedCameras = useMemo(() => {
    const byId = new Map(cameras.map(c => [c.id, c]))
    const seen = new Set<string>()
    const out: ClientEntry[] = []
    for (const id of tabOrder) {
      const c = byId.get(id)
      if (c) { out.push(c); seen.add(id) }
    }
    for (const c of cameras) if (!seen.has(c.id)) out.push(c)
    return out
  }, [cameras, tabOrder])
  const isLogTab = selectedId === LOG_TAB

  // ── Layout (tab | grid) ───────────────────────────────────────────────────
  const [layout, setLayout] = useState<Layout>('tab')

  // ── Observe tab (operator's local webcam, live only) ──────────────────────
  const [observeOn, setObserveOn] = useState(false)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const observeVideoRef = useRef<HTMLVideoElement | null>(null)
  const gridObserveVideoRef = useRef<HTMLVideoElement | null>(null)

  // Webcam device selection (multiple cameras → operator picks which feeds observe)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [webcamDeviceId, setWebcamDeviceId] = useState<string>('')
  const webcamDeviceIdRef = useRef<string>('')   // mirror for use inside callbacks
  useEffect(() => { webcamDeviceIdRef.current = webcamDeviceId }, [webcamDeviceId])

  // Load persisted device choice once.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WEBCAM_DEVICE_KEY)
      if (saved) setWebcamDeviceId(saved)
    } catch { /* ignore */ }
  }, [])

  // Refresh the list of video input devices. Labels are only populated after a
  // getUserMedia permission grant, so this is most useful post-enable.
  const refreshVideoDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'))
    } catch { /* ignore */ }
  }, [])

  // ── Grid selection: which tabs are shown together in grid mode ────────────
  const [gridIds, setGridIds] = useState<string[]>([])
  const gridInit = useRef(false)

  const [channel, setChannel]       = useState<Channel>('rgb')
  const [live, setLive]             = useState(true)
  const [srcs, setSrcs]             = useState<{ rgb: string; depth: string }>({ rgb: '', depth: '' })
  const [fps, setFps]               = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const pendingSaveRef              = useRef(false)   // set on Capture; next frame is downloaded

  // ── Depth controls ────────────────────────────────────────────────────────
  const [depthMode, setDepthMode]       = useState<DepthMode>('colored')
  const [dminInput, setDminInput]       = useState('')
  const [dmaxInput, setDmaxInput]       = useState('')
  const [manualRange, setManualRange]   = useState(false)   // false = auto
  const [activeMeta, setActiveMeta]     = useState<DepthMeta | null>(null)
  const [rawDepth, setRawDepth]         = useState<RawDepth | null>(null)
  const [hoverPx, setHoverPx]           = useState<{ x: number; y: number; mm: number } | null>(null)

  const wsRef    = useRef<WebSocket | null>(null)
  const frameRef = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // ── Rectangle drawing ─────────────────────────────────────────────────────
  const [rect, setRect]           = useState<Rect | null>(null)
  const [drawMode, setDrawMode]   = useState(false)
  const [drawing, setDrawing]     = useState<Rect | null>(null)
  const [imgNat, setImgNat]       = useState<{ w: number; h: number } | null>(null)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const overlayRef   = useRef<SVGSVGElement | null>(null)

  const selected = cameras.find(c => c.id === selectedId)
  const hasLive  = selected?.type === 'webrtc' || selected?.type === 'ros_topic'

  // Auto-select: first camera if any, else log_image tab
  useEffect(() => {
    if (selectedId) return
    if (cameras.length > 0) setSelectedId(cameras[0].id)
    else setSelectedId(LOG_TAB)
  }, [cameras, selectedId])

  // Default grid selection once cameras are known: all cameras (+ log) included.
  useEffect(() => {
    if (gridInit.current) return
    if (cameras.length === 0) return
    setGridIds([...cameras.map(c => c.id), LOG_TAB])
    gridInit.current = true
  }, [cameras])

  // ── Webcam (observe) lifecycle ────────────────────────────────────────────
  // Toggled from the activation checkbox (a user gesture → permission allowed).
  const enableObserve = async () => {
    try {
      // Prefer the saved device if it's still present; otherwise let the browser pick.
      let devices: MediaDeviceInfo[] = []
      try {
        devices = (await navigator.mediaDevices.enumerateDevices())
          .filter(d => d.kind === 'videoinput')
      } catch { /* labels/ids may be empty pre-permission; that's fine */ }
      const saved = webcamDeviceIdRef.current
      const wantId = saved && devices.some(d => d.deviceId === saved) ? saved : ''

      const stream = await navigator.mediaDevices.getUserMedia({
        video: wantId ? { deviceId: { exact: wantId } } : true,
        audio: false,
      })
      webcamStreamRef.current = stream
      // Record the device actually in use (labels are now available).
      const track = stream.getVideoTracks()[0]
      const activeId = wantId || track?.getSettings().deviceId || ''
      if (activeId) setWebcamDeviceId(activeId)
      setObserveOn(true)
      // Labels are populated only after the grant — refresh the picker now.
      refreshVideoDevices()
    } catch {
      // denied / unavailable — leave it unchecked
      setObserveOn(false)
    }
  }

  const disableObserve = () => {
    webcamStreamRef.current?.getTracks().forEach(t => t.stop())
    webcamStreamRef.current = null
    setObserveOn(false)
    // If the observe tab was selected, fall back to a camera or the log tab.
    setSelectedId(prev => prev === OBSERVE_TAB ? (cameras[0]?.id ?? LOG_TAB) : prev)
  }

  // Switch the live observe stream to a different webcam (while observe is ON).
  const switchWebcam = async (deviceId: string) => {
    const prevId = webcamDeviceIdRef.current
    const prevStream = webcamStreamRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      })
      // New stream acquired — stop the old one and swap it in.
      prevStream?.getTracks().forEach(t => t.stop())
      webcamStreamRef.current = stream
      setWebcamDeviceId(deviceId)
      if (observeVideoRef.current) observeVideoRef.current.srcObject = stream
      if (gridObserveVideoRef.current) gridObserveVideoRef.current.srcObject = stream
      refreshVideoDevices()
    } catch {
      // Switch failed — keep the previous stream/selection (revert gracefully).
      setWebcamDeviceId(prevId)
    }
  }

  // Persist the chosen device id.
  useEffect(() => {
    try {
      if (webcamDeviceId) localStorage.setItem(WEBCAM_DEVICE_KEY, webcamDeviceId)
    } catch { /* ignore */ }
  }, [webcamDeviceId])

  // Keep the device list fresh when cameras are plugged/unplugged.
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md) return
    const handler = () => { refreshVideoDevices() }
    md.addEventListener?.('devicechange', handler)
    return () => md.removeEventListener?.('devicechange', handler)
  }, [refreshVideoDevices])

  // Attach the live stream to whichever <video> is currently mounted
  // (single observe view in tab mode, and/or the grid observe cell).
  useEffect(() => {
    const stream = webcamStreamRef.current
    if (observeVideoRef.current) observeVideoRef.current.srcObject = observeOn ? stream : null
    if (gridObserveVideoRef.current) gridObserveVideoRef.current.srcObject = observeOn ? stream : null
  }, [observeOn, selectedId, layout])

  // Stop tracks on unmount.
  useEffect(() => () => {
    webcamStreamRef.current?.getTracks().forEach(t => t.stop())
    webcamStreamRef.current = null
  }, [])

  // Connect / disconnect WebSocket
  useEffect(() => {
    wsRef.current?.close()
    setSrcs({ rgb: '', depth: '' })
    setRawDepth(null)
    setActiveMeta(null)
    setHoverPx(null)
    setImgNat(null)
    setChannel('rgb')   // reset; auto-switch will flip to depth if the stream is depth-only
    setFps(0)
    setError(null)
    pendingSaveRef.current = false

    // Grid mode renders its own per-cell sockets; the observe tab is a webcam.
    if (layout === 'grid') return
    if (!selectedId || isLogTab || selectedId === OBSERVE_TAB) return
    if (hasLive && !live) return

    const ws = api.cameraWs(selectedId)
    wsRef.current = ws

    let lastTs = Date.now()
    ws.onopen = () => {
      // Send current depth settings on connect
      ws.send(JSON.stringify({ depth_mode: depthMode }))
      if (manualRange) {
        const min = parseFloat(dminInput), max = parseFloat(dmaxInput)
        if (isFinite(min) && isFinite(max) && max > min) {
          ws.send(JSON.stringify({ depth_range: [min, max] }))
        }
      }
    }
    ws.onmessage = e => {
      const data = JSON.parse(e.data)
      if (data.error) {
        setError(String(data.error))
        pendingSaveRef.current = false   // capture failed — nothing to save
        return
      }
      setError(null)
      setSrcs(prev => ({
        rgb:   data.rgb   ? `data:image/jpeg;base64,${data.rgb}`   : prev.rgb,
        depth: data.depth ? `data:image/jpeg;base64,${data.depth}` : prev.depth,
      }))
      // Auto-switch channel for depth-only streams
      const hasDepthPayload = data.depth || data.depth_raw || data.depth_meta
      if (hasDepthPayload && !data.rgb) {
        setChannel(prev => prev === 'rgb' ? 'depth' : prev)
      }
      if (data.depth_meta) {
        setActiveMeta(data.depth_meta as DepthMeta)
      }
      if (data.depth_raw && typeof data.depth_w === 'number' && typeof data.depth_h === 'number') {
        decompressDepth(data.depth_raw).then(bytes => {
          // bytes is little-endian uint16
          const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
          setRawDepth({ data: u16, w: data.depth_w, h: data.depth_h })
        }).catch(err => console.error('depth_raw decompress:', err))
      }
      frameRef.current++
      const now = Date.now()
      if (now - lastTs >= 1000) {
        setFps(frameRef.current)
        frameRef.current = 0
        lastTs = now
      }
    }
    ws.onerror = ws.onclose = () => {
      setSrcs({ rgb: '', depth: '' })
      setRawDepth(null)
    }

    return () => ws.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, live, hasLive, isLogTab, layout])

  // Send mode change as a separate effect to avoid reconnect
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ depth_mode: depthMode }))
    }
  }, [depthMode])

  // Render raw depth → canvas (with current activeMeta range)
  useEffect(() => {
    if (channel !== 'depth' || depthMode !== 'raw') return
    if (!rawDepth || !canvasRef.current) return
    const { data, w, h } = rawDepth
    const canvas = canvasRef.current
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(w, h)
    const lo = activeMeta?.dmin ?? 0
    const hi = activeMeta?.dmax ?? 1
    const range = Math.max(1e-6, hi - lo)
    for (let i = 0; i < data.length; i++) {
      const v = data[i]
      const off = i * 4
      if (v === 0) {
        img.data[off]     = 0
        img.data[off + 1] = 0
        img.data[off + 2] = 0
        img.data[off + 3] = 255
      } else {
        const t = Math.max(0, Math.min(1, (v - lo) / range))
        const [r, g, b] = jet(t)
        img.data[off]     = r
        img.data[off + 1] = g
        img.data[off + 2] = b
        img.data[off + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [rawDepth, depthMode, activeMeta, channel])

  const capture = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      pendingSaveRef.current = true   // download the frame that comes back
      setError(null)
      wsRef.current.send(JSON.stringify({ capture: true }))
    } else {
      setError('Camera not connected')
    }
  }

  const applyRange = () => {
    const min = parseFloat(dminInput), max = parseFloat(dmaxInput)
    if (!(isFinite(min) && isFinite(max) && max > min)) return
    setManualRange(true)
    wsRef.current?.send(JSON.stringify({ depth_range: [min, max] }))
  }

  const autoRange = () => {
    setManualRange(false)
    setDminInput('')
    setDmaxInput('')
    wsRef.current?.send(JSON.stringify({ depth_range: null }))
  }

  const onCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rawDepth || !canvasRef.current) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) * (rawDepth.w / rect.width))
    const y = Math.floor((e.clientY - rect.top)  * (rawDepth.h / rect.height))
    if (x < 0 || x >= rawDepth.w || y < 0 || y >= rawDepth.h) return
    setHoverPx({ x, y, mm: rawDepth.data[y * rawDepth.w + x] })
  }, [rawDepth])

  const showColoredImg = !isLogTab && channel === 'depth' && depthMode === 'colored'
  const showRawCanvas  = !isLogTab && channel === 'depth' && depthMode === 'raw'
  const showRgbImg     = !isLogTab && channel === 'rgb'
  const imgSrc = showRgbImg ? srcs.rgb : showColoredImg ? srcs.depth : ''
  const haveSomething = showRawCanvas ? rawDepth !== null : Boolean(imgSrc)
  const logSrc = logImage ? `data:image/jpeg;base64,${logImage}` : ''

  const saveLog = () => {
    if (!logSrc) return
    const a = document.createElement('a')
    a.href = logSrc
    a.download = `log_image_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
    document.body.appendChild(a); a.click(); a.remove()
  }

  // After Capture, download the frame that arrives (browser download).
  // Runs after the raw-depth render effect so the canvas is painted first.
  useEffect(() => {
    if (!pendingSaveRef.current) return
    let dataUrl = ''
    let ext = 'jpg'
    if (showRgbImg && srcs.rgb) {
      dataUrl = srcs.rgb
    } else if (showColoredImg && srcs.depth) {
      dataUrl = srcs.depth
    } else if (showRawCanvas && rawDepth && canvasRef.current) {
      dataUrl = canvasRef.current.toDataURL('image/png')
      ext = 'png'
    }
    if (!dataUrl) return   // nothing rendered yet — wait for the next frame
    pendingSaveRef.current = false
    const name  = (selected?.name || selected?.id || 'camera').replace(/[^\w.-]+/g, '_')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `capture_${name}_${channel}_${stamp}.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [srcs, rawDepth, showRgbImg, showColoredImg, showRawCanvas, channel, selected])

  // Natural pixel size of whatever is currently displayed (rect coords live in this space)
  const natSize: { w: number; h: number } | null =
    showRawCanvas ? (rawDepth ? { w: rawDepth.w, h: rawDepth.h } : null) : imgNat

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth && img.naturalHeight) {
      setImgNat(prev => (prev?.w === img.naturalWidth && prev?.h === img.naturalHeight)
        ? prev
        : { w: img.naturalWidth, h: img.naturalHeight })
    }
  }

  // Convert a client-space mouse coord → image-native pixel, accounting for object-contain letterbox
  const clientToImagePx = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = overlayRef.current
    if (!el || !natSize) return null
    const r = el.getBoundingClientRect()
    const scale  = Math.min(r.width / natSize.w, r.height / natSize.h)
    const dispW  = natSize.w * scale
    const dispH  = natSize.h * scale
    const offX   = (r.width  - dispW) / 2
    const offY   = (r.height - dispH) / 2
    const x = Math.max(0, Math.min(natSize.w, (clientX - r.left - offX) / scale))
    const y = Math.max(0, Math.min(natSize.h, (clientY - r.top  - offY) / scale))
    return { x: Math.round(x), y: Math.round(y) }
  }

  const onOverlayPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode) return
    const p = clientToImagePx(e.clientX, e.clientY)
    if (!p) return
    drawStartRef.current = p
    setDrawing({ left: p.x, top: p.y, right: p.x, bottom: p.y })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onOverlayPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawStartRef.current) return
    const p = clientToImagePx(e.clientX, e.clientY)
    if (!p) return
    const s = drawStartRef.current
    setDrawing({
      left:   Math.min(s.x, p.x),
      top:    Math.min(s.y, p.y),
      right:  Math.max(s.x, p.x),
      bottom: Math.max(s.y, p.y),
    })
  }

  const onOverlayPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawStartRef.current) return
    drawStartRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* may already be released */ }
    if (drawing && drawing.right - drawing.left >= 2 && drawing.bottom - drawing.top >= 2) {
      setRect(drawing)
    }
    setDrawing(null)
    setDrawMode(false)
  }

  // ── Tab drag-and-drop handlers ────────────────────────────────────────────
  const onTabDragStart = (e: React.DragEvent<HTMLButtonElement>, id: string) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Firefox requires data to be set for drag to initiate
    e.dataTransfer.setData('text/plain', id)
  }

  const onTabDragOver = (e: React.DragEvent<HTMLButtonElement>, id: string) => {
    if (!dragId || dragId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverId !== id) setDragOverId(id)
  }

  const onTabDragLeave = (id: string) => {
    setDragOverId(prev => (prev === id ? null : prev))
  }

  const onTabDrop = (e: React.DragEvent<HTMLButtonElement>, targetId: string) => {
    e.preventDefault()
    const src = dragId
    setDragId(null)
    setDragOverId(null)
    if (!src || src === targetId) return
    const ids = orderedCameras.map(c => c.id)
    const fromIdx = ids.indexOf(src)
    const toIdx   = ids.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, src)
    setTabOrder(ids)
  }

  const onTabDragEnd = () => {
    setDragId(null)
    setDragOverId(null)
  }

  const toggleGridId = (id: string) => {
    setGridIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Tabs included in the grid, kept in the visible (ordered) tab order.
  const gridTabs = useMemo(() => {
    const order: string[] = [...orderedCameras.map(c => c.id), LOG_TAB]
    if (observeOn) order.push(OBSERVE_TAB)
    return order.filter(id => gridIds.includes(id))
  }, [orderedCameras, observeOn, gridIds])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 border-b border-gray-200">
        {/* Layout toggle (Tab | Grid) */}
        <div className="flex bg-gray-100 rounded overflow-hidden text-[11px] mr-1 self-center">
          <button
            onClick={() => setLayout('tab')}
            className={`px-2 py-0.5 ${layout === 'tab' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >Tab</button>
          <button
            onClick={() => setLayout('grid')}
            className={`px-2 py-0.5 ${layout === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >Grid</button>
        </div>

        {orderedCameras.map(c => (
          <div
            key={c.id}
            className={`flex items-center rounded-t border-b-2 transition-colors ${
              selectedId === c.id && layout === 'tab'
                ? 'border-blue-500'
                : 'border-transparent'
            } ${dragOverId === c.id ? 'bg-blue-50' : ''}`}
          >
            {layout === 'grid' && (
              <input
                type="checkbox"
                checked={gridIds.includes(c.id)}
                onChange={() => toggleGridId(c.id)}
                title="Show in grid"
                className="ml-1.5"
              />
            )}
            <button
              draggable
              onDragStart={(e) => onTabDragStart(e, c.id)}
              onDragOver={(e) => onTabDragOver(e, c.id)}
              onDragLeave={() => onTabDragLeave(c.id)}
              onDrop={(e) => onTabDrop(e, c.id)}
              onDragEnd={onTabDragEnd}
              onClick={() => setSelectedId(c.id)}
              title="Drag to reorder"
              className={`px-3 py-1 text-xs transition-colors cursor-grab active:cursor-grabbing ${
                selectedId === c.id && layout === 'tab'
                  ? 'text-blue-600 font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              } ${dragId === c.id ? 'opacity-40' : ''}`}
            >
              {c.name || c.id}
            </button>
          </div>
        ))}

        {/* log_image tab */}
        <div
          className={`flex items-center rounded-t border-b-2 transition-colors ${
            isLogTab && layout === 'tab' ? 'border-blue-500' : 'border-transparent'
          }`}
        >
          {layout === 'grid' && (
            <input
              type="checkbox"
              checked={gridIds.includes(LOG_TAB)}
              onChange={() => toggleGridId(LOG_TAB)}
              title="Show in grid"
              className="ml-1.5"
            />
          )}
          <button
            onClick={() => setSelectedId(LOG_TAB)}
            className={`px-3 py-1 text-xs transition-colors ${
              isLogTab && layout === 'tab'
                ? 'text-blue-600 font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            log_image
          </button>
        </div>

        {/* observe (webcam) tab — only present when activated */}
        {observeOn && (
          <div
            className={`flex items-center rounded-t border-b-2 transition-colors ${
              selectedId === OBSERVE_TAB && layout === 'tab' ? 'border-blue-500' : 'border-transparent'
            }`}
          >
            {layout === 'grid' && (
              <input
                type="checkbox"
                checked={gridIds.includes(OBSERVE_TAB)}
                onChange={() => toggleGridId(OBSERVE_TAB)}
                title="Show in grid"
                className="ml-1.5"
              />
            )}
            <button
              onClick={() => setSelectedId(OBSERVE_TAB)}
              className={`px-3 py-1 text-xs transition-colors ${
                selectedId === OBSERVE_TAB && layout === 'tab'
                  ? 'text-blue-600 font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              observe
            </button>
          </div>
        )}

        {/* observe activation checkbox + device picker — same row, right-aligned */}
        <div className="ml-auto mr-1 flex items-center gap-1.5 self-center">
          <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={observeOn}
              onChange={e => { if (e.target.checked) enableObserve(); else disableObserve() }}
            />
            observe (webcam)
          </label>
          {observeOn && (
            <select
              value={webcamDeviceId}
              onChange={e => switchWebcam(e.target.value)}
              title="Choose which webcam feeds the observe tab"
              className="text-[11px] text-gray-600 bg-gray-100 border border-gray-200 rounded px-1 py-0.5 max-w-[10rem]"
            >
              {/* Empty option only when no device is selected yet */}
              {!webcamDeviceId && <option value="">Default camera</option>}
              {videoDevices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Grid mode: every selected tab live simultaneously ──────────────── */}
      {layout === 'grid' ? (
        gridTabs.length === 0 ? (
          <div className="bg-gray-900 rounded-lg aspect-video flex items-center justify-center text-gray-400 text-sm">
            Select tabs (checkboxes) to show in the grid
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gridTabs.map(id => {
              if (id === LOG_TAB) {
                return (
                  <div key={id} className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
                    {logSrc ? (
                      <img src={logSrc} alt="Skill log image" className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center px-4">
                        No log image yet
                      </div>
                    )}
                    <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                      log_image
                    </div>
                  </div>
                )
              }
              if (id === OBSERVE_TAB) {
                return (
                  <div key={id} className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
                    <video
                      ref={gridObserveVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                      observe
                    </div>
                  </div>
                )
              }
              const cam = cameras.find(c => c.id === id)
              if (!cam) return null
              return <CameraCell key={id} id={cam.id} name={cam.name || cam.id} />
            })}
          </div>
        )
      ) : selectedId === OBSERVE_TAB ? (
        /* ── Observe (webcam) single view ─────────────────────────────────── */
        <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
          <video
            ref={observeVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain"
          />
          <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
            observe (local webcam)
          </div>
        </div>
      ) : (
      <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
        {isLogTab ? (
          logSrc ? (
            <img src={logSrc} alt="Skill log image" onLoad={onImgLoad} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center px-4">
              <span>No log image yet — call <code className="text-gray-300">log_data({'{'} log_image: rgb_arr {'}'})</code> from a skill</span>
            </div>
          )
        ) : cameras.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm text-center p-4">
            <div>
              <p>No camera connected</p>
              <p className="text-xs mt-1">Add a WebRTC or ROS client with <code className="text-gray-300">is_camera: true</code></p>
            </div>
          </div>
        ) : haveSomething ? (
          showRawCanvas ? (
            <canvas
              ref={canvasRef}
              onMouseMove={onCanvasMove}
              onMouseLeave={() => setHoverPx(null)}
              className="w-full h-full object-contain"
            />
          ) : (
            <img src={imgSrc} alt="Camera feed" onLoad={onImgLoad} className="w-full h-full object-contain" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            {hasLive && live
              ? <span className="animate-pulse">Connecting…</span>
              : <span>Press Capture</span>}
          </div>
        )}

        {/* Rect drawing overlay (sits above image, below the button toolbar) */}
        {natSize && (
          <svg
            ref={overlayRef}
            viewBox={`0 0 ${natSize.w} ${natSize.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 w-full h-full"
            style={{
              pointerEvents: drawMode ? 'auto' : 'none',
              cursor: drawMode ? 'crosshair' : 'default',
              touchAction: 'none',
            }}
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onPointerCancel={onOverlayPointerUp}
          >
            {(() => {
              const r = drawing ?? rect
              if (!r) return null
              return (
                <rect
                  x={r.left}
                  y={r.top}
                  width={Math.max(0, r.right - r.left)}
                  height={Math.max(0, r.bottom - r.top)}
                  fill="rgba(59, 130, 246, 0.15)"
                  stroke="rgb(59, 130, 246)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })()}
          </svg>
        )}

        {/* Error banner (e.g. capture failed on the robot side) */}
        {error && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-red-900/85 text-red-100 text-[11px] px-2 py-1 rounded max-w-[70%] text-center">
            ⚠ {error}
          </div>
        )}

        {/* Top-right controls */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {!isLogTab && cameras.length > 0 && (
            <>
              {hasLive && live && haveSomething && (
                <span className="text-[10px] bg-black/60 text-green-400 px-1.5 py-0.5 rounded">
                  {fps} fps
                </span>
              )}

              {/* RGB / Depth toggle */}
              <div className="flex bg-black/60 rounded overflow-hidden text-[11px]">
                <button
                  onClick={() => setChannel('rgb')}
                  className={`px-2 py-0.5 ${channel === 'rgb' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
                >RGB</button>
                <button
                  onClick={() => setChannel('depth')}
                  className={`px-2 py-0.5 ${channel === 'depth' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
                >Depth</button>
              </div>

              {/* Capture button */}
              <button
                onClick={capture}
                className="text-[11px] px-2 py-0.5 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white"
              >Capture</button>

              {/* Live / Stop — only webrtc + ros_topic */}
              {hasLive && (
                <button
                  onClick={() => setLive(v => !v)}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                    live ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {live ? 'Stop' : 'Live'}
                </button>
              )}
            </>
          )}

          {/* Draw / Clear — available whenever an image is on screen (any tab) */}
          {natSize && (
            <button
              onClick={() => setDrawMode(v => !v)}
              className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                drawMode ? 'bg-yellow-500 hover:bg-yellow-400 text-black' : 'bg-gray-600 hover:bg-gray-500 text-white'
              }`}
              title="Drag on the image to draw a rectangle"
            >{drawMode ? 'Drawing…' : 'Draw'}</button>
          )}
          {isLogTab && logSrc && (
            <>
              <button
                onClick={saveLog}
                className="text-[11px] px-2 py-0.5 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white"
                title="Download the annotated log image"
              >Save</button>
              <button
                onClick={() => onClearLog?.()}
                className="text-[11px] px-2 py-0.5 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white"
                title="Reset log image to the initial (no-detection) state"
              >Clear</button>
            </>
          )}
          {rect && (
            <button
              onClick={() => setRect(null)}
              className="text-[11px] px-2 py-0.5 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white"
              title="Clear rectangle"
            >Clear</button>
          )}
        </div>

        {/* Bottom-left depth controls — only when viewing depth */}
        {!isLogTab && channel === 'depth' && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/65 rounded px-2 py-1 text-[10px] text-white">
            {/* Mode toggle */}
            <div className="flex rounded overflow-hidden border border-white/20">
              <button
                onClick={() => setDepthMode('colored')}
                className={`px-1.5 ${depthMode === 'colored' ? 'bg-blue-600' : 'hover:bg-white/10'}`}
                title="Server renders colored JPEG"
              >Color</button>
              <button
                onClick={() => setDepthMode('raw')}
                className={`px-1.5 ${depthMode === 'raw' ? 'bg-blue-600' : 'hover:bg-white/10'}`}
                title="Raw uint16 — hover for mm"
              >Raw</button>
            </div>

            {/* Range inputs */}
            <span className="text-white/50">mm</span>
            <input
              type="number"
              placeholder={activeMeta ? Math.round(activeMeta.dmin).toString() : 'min'}
              value={dminInput}
              onChange={e => setDminInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyRange() }}
              className="w-14 bg-white/10 rounded px-1 py-0.5 text-white placeholder-white/40 focus:outline-none focus:bg-white/20"
            />
            <span className="text-white/50">–</span>
            <input
              type="number"
              placeholder={activeMeta ? Math.round(activeMeta.dmax).toString() : 'max'}
              value={dmaxInput}
              onChange={e => setDmaxInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyRange() }}
              className="w-14 bg-white/10 rounded px-1 py-0.5 text-white placeholder-white/40 focus:outline-none focus:bg-white/20"
            />
            <button
              onClick={applyRange}
              className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 rounded"
            >Apply</button>
            <button
              onClick={autoRange}
              className={`px-1.5 py-0.5 rounded ${manualRange ? 'bg-white/15 hover:bg-white/25' : 'bg-green-700/70'}`}
              title="Auto-range via 2/98 percentile"
            >Auto</button>

            {/* Active range indicator */}
            {activeMeta && (
              <span className="text-white/60 ml-1">
                ⇒ {Math.round(activeMeta.dmin)}–{Math.round(activeMeta.dmax)}
              </span>
            )}
          </div>
        )}

        {/* Top-left readouts: rect coords (whenever a rect exists) + hover (raw-depth only) */}
        {(rect || drawing || (showRawCanvas && hoverPx && !drawMode)) && (
          <div className="absolute top-2 left-2 flex flex-col gap-1 items-start pointer-events-none">
            {(rect || drawing) && (() => {
              const r = drawing ?? rect!
              return (
                <div className="bg-black/65 text-white text-[10px] rounded px-1.5 py-0.5 font-mono">
                  L:{r.left} T:{r.top} R:{r.right} B:{r.bottom}
                </div>
              )
            })()}
            {showRawCanvas && hoverPx && !drawMode && (
              <div className="bg-black/65 text-white text-[10px] rounded px-1.5 py-0.5 font-mono">
                ({hoverPx.x},{hoverPx.y}) {hoverPx.mm === 0 ? 'invalid' : `${hoverPx.mm} mm`}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
