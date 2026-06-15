'use client'
import { useCallback, useRef, useState } from 'react'

// Screen recorder for a working session. On enabling the checkbox the user (1)
// grants a target folder ONCE (File System Access API — they pick/create
// `.kcare_robot`, ideally under Documents) and (2) shares the current tab
// (preferCurrentTab). Each plan run records a segment that is written into the
// granted folder as .webm; if the folder isn't available the file falls back to
// the browser's Downloads. Browsers never allow fully silent screen capture, so
// a one-time confirmation is unavoidable.

// ── persisted directory handle (IndexedDB) ──────────────────────────────────
const IDB_DB = 'robotapp', IDB_STORE = 'fs', IDB_KEY = 'kcareDir'

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function idbGet<T>(k: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k)
    tx.onsuccess = () => res(tx.result as T); tx.onerror = () => rej(tx.error)
  })
}
async function idbSet(k: string, v: unknown): Promise<void> {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(v, k)
    tx.onsuccess = () => res(); tx.onerror = () => rej(tx.error)
  })
}

// Re-use a previously granted folder (re-verifying permission), else null.
async function loadDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await idbGet<FileSystemDirectoryHandle>(IDB_KEY)
    if (!h) return null
    const a = h as unknown as { queryPermission?: (o: unknown) => Promise<string>; requestPermission?: (o: unknown) => Promise<string> }
    const opt = { mode: 'readwrite' }
    if ((await a.queryPermission?.(opt)) === 'granted') return h
    if ((await a.requestPermission?.(opt)) === 'granted') return h
    return null
  } catch { return null }
}
// Prompt the user to pick/create the folder (must run in a user gesture).
async function pickDir(): Promise<FileSystemDirectoryHandle | null> {
  const w = window as unknown as { showDirectoryPicker?: (o: unknown) => Promise<FileSystemDirectoryHandle> }
  if (!w.showDirectoryPicker) return null
  try {
    const h = await w.showDirectoryPicker({ id: 'kcare', mode: 'readwrite', startIn: 'documents' })
    await idbSet(IDB_KEY, h)
    return h
  } catch { return null }
}
async function writeToDir(dir: FileSystemDirectoryHandle, name: string, blob: Blob): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(blob)
  await w.close()
}
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function useScreenRecorder() {
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [recordEnabled, setRecordEnabled] = useState(false)

  const pickMime = (): string => {
    const cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined
    for (const m of cands) if (MR && MR.isTypeSupported?.(m)) return m
    return ''
  }

  const toggleRecord = useCallback(async (on: boolean): Promise<void> => {
    if (on) {
      // 1) Folder grant (prompts only the first time; reused afterwards).
      try { dirRef.current = (await loadDir()) || (await pickDir()) } catch { dirRef.current = null }
      // 2) Capture stream — default to the current tab.
      try {
        const opts = { video: true, audio: false, preferCurrentTab: true,
                       selfBrowserSurface: 'include' } as unknown as DisplayMediaStreamOptions
        const stream = await navigator.mediaDevices.getDisplayMedia(opts)
        streamRef.current = stream
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          streamRef.current = null
          setRecordEnabled(false)
        })
        setRecordEnabled(true)
      } catch {
        streamRef.current = null
        setRecordEnabled(false)
      }
    } else {
      try { recRef.current?.state !== 'inactive' && recRef.current?.stop() } catch { /* ignore */ }
      recRef.current = null
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setRecordEnabled(false)
    }
  }, [])

  const beginRecording = useCallback((): void => {
    const stream = streamRef.current
    if (!stream || recRef.current) return
    try {
      chunksRef.current = []
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        chunksRef.current = []
        if (!blob.size) return
        const name = `robotapp_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`
        const dir = dirRef.current
        if (dir) {
          writeToDir(dir, name, blob).catch(() => download(blob, name))
        } else {
          download(blob, name)
        }
      }
      rec.start()
      recRef.current = rec
    } catch { /* best-effort */ }
  }, [])

  const endRecording = useCallback((): void => {
    try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop() } catch { /* ignore */ }
    recRef.current = null
  }, [])

  return { recordEnabled, toggleRecord, beginRecording, endRecording }
}
