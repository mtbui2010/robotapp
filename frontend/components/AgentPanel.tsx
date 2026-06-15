'use client'
import { useState, useEffect, useRef } from 'react'

const LS_CELLS   = 'robotapp_cells'
const LS_PROMPT  = 'robotapp_prompt'
const LS_AUTORUN = 'robotapp_voice_autorun'
const LS_PLANNER = 'robotapp_planner'
const LS_PLAN_ONLY = 'robotapp_plan_only'
const LS_LOG_DATA = 'robotapp_log_data'

// Web Speech API is not in the default DOM lib types.
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { results: { length: number; [i: number]: { 0: { transcript: string } } } }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
}

function loadCells(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_CELLS) || '["","","",""]') }
  catch { return ['', '', '', ''] }
}

// Map the UI lang selector to a BCP-47 tag for speech recognition.
function langToBcp47(lang: string): string {
  const map: Record<string, string> = { en: 'en-US', ko: 'ko-KR', vi: 'vi-VN' }
  if (map[lang]) return map[lang]
  if (lang.includes('-')) return lang
  return lang
}

type PlannerMethod = 'grace' | 'direct'

interface Props {
  running: boolean
  onRun: (plan: string, direct: boolean, lang?: string, planner?: PlannerMethod, planOnly?: boolean, logData?: boolean) => void
  onStop: () => void
  recordEnabled: boolean
  onToggleRecord: (on: boolean) => void
}

export default function AgentPanel({ running, onRun, onStop, recordEnabled, onToggleRecord }: Props) {
  const [mode,       setMode]       = useState<'structured' | 'unstructured'>('structured')
  const [cells,      setCells]      = useState<string[]>(['', '', '', ''])
  const [activeCell, setActiveCell] = useState(0)
  const [prompt,     setPrompt]     = useState('')
  const [lang,       setLang]       = useState('en')
  const [planner,    setPlanner]    = useState<PlannerMethod>('grace')
  const [planOnly,   setPlanOnly]   = useState(true)
  const [logData,    setLogData]    = useState(false)

  // Voice input (Web Speech API) — continuous listening while "from mic" is on
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const keepRef        = useRef(false)  // loop should keep (re)starting recognition
  const autoRunRef     = useRef(false)  // current autoRun, read inside async handlers
  const [fromMic,       setFromMic]       = useState(false)
  const [listening,     setListening]     = useState(false)
  const [autoRun,       setAutoRun]       = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)

  useEffect(() => {
    setCells(loadCells())
    setPrompt(localStorage.getItem(LS_PROMPT) || '')
    const ar = localStorage.getItem(LS_AUTORUN) === '1'
    setAutoRun(ar); autoRunRef.current = ar
    const pm = localStorage.getItem(LS_PLANNER)
    if (pm === 'grace' || pm === 'direct') setPlanner(pm)
    const po = localStorage.getItem(LS_PLAN_ONLY)
    setPlanOnly(po === null ? true : po === '1')
    setLogData(localStorage.getItem(LS_LOG_DATA) === '1')
    setVoiceSupported(
      typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    )
  }, [])

  const updateCell = (i: number, val: string) => {
    setCells(prev => {
      const next = [...prev]
      next[i] = val
      localStorage.setItem(LS_CELLS, JSON.stringify(next))
      return next
    })
  }

  const updatePrompt = (val: string) => {
    setPrompt(val)
    localStorage.setItem(LS_PROMPT, val)
  }

  const run = () => {
    if (mode === 'structured') onRun(cells[activeCell], true, lang, undefined, undefined, logData)
    else onRun(prompt, false, lang, planner, planOnly, logData)
  }

  const updatePlanner = (val: PlannerMethod) => {
    setPlanner(val)
    localStorage.setItem(LS_PLANNER, val)
  }

  const updatePlanOnly = (val: boolean) => {
    setPlanOnly(val)
    localStorage.setItem(LS_PLAN_ONLY, val ? '1' : '0')
  }

  const updateLogData = (val: boolean) => {
    setLogData(val)
    localStorage.setItem(LS_LOG_DATA, val ? '1' : '0')
  }

  const updateAutoRun = (val: boolean) => {
    setAutoRun(val)
    autoRunRef.current = val
    localStorage.setItem(LS_AUTORUN, val ? '1' : '0')
  }

  const startListening = () => {
    const Ctor = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : undefined
    if (!Ctor || recognitionRef.current) return
    const rec = new Ctor()
    rec.lang = langToBcp47(lang)
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.continuous = true
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1]
      const transcript = last[0].transcript.trim()
      if (!transcript) return
      updatePrompt(transcript)
      if (autoRunRef.current) onRun(transcript, false, lang, planner, planOnly, logData)
    }
    rec.onend = () => {
      recognitionRef.current = null
      setListening(false)
      if (keepRef.current) startListening()   // keep listening continuously
    }
    rec.onerror = (ev) => {
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
        keepRef.current = false
        setFromMic(false)
      }
    }
    recognitionRef.current = rec
    setListening(true)
    try { rec.start() } catch { /* already started — ignore */ }
  }

  const stopListening = () => {
    keepRef.current = false
    const rec = recognitionRef.current
    recognitionRef.current = null
    setListening(false)
    rec?.stop()
  }

  // Start/stop the mic based on "from mic" + being in unstructured mode.
  useEffect(() => {
    const shouldListen = fromMic && mode === 'unstructured' && voiceSupported
    keepRef.current = shouldListen
    if (shouldListen) startListening()
    else stopListening()
    return () => { keepRef.current = false; recognitionRef.current?.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMic, mode, voiceSupported])

  const cellClass = (i: number) =>
    `w-full h-full min-h-0 block bg-white text-gray-800 text-sm font-mono px-3 py-1 placeholder-gray-300 focus:outline-none resize-none border rounded ${
      activeCell === i ? 'border-blue-500' : 'border-gray-300'
    }`

  return (
    <div className="flex flex-col gap-1">

      {/* Mode + lang + run row */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 text-sm text-gray-700">
          {(['structured', 'unstructured'] as const).map(m => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="inputMode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-blue-600"
              />
              {m === 'structured' ? 'Structured' : 'Unstructured'}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          <label className="flex items-center gap-1 cursor-pointer"
            title="Save rgb / depth / detection results of this run to the backend">
            <input type="checkbox" checked={logData}
              onChange={e => updateLogData(e.target.checked)} className="accent-blue-600" />
            log data
          </label>
          <label className="flex items-center gap-1 cursor-pointer"
            title="Record the screen for the working session — downloads a .webm when the plan ends">
            <input type="checkbox" checked={recordEnabled}
              onChange={e => onToggleRecord(e.target.checked)} className="accent-blue-600" />
            record screen
          </label>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {mode === 'unstructured' && (
            <select value={planner} onChange={e => updatePlanner(e.target.value as PlannerMethod)}
              title="Planner method for natural-language commands"
              className="bg-white border border-gray-300 text-gray-800 text-sm rounded px-2 py-1">
              <option value="grace">GRACE</option>
              <option value="direct">Direct</option>
            </select>
          )}
          <select value={lang} onChange={e => setLang(e.target.value)}
            className="bg-white border border-gray-300 text-gray-800 text-sm rounded px-2 py-1">
            <option value="en">EN</option>
            <option value="ko">KO</option>
            <option value="vi">VI</option>
          </select>
          {running
            ? <button onClick={onStop}
                className="px-4 py-1 bg-red-600 hover:bg-red-500 text-white text-sm rounded">Stop</button>
            : <button onClick={run}
                className="px-4 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded">Run</button>
          }
        </div>
      </div>

      {/* Input area */}
      {mode === 'structured' ? (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[2fr_1fr] grid-rows-1 gap-2" style={{ height: '90px' }}>
            <textarea
              rows={1}
              value={cells[0]}
              onChange={e => updateCell(0, e.target.value)}
              onFocus={() => setActiveCell(0)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}
              placeholder={'find::apple\nnavigate::kitchen\npick::cup'}
              className={cellClass(0)}
            />
            <div className="flex flex-col gap-1 h-full min-h-0">
              {[1, 2, 3].map(i => (
                <textarea
                  key={i}
                  rows={1}
                  value={cells[i]}
                  onChange={e => updateCell(i, e.target.value)}
                  onFocus={() => setActiveCell(i)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}
                  placeholder="skill::params"
                  className={`${cellClass(i)} flex-1 min-h-0`}
                />
              ))}
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Click cell to select · Ctrl+Enter = run active</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {/* Voice options */}
          <div className="flex items-center gap-4 text-[11px] text-gray-500">
            <label className="flex items-center gap-1.5 cursor-pointer"
              title={voiceSupported ? '' : 'Browser does not support speech recognition'}>
              <input
                type="checkbox"
                checked={fromMic}
                disabled={!voiceSupported}
                onChange={e => setFromMic(e.target.checked)}
                className="accent-blue-600"
              />
              from mic
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer"
              title="Generate the task plan only — do not execute it">
              <input
                type="checkbox"
                checked={planOnly}
                onChange={e => updatePlanOnly(e.target.checked)}
                className="accent-blue-600"
              />
              plan only
            </label>
            {fromMic && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={e => updateAutoRun(e.target.checked)}
                  className="accent-blue-600"
                />
                Auto-run after voice
              </label>
            )}
            {fromMic && !voiceSupported && (
              <span className="text-red-500">Browser does not support speech recognition</span>
            )}
          </div>

          {/* Auto-run hides the input → show listening status instead */}
          {fromMic && autoRun ? (
            <div className="w-full bg-white border border-gray-300 text-sm rounded px-3 py-2 flex items-center gap-2">
              <span className={listening ? 'text-red-600 animate-pulse' : 'text-gray-400'}>🎤</span>
              <span className="text-gray-500">{listening ? 'Listening…' : 'Mic off'}</span>
              {prompt && <span className="text-gray-700 truncate">· {prompt}</span>}
            </div>
          ) : (
            <input
              value={prompt}
              onChange={e => updatePrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder={fromMic ? 'Speak a command — text will appear here…' : 'Command, e.g. "give me the cup"'}
              className="w-full bg-white border border-gray-300 text-gray-800 text-sm rounded px-3 py-2 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          )}
        </div>
      )}

    </div>
  )
}
