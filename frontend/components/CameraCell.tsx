'use client'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

// Lightweight, self-contained live camera cell for grid mode.
// Opens its OWN camera WebSocket and renders the latest frame as an <img>
// (rgb; falls back to colored depth if the stream is depth-only).
// No depth-range / raw-depth-canvas / draw-rect / capture — those stay in
// tab mode's single view.
export default function CameraCell({ id, name }: { id: string; name: string }) {
  const [src, setSrc]     = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSrc('')
    setError(null)
    const ws = api.cameraWs(id)
    ws.onopen = () => {
      ws.send(JSON.stringify({ depth_mode: 'colored' }))
    }
    ws.onmessage = e => {
      try {
        const data = JSON.parse(e.data)
        if (data.error) { setError(String(data.error)); return }
        setError(null)
        if (data.rgb) {
          setSrc(`data:image/jpeg;base64,${data.rgb}`)
        } else if (data.depth) {
          setSrc(`data:image/jpeg;base64,${data.depth}`)
        }
      } catch { /* ignore malformed frame */ }
    }
    ws.onerror = () => { setError('connection error') }
    ws.onclose = () => { /* unmount cleanup below */ }
    return () => ws.close()
  }, [id])

  return (
    <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-contain" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
          {error
            ? <span className="text-red-300">⚠ {error}</span>
            : <span className="animate-pulse">connecting…</span>}
        </div>
      )}
      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
        {name}
      </div>
    </div>
  )
}
