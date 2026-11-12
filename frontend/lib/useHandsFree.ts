'use client'
import { useEffect, useRef } from 'react'
import { recognizeOnce, abortRecognition } from './hriVoice'
import { micVerdict, acceptTranscript, trackSpeech, type EchoGuard, type MicSnapshot } from './chatMic'

// The chat's hands-free mic: a loop of ONE-SHOT recognitions (never a continuous recogniser). It listens
// only when chatMic.micVerdict says so (idle, robot silent, guard time passed) and aborts the recognition
// the moment that stops being true. What it hears goes to onHeard unless chatMic.acceptTranscript drops it
// (state changed meanwhile, or an echo of the robot's own line).
export function useHandsFree({ enabled, lang, snapshot, guard, onHeard, onError, onListening }: {
  enabled: boolean
  lang: string
  /** current state, read live: running / waiting / robot speaking (speechSynthesis + the HRI queue) */
  snapshot: () => Omit<MicSnapshot, 'handsFree' | 'lastSpeechAt'>
  guard: EchoGuard
  onHeard: (text: string) => void
  onError: (why: string) => void
  onListening?: (on: boolean) => void
}) {
  const snapRef = useRef(snapshot); snapRef.current = snapshot
  const heardRef = useRef(onHeard); heardRef.current = onHeard
  const errRef = useRef(onError); errRef.current = onError
  const lisRef = useRef(onListening); lisRef.current = onListening

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let lastSpeechAt = 0
    const snap = (): MicSnapshot => {
      const s = snapRef.current()
      lastSpeechAt = trackSpeech(lastSpeechAt, s.speaking, Date.now())
      return { ...s, handsFree: true, lastSpeechAt }
    }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    ;(async () => {
      while (!stopped) {
        const v = micVerdict(snap(), Date.now())
        if (!v.listen) { await sleep(Math.max(100, v.retryMs)); continue }
        // abort the recognition as soon as the mic may no longer be used
        let aborted = false
        const watch = setInterval(() => {
          if (!micVerdict(snap(), Date.now()).listen) { aborted = true; abortRecognition() }
        }, 150)
        lisRef.current?.(true)
        const heard = await recognizeOnce(lang, 8)
        clearInterval(watch)
        lisRef.current?.(false)
        if (stopped) break
        if (heard.error) { errRef.current(heard.error); return }
        const text = heard.text.trim()
        if (text && !aborted && acceptTranscript(snap(), text, guard, Date.now()).accept) heardRef.current(text)
        await sleep(300)
      }
    })()
    return () => { stopped = true; abortRecognition(); lisRef.current?.(false) }
  }, [enabled, lang, guard])
}
