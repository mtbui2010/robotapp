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
  const map: Record<string, string> = { en: 'en-US', ko: 'ko-KR', vi: 'vi-VN' }
  if (!lang) return 'ko-KR'
  return map[lang] ?? lang
}

// Resolves once the line has been spoken (or immediately if speech synthesis is
// unavailable), so a following listen does not transcribe the robot's own voice.
export function speakAndWait(text: string, lang?: string | null): Promise<void> {
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
    // Chrome occasionally never fires `end` for an utterance; cap the wait so a
    // lost event cannot stall the listen queued behind it.
    const cap = setTimeout(resolve, Math.min(30_000, 2_000 + t.length * 150))
    u.onend = () => { clearTimeout(cap); resolve() }
    u.onerror = () => { clearTimeout(cap); resolve() }
    window.speechSynthesis.speak(u)
  })
}

interface RecognitionResults {
  length: number
  [i: number]: { 0: { transcript: string } }
}
interface RecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((e: { results: RecognitionResults }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => RecognitionLike

export interface Heard {
  text: string
  error?: string        // a real failure (mic blocked, unsupported), not silence
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
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.continuous = false

    let text = ''
    let error: string | undefined
    let done = false
    const cap = setTimeout(() => { try { rec.stop() } catch { /* already ended */ } }, maxSec * 1000)
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(cap)
      resolve(error ? { text: text.trim(), error } : { text: text.trim() })
    }
    rec.onresult = e => {
      const parts: string[] = []
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript)
      text = parts.join(' ')
    }
    rec.onerror = e => {
      // 'no-speech' / 'aborted' just mean nobody talked — not a failure.
      if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') error = e.error
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
