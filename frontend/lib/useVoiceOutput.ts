'use client'
import { useEffect, useMemo, useRef } from 'react'

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

interface UseVoiceOutputResult {
  speak: (text: string) => void
  supported: boolean
}

/**
 * Speak arbitrary text (e.g. an agent event's `say`) via the browser's
 * Web Speech synthesis. No-op when disabled or unsupported. Cancels any
 * in-flight speech on unmount.
 */
export function useVoiceOutput(opts: UseVoiceOutputOptions): UseVoiceOutputResult {
  const { enabled, lang } = opts

  const supported = useMemo(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
    []
  )

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

  const speakRef = useRef<(text: string) => void>(() => {})
  speakRef.current = (text: string) => {
    if (!supported || !enabledRef.current) return
    const trimmed = text.trim()
    if (!trimmed) return
    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.lang = langToBcp47(langRef.current)
    window.speechSynthesis.speak(utterance)
  }

  // Stable identity so consumers can list it in effect deps without re-firing.
  const speak = useMemo(() => (text: string) => speakRef.current(text), [])

  return { speak, supported }
}

export default useVoiceOutput
