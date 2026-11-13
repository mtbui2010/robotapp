'use client'
import { useEffect, useState } from 'react'
import { NOTE_EVENT, getAudioPrefs, setAudioPrefs, testRecordingAudio, type AudioSource } from '../lib/recordAudio'

// Sound options for the screen recordings, shown next to the record controls: the tab's audio, the microphone, and a
// 5 s self-test that says whether the robot's spoken lines reach the recording on this machine. Takes effect at the
// next recording (the share dialog is where the browser asks about tab audio).
export default function RecordAudioToggles() {
  const [tab, setTab] = useState(true)
  const [mic, setMic] = useState(false)
  const [src, setSrc] = useState<AudioSource>('direct')
  const [note, setNote] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {                         // localStorage is read after mount (static export: no window while building)
    const p = getAudioPrefs(); setTab(p.tab); setMic(p.mic); setSrc(p.src ?? 'direct')
    const on = (e: Event) => setNote(String((e as CustomEvent).detail || ''))
    window.addEventListener(NOTE_EVENT, on)
    return () => window.removeEventListener(NOTE_EVENT, on)
  }, [])

  const runTest = async () => {
    setTesting(true); setNote(src === 'direct' ? 'Testing (about 12 s): the backend says a Korean and an English sentence into the recording graph…' : src === 'system' ? 'Testing (about 9 s): choose "Entire screen" and tick "Also share system audio"…' : 'Testing (about 9 s): choose "This tab" and tick "Also share tab audio"…')
    try { setNote((await testRecordingAudio()).text) } catch (e) { setNote(`Test failed: ${(e as Error).message}`) }
    setTesting(false)
  }

  return (
    <span className="flex items-center gap-2">
      <label className="flex items-center gap-1 cursor-pointer"
        title="Record the page's sound (earcons, alarm). In the share dialog tick 'Also share tab audio'.">
        <input type="checkbox" checked={tab} className="accent-blue-600"
          onChange={e => { setTab(e.target.checked); setAudioPrefs({ tab: e.target.checked }) }} />
        🔊 sound
      </label>
      <select value={src} onChange={e => { setSrc(e.target.value as AudioSource); setAudioPrefs({ src: e.target.value as AudioSource }) }}
        title="direct: the app puts the robot's voice (from the backend, GET /tts), the beeps and the mic into the recording itself — works on every OS and browser, no 'share audio' tick. tab: this tab's audio (the browser's own voice may be left out). whole system: share the entire screen with system audio (Windows / ChromeOS)."
        className="bg-white border border-gray-300 rounded px-1 py-0.5">
        <option value="direct">direct</option>
        <option value="tab">tab</option>
        <option value="system">whole system</option>
      </select>
      <label className="flex items-center gap-1 cursor-pointer"
        title="Also record your voice. Direct: your answers, taken from the dashboard's own listening (exactly what the robot hears). Tab / whole system: the microphone, mixed into the same track.">
        <input type="checkbox" checked={mic} className="accent-blue-600"
          onChange={e => { setMic(e.target.checked); setAudioPrefs({ mic: e.target.checked }) }} />
        🎤 mic
      </label>
      <button type="button" onClick={runTest} disabled={testing}
        title="5 s test: does the robot's spoken line reach the recording on this machine?"
        className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
        audio test
      </button>
      {note && <span className="text-[10px] text-gray-500 max-w-[24rem]" title={note}>{note}</span>}
    </span>
  )
}
