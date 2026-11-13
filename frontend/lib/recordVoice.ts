'use client'
import { api } from './api'
import { noteRecordingAudio } from './recordNote'

// The recorder's audio graph (the "sink"), installed while a recording runs:
//  • voice: true  ("direct" source) — the browser's own speech synthesis cannot be recorded on every machine (a Korean line was
//    silent in a tab-audio clip), so each robot line is ALSO fetched as audio from the backend (GET /tts) and played into the
//    graph, which only the recording hears. What the user hears does not change: the browser's voice, exactly as without a
//    recording. The earcons are made in the graph (heard and recorded).
//  • mic: true — the stream recordPhrase listens with is tapped into the recording (the user's answers), in any source.
// Without a sink nothing changes: speechSynthesis.

export interface VoiceSink { ctx: AudioContext; dest: MediaStreamAudioDestinationNode; mic: boolean; voice: boolean }   // mic: the user's answers; voice: the backend's copy of the robot's lines + the earcons

let sink: VoiceSink | null = null
let current: { stop: () => void } | null = null
let lastError = ''
let noted = false

/** The sink the robot's voice and the earcons go through (null when no recording, or a source that records the real output). */
export const getVoiceSink = (): VoiceSink | null => (sink && sink.voice ? sink : null)
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

/** Play the backend's voice of `text` into the recording graph (the recording only). Resolves true when it was played (at its
 *  end), false when it could not be (no sink, or the backend could not make the audio: said once in the toggles' note).
 *  `interrupt`: cut the line still playing (milestones supersede each other). */
export async function speakViaSink(text: string, lang?: string | null, rate?: number | null, interrupt = false): Promise<boolean> {
  const s = sink
  const t = (text || '').trim()
  if (!s || !s.voice || !t) return false
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
    node.connect(s.dest)                                           // the recording only: the user hears the browser's voice
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
      noteRecordingAudio(`Robot voice NOT recorded: ${lastError} (the backend needs GET /tts: restart it, and it needs the internet for gTTS). You still hear the browser's voice.`)
    }
    return false
  }
}
