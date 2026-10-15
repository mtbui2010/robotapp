'use client'

// Browser side of the HRI skills' source='dashboard' mode (kcare hri.reply /
// hri.ask). The robot sends `speak` and `listen` events over the agent
// WebSocket; this voices the robot's lines and captures one spoken answer.
//
// Deliberately separate from useVoiceOutput: that hook narrates milestones, is
// gated by the voice toggle, and cancels whatever is playing when a newer
// milestone arrives. An HRI line is the skill's actual output — it must always
// play, play to the end, and finish before the mic opens.

function bcp47(lang?: string | null): string {
  const map: Record<string, string> = { en: 'en-US', ko: 'ko-KR' }
  if (!lang) return 'ko-KR'
  return map[lang] ?? lang
}

// Earcons around a listen (listen.earcon = volume, 0 = off; the robot's HRI_CONFIGS earcon / earcon_volume):
// two rising notes when the mic opens ("your turn"), two falling ones when a phrase was taken ("got it"). A blind
// user cannot see that the mic is open. The same tones as robot_agent.utils.earcon on the robot speaker.
const EARCON = {
  listen: { notes: [600, 900], sec: 0.075 },
  heard: { notes: [900, 600], sec: 0.06 },
}

// Resolves when the tone has played. Played before the mic opens, so the
// recording (and recordPhrase's noise-floor calibration) never hears it.
export function playEarcon(kind: keyof typeof EARCON, volume = 0.3): Promise<void> {
  if (typeof window === 'undefined' || !(volume > 0)) return Promise.resolve()
  return new Promise(resolve => {
    let ctx: AudioContext
    try { ctx = new AudioContext() } catch { resolve(); return }
    const { notes, sec } = EARCON[kind]
    const gain = ctx.createGain()
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.connect(gain)
    gain.connect(ctx.destination)
    const t0 = ctx.currentTime + 0.03
    gain.gain.setValueAtTime(0, ctx.currentTime)
    notes.forEach((f, i) => {               // 10 ms fades: no clicks
      const t = t0 + i * sec
      osc.frequency.setValueAtTime(f, t)
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(volume, t + 0.01)
      gain.gain.setValueAtTime(volume, t + sec - 0.01)
      gain.gain.linearRampToValueAtTime(0, t + sec)
    })
    const end = t0 + notes.length * sec
    let done = false
    const finish = () => { if (!done) { done = true; ctx.close().catch(() => {}); resolve() } }
    osc.onended = finish
    // A context created outside a click may start suspended; it never plays then — do not hang on it.
    setTimeout(finish, (end - ctx.currentTime + 0.5) * 1000)
    ctx.resume().catch(() => {})
    osc.start(t0)
    osc.stop(end)
  })
}

// The siren of a (simulated) 119 call (kcare call_119 with the dashboard as the speaker): `cycles` x high / low
// notes, 0.35 s each — the same tones as robot_agent.utils.alarm on the robot speaker. The user, and anyone else
// near the dashboard's speaker, hears that help was called.
export function playAlarm(volume = 0.6, cycles = 3): Promise<void> {
  if (typeof window === 'undefined' || !(volume > 0)) return Promise.resolve()
  return new Promise(resolve => {
    let ctx: AudioContext
    try { ctx = new AudioContext() } catch { resolve(); return }
    const notes = [880, 660], sec = 0.35
    const gain = ctx.createGain()
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.connect(gain)
    gain.connect(ctx.destination)
    const t0 = ctx.currentTime + 0.05
    gain.gain.setValueAtTime(0, ctx.currentTime)
    const n = Math.max(1, Math.round(cycles)) * notes.length
    for (let i = 0; i < n; i++) {           // 15 ms fades: no clicks
      const t = t0 + i * sec
      osc.frequency.setValueAtTime(notes[i % notes.length], t)
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(volume, t + 0.015)
      gain.gain.setValueAtTime(volume, t + sec - 0.015)
      gain.gain.linearRampToValueAtTime(0, t + sec)
    }
    const end = t0 + n * sec
    let done = false
    const finish = () => { if (!done) { done = true; ctx.close().catch(() => {}); resolve() } }
    osc.onended = finish
    setTimeout(finish, (end - ctx.currentTime + 0.5) * 1000)
    ctx.resume().catch(() => {})
    osc.start(t0)
    osc.stop(end)
  })
}

// Resolves once the line has been spoken (or immediately if speech synthesis is
// unavailable), so a following listen does not transcribe the robot's own voice.
// `rate`: SpeechSynthesisUtterance.rate (1 = normal; HRI_CONFIGS.speech_rate, sent with the event).
export function speakAndWait(text: string, lang?: string | null, rate?: number | null): Promise<void> {
  return new Promise(resolve => {
    const t = (text || '').trim()
    if (!t || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve()
      return
    }
    const u = new SpeechSynthesisUtterance(t)
    u.lang = bcp47(lang)
    const voices = window.speechSynthesis.getVoices()
    const voice = voices.find(v => v.lang.replace('_', '-') === u.lang)
      ?? voices.find(v => v.lang.replace('_', '-').split('-')[0] === u.lang.split('-')[0])
    if (voice) u.voice = voice
    if (rate && rate > 0) u.rate = rate
    // Chrome occasionally never fires `end` for an utterance; cap the wait so a
    // lost event cannot stall the listen queued behind it. Slower speech takes
    // longer: a cap made for rate 1 would open the mic while it is still talking.
    const slow = Math.min(1, rate && rate > 0 ? rate : 1)
    const cap = setTimeout(resolve, Math.min(30_000, 2_000 + t.length * 150) / slow)
    u.onend = () => { clearTimeout(cap); resolve() }
    u.onerror = () => { clearTimeout(cap); resolve() }
    window.speechSynthesis.speak(u)
  })
}

interface RecognitionResults {
  length: number
  [i: number]: { isFinal?: boolean; 0: { transcript: string } }
}
interface RecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((e: { results: RecognitionResults }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  onnomatch?: (() => void) | null
  onaudiostart?: (() => void) | null
  onsoundstart?: (() => void) | null
  onspeechstart?: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => RecognitionLike

export interface Heard {
  text: string
  error?: string        // a real failure (mic blocked, unsupported), not silence
  note?: string         // with no text: what the recogniser saw — mic opened?
                        // sound? speech? and its code (no-speech, aborted, …)
}

// Capture one phrase. `continuous = false` makes the recogniser end on its own
// after a pause, which is the silence detection; `maxSec` caps a phrase that
// never pauses. Hearing nothing is not an error — it resolves with empty text,
// which the skill treats as "no answer" and may re-ask.
export function recognizeOnce(lang?: string | null, maxSec = 8): Promise<Heard> {
  return new Promise(resolve => {
    // Cast rather than augment Window: AgentPanel already declares these
    // globals with its own type, and a second declaration would conflict.
    const w = (typeof window !== 'undefined' ? window : {}) as unknown as {
      SpeechRecognition?: RecognitionCtor
      webkitSpeechRecognition?: RecognitionCtor
    }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) {
      resolve({ text: '', error: 'speech recognition is not supported in this browser' })
      return
    }
    const rec = new Ctor()
    rec.lang = bcp47(lang)
    // Interim results on: for a longer Korean phrase Chrome sometimes detects
    // speech, produces interim text and then ends without a final result —
    // with interim off the whole phrase was lost ("speech detected, nothing
    // transcribed"). The last interim text is used when no final one comes.
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.continuous = false

    let text = ''                         // final results
    let interim = ''                      // latest non-final text, the fallback
    let events = 0, nomatch = false
    let error: string | undefined
    let code: string | undefined          // benign end codes, kept for the note
    let audio = false, sound = false, speech = false
    const t0 = Date.now()
    let done = false
    const cap = setTimeout(() => { try { rec.stop() } catch { /* already ended */ } }, maxSec * 1000)
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(cap)
      const fin = text.trim()
      const t = fin || interim.trim()
      const secs = `${((Date.now() - t0) / 1000).toFixed(1)} s`
      const note = t
        ? (fin ? undefined : `no final result — used the interim text (${rec.lang}, ${secs})`)
        : [audio ? 'mic opened' : 'mic never opened',
           sound ? 'sound heard' : 'no sound',
           speech ? 'speech detected, nothing transcribed' : 'no speech',
           `${events} result event(s)`, nomatch && 'nomatch',
           rec.lang, secs,
           code && `(${code})`].filter(Boolean).join(', ')
      resolve(error ? { text: t, error, note } : { text: t, note })
    }
    rec.onaudiostart = () => { audio = true }
    rec.onsoundstart = () => { sound = true }
    rec.onspeechstart = () => { speech = true }
    rec.onresult = e => {
      events++
      const fin: string[] = [], tmp: string[] = []
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        ;(r.isFinal ? fin : tmp).push(r[0].transcript)
      }
      text = fin.join(' ')
      if (tmp.length || fin.length) interim = [...fin, ...tmp].join(' ')
    }
    rec.onnomatch = () => { nomatch = true }
    rec.onerror = e => {
      // 'no-speech' / 'aborted' just mean nobody talked — not a failure.
      if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') error = e.error
      else code = e?.error
    }
    rec.onend = finish
    try {
      rec.start()
    } catch (err) {
      error = String(err)
      finish()
    }
  })
}

/**
 * Ask for the microphone while the user's click is still "fresh".
 *
 * A skill opens the mic seconds after the click that started the run (after
 * the robot has spoken), when Chrome no longer counts it as a user gesture —
 * so a first-time permission prompt cannot appear and recognition fails with
 * 'not-allowed'. Asking here, inside the click, lets the browser remember the
 * grant for the recognitions that follow. Resolves to null when the mic is
 * usable, else the reason: 'insecure-context' (page on plain http — only https
 * or localhost may use the mic), 'NotAllowedError' (blocked), ….
 */
export async function primeMic(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!window.isSecureContext) return 'insecure-context'
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) return 'no-microphone-api'
  try {
    const stream = await md.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop())
    return null
  } catch (e) {
    return (e as DOMException)?.name || String(e)
  }
}

export interface Recorded {
  blob: Blob | null     // null: nobody spoke (or the mic failed — see error)
  mime: string
  note?: string         // what happened, for the robot's log
  error?: string        // a real failure: 'not-allowed', 'insecure-context', …
}

/**
 * Record one spoken phrase for the robot to transcribe with Whisper
 * (listen events with capture='whisper').
 *
 * Voice activity from the mic level (WebAudio RMS): the first 0.3 s set the
 * room's noise floor; speech is a level well above it. Recording stops
 * `silenceSec` after the speech ends, or at `maxSec`; when nobody speaks within
 * `maxSec` the blob is null, so silence is not sent to Whisper (which tends to
 * invent words for it).
 */
export async function recordPhrase(maxSec = 8, silenceSec = 1.5): Promise<Recorded> {
  if (typeof window === 'undefined') return { blob: null, mime: '', error: 'no window' }
  if (!window.isSecureContext) return { blob: null, mime: '', error: 'not-allowed', note: 'insecure-context (http)' }
  const md = navigator.mediaDevices
  if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { blob: null, mime: '', error: 'recording is not supported in this browser' }
  }
  let stream: MediaStream
  try {
    stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    const name = (e as DOMException)?.name || String(e)
    return { blob: null, mime: '', error: name === 'NotAllowedError' ? 'not-allowed' : name }
  }
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) ?? ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }

  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const an = ctx.createAnalyser()
  an.fftSize = 2048
  src.connect(an)
  const buf = new Float32Array(an.fftSize)
  const level = () => {
    an.getFloatTimeDomainData(buf)
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    return Math.sqrt(s / buf.length)
  }

  const t0 = performance.now()
  let floor = 0, floorN = 0, threshold = 0.02
  let spokeAt = 0, lastVoice = 0, peak = 0
  rec.start(250)
  await new Promise<void>(resolve => {
    const tick = () => {
      const now = performance.now(), t = (now - t0) / 1000
      const v = level()
      peak = Math.max(peak, v)
      if (t < 0.3) {                       // calibrate on the room's noise
        floor += v; floorN++
        threshold = Math.max(0.015, (floor / floorN) * 3)
      } else if (v > threshold) {
        if (!spokeAt) spokeAt = now
        lastVoice = now
      }
      const silentFor = spokeAt ? (now - lastVoice) / 1000 : 0
      if (t >= maxSec || (spokeAt && silentFor >= silenceSec)) { resolve(); return }
      setTimeout(tick, 50)
    }
    setTimeout(tick, 50)
  })
  const stopped = new Promise<void>(r => { rec.onstop = () => r() })
  rec.stop()
  await stopped
  stream.getTracks().forEach(t => t.stop())
  ctx.close().catch(() => {})

  const secs = ((performance.now() - t0) / 1000).toFixed(1)
  if (!spokeAt) {
    return { blob: null, mime: rec.mimeType,
             note: `recorded ${secs} s, no speech (peak level ${peak.toFixed(3)} < ${threshold.toFixed(3)})` }
  }
  return { blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), mime: rec.mimeType || 'audio/webm' }
}
