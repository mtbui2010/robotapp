// Mic ownership of the chat (no React; tested in scripts/test_lib.mjs).
//
// One mic owner at a time, half duplex:
//   - hands-free listens for a NEW COMMAND only while the chat is idle, the
//     robot is not speaking, and GUARD_MS have passed since it stopped;
//   - while a run is active, or the robot asks (a pending `listen`), the answer
//     capture of the run (typed / whisper / recognizeOnce) is the only mic user;
//   - a transcript that is very similar to something the robot said in the last
//     ECHO_WINDOW_MS is dropped (the mic heard the speaker).

export const GUARD_MS = 1000
export const ECHO_WINDOW_MS = 10_000
export const ECHO_SIMILARITY = 0.6

export type ChatState = 'idle' | 'running' | 'waiting' | 'stopping'   // stopping: see lib/chatRun.ts
/** waiting = the robot asked and a `listen` is pending; running = executing, not waiting. */
export const chatState = (running: boolean, listenPending: boolean): ChatState =>
  !running ? 'idle' : listenPending ? 'waiting' : 'running'

export type AnswerBy = 'typing' | 'voice'
/** How a pending `listen` is answered. A run started from the chat with the chat's mic OFF is always answered by
 *  typing (the backend's voice / whisper mode is not honoured: no recording, no empty answer posted, wait for the
 *  text; the backend decides when to give up). With the mic ON the backend's mode decides, and a typed answer
 *  still wins. A run not started from the chat (Structured) keeps the backend's mode. */
export const answerBy = (s: { runFromChat: boolean; micOn: boolean; listenMode?: string }): AnswerBy =>
  s.listenMode === 'text' || (s.runFromChat && !s.micOn) ? 'typing' : 'voice'

export interface MicSnapshot {
  handsFree: boolean
  running: boolean          // a run is active (includes waiting for an answer)
  waiting: boolean          // a `listen` is pending: the answer capture owns the mic
  speaking: boolean         // the robot is speaking or has speech queued
  lastSpeechAt: number      // last time speech was seen playing (ms), 0 = never
}

export type MicVerdict =
  | { listen: true }
  | { listen: false; reason: 'off' | 'running' | 'waiting' | 'speaking' | 'guard'; retryMs: number }

export function micVerdict(s: MicSnapshot, now: number): MicVerdict {
  if (!s.handsFree) return { listen: false, reason: 'off', retryMs: 500 }
  if (s.waiting) return { listen: false, reason: 'waiting', retryMs: 250 }
  if (s.running) return { listen: false, reason: 'running', retryMs: 250 }
  if (s.speaking) return { listen: false, reason: 'speaking', retryMs: 250 }
  const since = now - s.lastSpeechAt
  if (s.lastSpeechAt > 0 && since < GUARD_MS) return { listen: false, reason: 'guard', retryMs: GUARD_MS - since }
  return { listen: true }
}

/** The last time speech was seen: `speakingNow` refreshes it. */
export const trackSpeech = (lastSpeechAt: number, speakingNow: boolean, now: number): number =>
  speakingNow ? now : lastSpeechAt

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// Dice coefficient on character bigrams of the text without spaces / punctuation:
// works for English and for Korean (no word spaces to rely on).
export function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const grams = (t: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1) }
    return m
  }
  const gx = grams(x), gy = grams(y)
  let hit = 0
  gx.forEach((n, g) => { hit += Math.min(n, gy.get(g) ?? 0) })
  return (2 * hit) / (x.length - 1 + y.length - 1)
}

export interface EchoGuard {
  note(text: string, now: number): void            // the robot said this
  isEcho(transcript: string, now: number): boolean
}
export function createEchoGuard(windowMs = ECHO_WINDOW_MS, threshold = ECHO_SIMILARITY): EchoGuard {
  let said: Array<{ text: string; at: number }> = []
  return {
    note(text, now) {
      if (!norm(text)) return
      said = said.filter(s => now - s.at <= windowMs).concat({ text, at: now })
    },
    isEcho(transcript, now) {
      const t = norm(transcript)
      if (!t) return false
      return said.some(s => {
        if (now - s.at > windowMs) return false
        const r = norm(s.text)
        // a piece of the robot's sentence ("where is", "the apple") is also an echo
        if (t.length >= 6 && (r.includes(t) || t.includes(r))) return true
        return similarity(s.text, transcript) >= threshold
      })
    },
  }
}

export type Accept = { accept: true } | { accept: false; reason: 'busy' | 'echo' | 'empty' }
/** A transcript of the hands-free mic: dropped when the state changed while it was recognised
 *  (a run started, the robot spoke), when it is empty, or when it echoes the robot. */
export function acceptTranscript(s: MicSnapshot, text: string, guard: EchoGuard, now: number): Accept {
  if (!text.trim()) return { accept: false, reason: 'empty' }
  if (!micVerdict(s, now).listen) return { accept: false, reason: 'busy' }
  if (guard.isEcho(text, now)) return { accept: false, reason: 'echo' }
  return { accept: true }
}
