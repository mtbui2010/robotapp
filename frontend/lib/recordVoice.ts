'use client'
import { api } from './api'
import { noteRecordingAudio } from './recordNote'

// "Direct" recording: the browser's own speech synthesis cannot be recorded on every machine (a Korean line was silent in a
// tab-audio clip), so while a recording runs with the direct source, the robot's lines are fetched as audio from the backend
// (GET /tts) and played through a WebAudio graph the recorder owns: they reach the speakers AND the recording.
// The earcons (hriVoice.playEarcon) use the same graph. Without a recording (no sink) nothing changes: speechSynthesis.

export interface VoiceSink { ctx: AudioContext; dest: MediaStreamAudioDestinationNode }

let sink: VoiceSink | null = null
let current: AudioBufferSourceNode | null = null
let lastError = ''
let noted = false

export const getVoiceSink = (): VoiceSink | null => sink
export const lastVoiceError = (): string => lastError

/** The recorder installs its graph when a direct recording starts and removes it (null) when it ends. */
export function setVoiceSink(s: VoiceSink | null): void {
  stopVoice()
  sink = s; lastError = ''; noted = false
}

export function stopVoice(): void {
  try { current?.stop() } catch { /* already stopped */ }
  current = null
}

/** Say `text` through the recording graph. Resolves true when it was played (at its end), false when the caller must use
 *  speechSynthesis instead (no sink, or the backend could not make the audio: said once in the toggles' note).
 *  `interrupt`: cut the line still playing (milestones supersede each other). */
export async function speakViaSink(text: string, lang?: string | null, rate?: number | null, interrupt = false): Promise<boolean> {
  const s = sink
  const t = (text || '').trim()
  if (!s || !t) return false
  try {
    const data = await api.ttsAudio(t, (lang || '').slice(0, 2).toLowerCase() || undefined)
    if (sink !== s) return false                                   // the recording ended meanwhile
    const buf = await s.ctx.decodeAudioData(data)
    if (interrupt) stopVoice()
    const src = s.ctx.createBufferSource()
    src.buffer = buf
    const r = rate && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1
    src.playbackRate.value = r
    src.connect(s.dest)                                            // the recording
    src.connect(s.ctx.destination)                                 // and the speakers
    await new Promise<void>(resolve => {
      const cap = setTimeout(resolve, (buf.duration / r) * 1000 + 2000)   // a lost `ended` must not stall the listen behind it
      src.onended = () => { clearTimeout(cap); resolve() }
      current = src
      src.start()
    })
    if (current === src) current = null
    return true
  } catch (e) {
    lastError = (e as Error)?.message || String(e)
    if (!noted) {
      noted = true
      noteRecordingAudio(`Robot voice NOT recorded: ${lastError} (the backend needs GET /tts: restart it, and it needs the internet for gTTS). The browser voice is used.`)
    }
    return false
  }
}
