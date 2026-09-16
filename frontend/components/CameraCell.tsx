'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ClientEntry } from '../lib/types'
import { decodeRawDepth, encode16BitGrayPng, downloadBlob } from '../lib/depthPng'

type Channel = 'rgb' | 'depth'

// Self-contained live camera cell for grid mode. Owns its OWN camera WebSocket
// and renders the latest frame as an <img>. Carries a compact "mini" subset of
// the tab view's controls:
//   • RGB / Depth toggle (default RGB; colored-depth <img> only — no raw canvas)
//   • Capture/Save (download the currently displayed frame)
//   • Live / Stop (only when the client is live-capable: webrtc / ros_topic)
// No depth-range / raw-depth-canvas / draw-rect — those stay in tab mode.
export default function CameraCell({ client }: { client: ClientEntry }) {
  const { id, name: rawName } = client
  const name = rawName || id
  const hasLive = client.type === 'webrtc' || client.type === 'ros_topic'

  const [channel, setChannel] = useState<Channel>('rgb')   // default RGB (depth unchecked)
  const [live, setLive]       = useState(true)             // default live
  const [srcs, setSrcs]       = useState<{ rgb: string; depth: string }>({ rgb: '', depth: '' })
  const [error, setError]     = useState<string | null>(null)
  const [imgNat, setImgNat]   = useState<{ w: number; h: number } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  // One-shot raw-depth PNG save: the cell streams colored depth, so save_raw
  // briefly switches the wire to raw, grabs one frame, then restores colored.
  const pendingRawSaveRef = useRef(false)

  // WS lifecycle: open on mount / when going live, close on unmount / on stop.
  useEffect(() => {
    // Stopped (only possible for live-capable clients): freeze the last frame.
    if (hasLive && !live) return

    setError(null)
    pendingRawSaveRef.current = false   // abandon any in-flight one-shot on reconnect/unmount
    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (cancelled) return
      const ws = api.cameraWs(id)
      wsRef.current = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ depth_mode: 'colored' }))
      }
      ws.onmessage = e => {
        try {
          const data = JSON.parse(e.data)
          if (data.error) { setError(String(data.error)); return }
          setError(null)
          // One-shot raw-depth save: a raw frame arrived for the save_raw click.
          // Encode & download, then restore colored streaming. Guard on the
          // pending flag + not-cancelled so a stopped/unmounted cell is a no-op.
          if (data.depth_raw && pendingRawSaveRef.current &&
              typeof data.depth_w === 'number' && typeof data.depth_h === 'number') {
            pendingRawSaveRef.current = false
            const w = data.depth_w as number
            const h = data.depth_h as number
            const safe  = name.replace(/[^\w.-]+/g, '_')
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            decodeRawDepth(data.depth_raw)
              .then(u16 => encode16BitGrayPng(u16, w, h))
              .then(blob => downloadBlob(blob, `depth_raw_${safe}_${stamp}.png`))
              .catch(err => console.error('save_raw (cell):', err))
              .finally(() => {
                if (!cancelled && wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ depth_mode: 'colored' }))
                }
              })
            return   // raw frame carries no colored jpeg — nothing else to render
          }
          setSrcs(prev => ({
            rgb:   data.rgb   ? `data:image/jpeg;base64,${data.rgb}`   : prev.rgb,
            depth: data.depth ? `data:image/jpeg;base64,${data.depth}` : prev.depth,
          }))
          // Depth-only stream → flip this cell to depth so it actually renders
          // (matches the tab single view; otherwise an rgb-default cell stays blank).
          if (data.depth && !data.rgb) setChannel(prev => (prev === 'rgb' ? 'depth' : prev))
        } catch { /* ignore malformed frame */ }
      }
      ws.onerror = () => { setError('connection error') }
      // Unexpected drop while still live → auto-reconnect with a small backoff
      // (otherwise the cell freezes on its last frame and stops streaming).
      ws.onclose = () => {
        if (cancelled) return
        reconnectTimer = setTimeout(connect, 1500)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, live, hasLive])

  const src = channel === 'depth' ? srcs.depth : srcs.rgb

  // Track the displayed image's natural pixel size for the shape badge.
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth && img.naturalHeight) {
      setImgNat(prev => (prev?.w === img.naturalWidth && prev?.h === img.naturalHeight)
        ? prev
        : { w: img.naturalWidth, h: img.naturalHeight })
    }
  }

  // numpy H×W×C order: C = 1 for depth, 3 for rgb.
  const shapeLabel = imgNat ? `${imgNat.h}×${imgNat.w}×${channel === 'depth' ? 1 : 3}` : null

  const capture = () => {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    const safe  = name.replace(/[^\w.-]+/g, '_')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `capture_${safe}_${channel}_${stamp}.jpg`
    document.body.appendChild(a); a.click(); a.remove()
  }

  // Save RAW depth as a 16-bit grayscale PNG via a one-shot raw capture:
  // switch the wire to raw, grab one frame (handled in onmessage), restore colored.
  const saveRaw = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) { setError('not connected'); return }
    pendingRawSaveRef.current = true
    wsRef.current.send(JSON.stringify({ depth_mode: 'raw' }))
  }

  // Stop button propagation so dragging the cell body never fires on buttons.
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
      {src ? (
        <img src={src} alt={name} onLoad={onImgLoad} className="w-full h-full object-contain" draggable={false} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
          {error
            ? <span className="text-red-300">⚠ {error}</span>
            : hasLive && !live
              ? <span>stopped</span>
              : <span className="animate-pulse">connecting…</span>}
        </div>
      )}

      {/* Name label */}
      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
        {name}
      </div>

      {/* Shape badge (numpy H×W×C) — top-left, clear of name + controls. */}
      {src && shapeLabel && (
        <div className="absolute top-1 left-1 bg-black/65 text-white text-[10px] px-1.5 py-0.5 rounded font-mono pointer-events-none">
          {shapeLabel}
        </div>
      )}

      {/* Mini controls bar (top-right). Buttons stop drag propagation. */}
      <div
        className="absolute top-1 right-1 flex items-center gap-1"
        draggable={false}
        onDragStart={e => e.preventDefault()}
      >
        {/* RGB / Depth toggle */}
        <div className="flex bg-black/60 rounded overflow-hidden text-[10px]">
          <button
            onClick={e => { stop(e); setChannel('rgb') }}
            onMouseDown={stop}
            className={`px-1.5 py-0.5 ${channel === 'rgb' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
          >RGB</button>
          <button
            onClick={e => { stop(e); setChannel('depth') }}
            onMouseDown={stop}
            className={`px-1.5 py-0.5 ${channel === 'depth' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
          >Depth</button>
        </div>

        {/* Capture / Save */}
        <button
          onClick={e => { stop(e); capture() }}
          onMouseDown={stop}
          title="Download the displayed frame"
          className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white"
        >Save</button>

        {/* save_raw — depth view only: 16-bit grayscale PNG of raw depth */}
        {channel === 'depth' && (
          <button
            onClick={e => { stop(e); saveRaw() }}
            onMouseDown={stop}
            title="Save RAW depth as a 16-bit grayscale PNG"
            className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white"
          >save_raw</button>
        )}

        {/* Live / Stop — only webrtc + ros_topic */}
        {hasLive && (
          <button
            onClick={e => { stop(e); setLive(v => !v) }}
            onMouseDown={stop}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              live ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >{live ? 'Stop' : 'Live'}</button>
        )}
      </div>
    </div>
  )
}
