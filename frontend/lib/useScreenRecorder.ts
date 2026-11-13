'use client'
import { useCallback, useRef, useState } from 'react'
import { buildRecordingStream, displayOptions, getAudioPrefs, makeRecorderContext, type RecordingStream } from './recordAudio'

// Screen recorder for a working session. On enabling the checkbox the user (1)
// grants a target folder ONCE (File System Access API — they pick/create
// `.kcare_robot`, ideally under Documents) and (2) shares the current tab
// (preferCurrentTab). Each plan run records a segment that is written into the
// granted folder as .webm; if the folder isn't available the file falls back to
// the browser's Downloads. Browsers never allow fully silent screen capture, so
// a one-time confirmation is unavoidable. Sound (lib/recordAudio.ts): the tab's audio and, if ticked, the microphone,
// mixed into one audio track; see docs/features/screen-recording.md.

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
// Reuse an already-granted folder ONLY if permission is still granted — never
// prompts (no picker, no requestPermission). Returns null → caller uses Downloads.
// The handle is only ever created by an earlier build's folder picker; we no
// longer prompt for one, so a fresh browser simply saves to Downloads.
async function loadDirSilent(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await idbGet<FileSystemDirectoryHandle>(IDB_KEY)
    if (!h) return null
    const a = h as unknown as { queryPermission?: (o: unknown) => Promise<string> }
    if ((await a.queryPermission?.({ mode: 'readwrite' })) === 'granted') return h
    return null
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

// Persist a finished recording to the granted folder, else the browser Downloads.
//
// `base` is the run's name — the same string datasetLog uses for the run's
// capture folder — so the video and that folder sort together and pair up by
// eye. It already carries a timestamp, hence no second one here. `outcome` is
// the run's verdict, omitted when the run was cut short and it is unknown.
function saveRecording(dir: FileSystemDirectoryHandle | null, blob: Blob,
                       base: string, outcome?: 'succeed' | 'failed'): void {
  if (!blob.size) return
  const name = `${base}${outcome ? `_${outcome}` : ''}.webm`
  if (dir) writeToDir(dir, name, blob).catch(() => download(blob, name))
  else download(blob, name)
}

export function useScreenRecorder() {
  const streamRef = useRef<MediaStream | null>(null)
  const mixRef = useRef<RecordingStream | null>(null)       // the display's video + the mixed sound: what the recorder gets
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null)
  // Filename prefix = first task of the plan being executed (set by the caller
  // once the first step is known). Falls back to 'robotapp' before that.
  const prefixRef = useRef<string>('')
  // Verdict for the segment currently stopping; consumed by rec.onstop.
  const outcomeRef = useRef<'succeed' | 'failed' | undefined>(undefined)
  const [recordEnabled, setRecordEnabled] = useState(false)

  // Manual recording — an independent stream/recorder (separate from the per-run
  // auto-record above) so start/stop-on-click never clashes with a plan segment.
  const manualStreamRef = useRef<MediaStream | null>(null)
  const manualMixRef = useRef<RecordingStream | null>(null)
  const manualRecRef = useRef<MediaRecorder | null>(null)
  const manualChunksRef = useRef<Blob[]>([])
  const [manualRecording, setManualRecording] = useState(false)

  const pickMime = (): string => {
    const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined
    for (const m of cands) if (MR && MR.isTypeSupported?.(m)) return m
    return ''
  }

  const toggleRecord = useCallback(async (on: boolean): Promise<void> => {
    if (on) {
      // The direct source's audio context is made HERE, in the click, before anything is awaited (autoplay policy).
      const prefs = getAudioPrefs()
      const ctx = (prefs.src ?? 'direct') === 'direct' && prefs.tab ? makeRecorderContext() : undefined
      // 1) Reuse an already-granted folder silently (no picker, no permission
      //    re-prompt); otherwise recordings go to Downloads. Never asks where to save.
      try { dirRef.current = await loadDirSilent() } catch { dirRef.current = null }
      // 2) Capture stream once — default to the current tab; reused for every run
      //    so the screen-share permission is asked a single time per enable.
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions(prefs))
        streamRef.current = stream
        mixRef.current = await buildRecordingStream(stream, prefs, ctx)
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          mixRef.current?.dispose(); mixRef.current = null
          streamRef.current = null
          setRecordEnabled(false)
        })
        setRecordEnabled(true)
      } catch {
        ctx?.close().catch(() => {})
        mixRef.current?.dispose(); mixRef.current = null
        streamRef.current = null
        setRecordEnabled(false)
      }
    } else {
      try { recRef.current?.state !== 'inactive' && recRef.current?.stop() } catch { /* ignore */ }
      recRef.current = null
      mixRef.current?.dispose(); mixRef.current = null
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
      const rec = new MediaRecorder(mixRef.current?.stream ?? stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        chunksRef.current = []
        // onstop fires asynchronously, so the verdict endRecording was given is
        // read from the ref here rather than passed down the stop() call.
        saveRecording(dirRef.current, blob, prefixRef.current || 'robotapp',
                      outcomeRef.current)
        outcomeRef.current = undefined
      }
      rec.start()
      recRef.current = rec
    } catch { /* best-effort */ }
  }, [])

  // `outcome` names the file; leave it out when the run ended abnormally (socket
  // dropped, user cancelled) and there is no verdict to report.
  const endRecording = useCallback((outcome?: 'succeed' | 'failed'): void => {
    outcomeRef.current = outcome
    try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop() } catch { /* ignore */ }
    recRef.current = null
  }, [])

  // Base filename for subsequent saved files — the caller passes the run name
  // that datasetLog also uses for the capture folder, so the two line up.
  const setRecordingPrefix = useCallback((p: string): void => { prefixRef.current = p }, [])

  // Manual record: first click acquires a screen share and starts recording;
  // second click stops and saves. Shares the same target folder as auto-record
  // (falls back to Downloads). Independent of plan-run segments.
  const toggleManualRecord = useCallback(async (): Promise<void> => {
    // Stop path — onstop saves and cleans up the stream.
    if (manualRecRef.current) {
      try { if (manualRecRef.current.state !== 'inactive') manualRecRef.current.stop() } catch { /* ignore */ }
      return
    }
    const prefs = getAudioPrefs()
    const ctx = (prefs.src ?? 'direct') === 'direct' && prefs.tab ? makeRecorderContext() : undefined   // in the click, before any await
    // Start path — reuse an already-granted folder silently (no picker, no
    // permission re-prompt); otherwise the recording saves to Downloads. The
    // folder is only ever chosen the first time via the "record screen" checkbox.
    try { dirRef.current = await loadDirSilent() } catch { dirRef.current = null }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayOptions(prefs))
    } catch {
      ctx?.close().catch(() => {})
      return   // user cancelled the share prompt
    }
    manualStreamRef.current = stream
    manualMixRef.current = await buildRecordingStream(stream, prefs, ctx)
    // If the user stops sharing from the browser's own UI, finish and save too.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      try { if (manualRecRef.current && manualRecRef.current.state !== 'inactive') manualRecRef.current.stop() } catch { /* ignore */ }
    })
    try {
      manualChunksRef.current = []
      const mime = pickMime()
      const rec = new MediaRecorder(manualMixRef.current?.stream ?? stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = e => { if (e.data && e.data.size) manualChunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(manualChunksRef.current, { type: 'video/webm' })
        manualChunksRef.current = []
        manualMixRef.current?.dispose(); manualMixRef.current = null
        manualStreamRef.current?.getTracks().forEach(t => t.stop())
        manualStreamRef.current = null
        manualRecRef.current = null
        setManualRecording(false)
        // Its own timestamp, not the last plan's name: a manual clip is not
        // tied to any run, and inheriting a stale run name would imply it was.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        saveRecording(dirRef.current, blob, `manual_${stamp}`)
      }
      rec.start()
      manualRecRef.current = rec
      setManualRecording(true)
    } catch {
      manualMixRef.current?.dispose(); manualMixRef.current = null
      manualStreamRef.current?.getTracks().forEach(t => t.stop())
      manualStreamRef.current = null
    }
  }, [])

  return { recordEnabled, toggleRecord, beginRecording, endRecording, manualRecording, toggleManualRecord, setRecordingPrefix }
}
