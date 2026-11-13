'use client'
import { api } from './api'
import { noteRecordingAudio } from './recordNote'

// "Direct" recording: the browser's own speech synthesis cannot be recorded on every machine (a Korean line was silent in a
// tab-audio clip), so while a recording runs with the direct source, the robot's lines are fetched as audio from the backend
// (GET /tts) and played through a WebAudio graph the recorder owns: they reach the speakers AND the recording.
// The earcons (hriVoice.playEarcon) use the same graph. Without a recording (no sink) nothing changes: speechSynthesis.

export interface VoiceSink { ctx: AudioContext; dest: MediaStreamAudioDestinationNode; mic: boolean }   // mic: record the user's answers

let sink: VoiceSink | null = null
let current: { stop: () => void } | null = null
let lastError = ''
let noted = false

export const getVoiceSink = (): VoiceSink | null => sink
export const lastVoiceError = (): string => lastError

/** The recorder installs its graph when a direct recording starts and removes it (null) when it ends. */
export function setVoiceSink(s: VoiceSink | null): void {
  stopVoice()
  sink = s; lastError = ''; noted = false
}

/** The user's answer: the stream the dashboard itself listens with (recordPhrase, what Whisper hears) is also sent into the
 *  recording, when 🎤 is ticked. Returns the function that ends the tap. A second microphone capture kept open for the whole
 *  recording was silent on a real machine and would add the room's noise and the robot's own voice from the speakers. */
export function tapMic(stream: MediaStream): () => void {
  const s = sink
  if (!s || !s.mic) return () => {}
  try {
    const node = s.ctx.createMediaStreamSource(stream)
    node.connect(s.dest)                                           // not to the speakers: no echo of your own voice
    return () => { try { node.disconnect() } catch { /* gone */ } }
  } catch { return () => {} }
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
    if (interrupt) stopVoice()
    // Played by a media element (not an AudioBufferSourceNode): its playbackRate keeps the PITCH (a buffer source's
    // playbackRate raises it: HRI_CONFIGS.speech_rate 1.3 made the Korean voice sound like a chipmunk in the recording).
    const url = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }))
    const el = new Audio(url)
    const pitchKeeping = el as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean }
    pitchKeeping.preservesPitch = true
    pitchKeeping.webkitPreservesPitch = true
    pitchKeeping.mozPreservesPitch = true
    const r = rate && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1
    el.playbackRate = r
    const node = s.ctx.createMediaElementSource(el)
    node.connect(s.dest)                                           // the recording
    node.connect(s.ctx.destination)                                // and the speakers
    const me = { stop: () => el.pause() }
    try {
      await new Promise<void>((resolve, reject) => {
        const cap = setTimeout(resolve, 60_000)                    // a lost `ended` must not stall the listen behind it
        el.onended = () => { clearTimeout(cap); resolve() }
        el.onpause = () => { clearTimeout(cap); resolve() }          // cut by a newer line
        el.onerror = () => { clearTimeout(cap); reject(new Error('the audio could not be played')) }
        current = me
        el.play().catch(e => { clearTimeout(cap); reject(e) })
      })
    } finally {
      if (current === me) current = null
      try { node.disconnect() } catch { /* gone */ }
      URL.revokeObjectURL(url)
    }
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
