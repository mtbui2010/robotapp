'use client'
import { useEffect, useMemo, useRef, useState } from 'react'

// Map the UI lang selector to a BCP-47 tag for speech synthesis.
// Local mirror of AgentPanel's langToBcp47 (kept self-contained).
function langToBcp47(lang: string): string {
  const map: Record<string, string> = { en: 'en-US', ko: 'ko-KR', vi: 'vi-VN' }
  if (map[lang]) return map[lang]
  if (lang.includes('-')) return lang
  return lang
}

interface UseVoiceOutputOptions {
  enabled: boolean
  lang: string
}

// Localized "still working" nudge, repeated while a long step runs so the
// operator knows the robot is alive. Mirrors the backend phrasebook's tone
// (robot_agent/core/planning/announcer.py).
const STILL_WORKING: Record<string, string> = {
  en: 'Still working',
  ko: '진행 중입니다',
  vi: 'Vẫn đang thực hiện',
}

export function stillWorkingPhrase(lang: string): string {
  return STILL_WORKING[lang] ?? STILL_WORKING[lang.split('-')[0]] ?? STILL_WORKING.en
}

interface UseVoiceOutputResult {
  speak: (text: string) => void
  supported: boolean
  /** No installed voice matches the selected language — speech would use a
   *  wrong-sounding fallback voice (commonly the case for ko-KR). */
  missingVoice: boolean
}

/**
 * Speak arbitrary text (e.g. an agent event's `say`) via the browser's
 * Web Speech synthesis. No-op when disabled or unsupported. Cancels any
 * in-flight speech on unmount.
 */
export function useVoiceOutput(opts: UseVoiceOutputOptions): UseVoiceOutputResult {
  const { enabled, lang } = opts

  // Detected after mount, not during render: this app is statically exported, so
  // the prerendered HTML is built with `window` absent. Deriving `supported`
  // while rendering makes the first client render disagree with that HTML, and
  // the stale `disabled` attribute survives hydration — leaving the voice
  // checkbox permanently greyed out. Starting false and flipping in an effect
  // matches the server output, then re-renders normally.
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window)
  }, [])

  // Keep the latest enabled/lang readable inside the stable speak callback.
  const enabledRef = useRef(enabled)
  const langRef = useRef(lang)
  enabledRef.current = enabled
  langRef.current = lang

  // Cancel any queued/in-flight utterances when speech is turned off or on unmount.
  useEffect(() => {
    if (!supported) return
    if (!enabled) window.speechSynthesis.cancel()
    return () => {
      window.speechSynthesis.cancel()
    }
  }, [enabled, supported])

  // Installed voices (populated asynchronously in most browsers).
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!supported) return
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [supported])

  const bcp47 = langToBcp47(lang)
  const base = bcp47.split('-')[0]
  const voice = useMemo(
    () => voices.find(v => v.lang.replace('_', '-') === bcp47)
       ?? voices.find(v => v.lang.replace('_', '-').split('-')[0] === base),
    [voices, bcp47, base]
  )
  // Only meaningful once the voice list has actually loaded.
  const missingVoice = supported && voices.length > 0 && !voice

  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined)
  voiceRef.current = voice

  const speakRef = useRef<(text: string) => void>(() => {})
  speakRef.current = (text: string) => {
    if (!supported || !enabledRef.current) return
    const trimmed = text.trim()
    if (!trimmed) return
    // Milestones supersede each other: a step can finish while the previous
    // phrase is still playing, and queueing would drift further behind the
    // robot with every step. Speak the newest one instead.
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.lang = langToBcp47(langRef.current)
    if (voiceRef.current) utterance.voice = voiceRef.current
    window.speechSynthesis.speak(utterance)
  }

  // Stable identity so consumers can list it in effect deps without re-firing.
  const speak = useMemo(() => (text: string) => speakRef.current(text), [])

  return { speak, supported, missingVoice }
}

export default useVoiceOutput
