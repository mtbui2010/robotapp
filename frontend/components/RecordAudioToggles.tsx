'use client'
import { useEffect, useRef, useState } from 'react'
import { NOTE_EVENT, defaultSource, getAudioPrefs, setAudioPrefs, testRecordingAudio, type AudioSource } from '../lib/recordAudio'

// Sound options for the screen recordings, folded into ONE "⋯" button next to the record controls. The popover has
// the sound checkbox, the source, the microphone, the 9 s self-test and the full note. A small dot on the button says how the last recording
// started (green = it carries sound, amber = it does not or the test failed; none before any); the tooltip says what is set. Takes effect at the next
// recording (the share dialog is where the browser asks about system / tab audio).

type Level = 'none' | 'ok' | 'warn'
const levelOf = (note: string): Level =>
  !note ? 'none' : /NO sound|No (system|tab) audio|NOT recorded|not recorded|failed|refused|cancelled|silent|no audio/i.test(note) ? 'warn' : 'ok'
const DOT: Record<Level, string> = { none: 'bg-gray-300', ok: 'bg-green-500', warn: 'bg-amber-500' }

export default function RecordAudioToggles() {
  const [tab, setTab] = useState(true)
  const [mic, setMic] = useState(false)
  const [src, setSrc] = useState<AudioSource>('system')
  const [note, setNote] = useState('')
  const [testing, setTesting] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  useEffect(() => {                         // localStorage is read after mount (static export: no window while building)
    const p = getAudioPrefs(); setTab(p.tab); setMic(p.mic); setSrc(p.src ?? defaultSource())
    const on = (e: Event) => setNote(String((e as CustomEvent).detail || ''))
    window.addEventListener(NOTE_EVENT, on)
    return () => window.removeEventListener(NOTE_EVENT, on)
  }, [])

  useEffect(() => {                         // a click outside, Escape, a resize or a scroll closes the popover
    if (!open) return
    const out = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [open])

  const toggle = () => {
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - 336)), top: r.bottom + 4 })   // fixed: no parent clips it
    setOpen(o => !o)
  }

  const runTest = async () => {
    setTesting(true); setNote(src === 'direct' ? 'Testing (about 12 s): the backend says a Korean and an English sentence into the recording…' : src === 'system' ? 'Testing (about 9 s): choose "Entire screen" and tick "Also share system audio"…' : 'Testing (about 9 s): choose "This tab" and tick "Also share tab audio"…')
    try { setNote((await testRecordingAudio()).text) } catch (e) { setNote(`Test failed: ${(e as Error).message}`) }
    setTesting(false)
  }

  const level = levelOf(note)
  return (
    <span className="inline-flex items-center">
      <button ref={btn} type="button" onClick={toggle} data-testid="record-audio-button"
        title={`Recording sound: ${tab ? src : 'off'}${tab && mic ? ' + your answers' : ''}${note ? ` — ${note}` : ''}`}
        className="relative px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 font-bold leading-none">
        ⋯
        {level !== 'none' && <span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${DOT[level]}`} />}
      </button>
      {open && (
        <div ref={pop} style={{ position: 'fixed', left: pos.left, top: pos.top }} data-testid="record-audio-popover"
          className="z-50 w-80 bg-white border border-gray-300 rounded shadow-lg p-2 flex flex-col gap-2 text-[11px] text-gray-700 whitespace-normal">
          <label className="flex items-center gap-1.5 cursor-pointer" title="Record sound at all">
            <input type="checkbox" checked={tab} className="accent-blue-600"
              onChange={e => { setTab(e.target.checked); setAudioPrefs({ tab: e.target.checked }) }} />
            record sound
          </label>
          <label className="flex items-center gap-1.5">
            source
            <select value={src} onChange={e => { setSrc(e.target.value as AudioSource); setAudioPrefs({ src: e.target.value as AudioSource }) }}
              title="system: share the entire screen with system audio (Windows / ChromeOS) — the robot's voice is the same browser voice you hear. direct: works everywhere, you hear the browser's voice and the file has the backend's voice of the same lines (GET /tts). tab: this tab's audio (Chrome often leaves the browser's voice out)."
              className="bg-white border border-gray-300 rounded px-1 py-0.5 flex-1">
              <option value="system">system (same voice)</option>
              <option value="direct">direct (backend voice)</option>
              <option value="tab">tab</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer"
            title="Also record your voice: your answers, taken from the dashboard's own listening (exactly what the robot hears) while it listens.">
            <input type="checkbox" checked={mic} className="accent-blue-600"
              onChange={e => { setMic(e.target.checked); setAudioPrefs({ mic: e.target.checked }) }} />
            🎤 your answers
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={runTest} disabled={testing}
              title="Does the robot's spoken line reach the recording on this machine?"
              className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              audio test
            </button>
            <span className="text-gray-400">applies from the next recording</span>
          </div>
          {note && <div className={`text-[10px] leading-snug ${level === 'warn' ? 'text-amber-700' : 'text-gray-500'}`}>{note}</div>}
        </div>
      )}
    </span>
  )
}
