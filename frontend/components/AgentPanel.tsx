'use client'
import { useState, useEffect, useRef } from 'react'
import { ExpandEditor } from './ExpandEditor'

const LS_CELLS   = 'robotapp_cells'
const LS_PROMPT  = 'robotapp_prompt'
const LS_AUTORUN = 'robotapp_voice_autorun'
const LS_PLANNER = 'robotapp_planner'
const LS_PLAN_ONLY = 'robotapp_plan_only'
const LS_LOG_DATA = 'robotapp_log_data'
const LS_LOG_TARGET = 'robotapp_log_target'   // 'backend' | 'frontend'
const LS_LOG_ALL    = 'robotapp_log_all'      // '1' = every run, '0' = failed cases only
const LS_REPEAT_MODE = 'robotapp_repeat_mode' // 'once' | 'n' | 'forever'
const LS_REPEAT_N    = 'robotapp_repeat_n'
const LS_REPEAT_COE  = 'robotapp_repeat_continue_on_error'
const LS_PRESETS_S = 'robotapp_presets_structured'   // saved plan presets (structured)
const LS_PRESETS_U = 'robotapp_presets_unstructured' // saved command presets (unstructured)

interface Preset { name: string; text: string }

function loadPresets(key: string): Preset[] {
  try {
    const a = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(a) ? a.filter(p => p && typeof p.name === 'string') : []
  } catch { return [] }
}

// Reusable "saved presets" bar: pick / save / delete a named snippet.
function PresetBar({
  label, presets, setPresets, lsKey, selected, setSelected, current, onLoad,
}: {
  label: string
  presets: Preset[]
  setPresets: (p: Preset[]) => void
  lsKey: string
  selected: string
  setSelected: (s: string) => void
  current: () => string
  onLoad: (text: string) => void
}) {
  const persist = (next: Preset[]) => {
    setPresets(next)
    localStorage.setItem(lsKey, JSON.stringify(next))
  }
  const onSelect = (name: string) => {
    setSelected(name)
    const p = presets.find(x => x.name === name)
    if (p) onLoad(p.text)
  }
  const save = () => {
    const text = current()
    if (!text.trim()) { alert('Nothing to save — the input is empty.'); return }
    const name = window.prompt('Save as (name):', selected || '')?.trim()
    if (!name) return
    const exists = presets.some(p => p.name === name)
    if (exists && !window.confirm(`Overwrite preset "${name}"?`)) return
    persist(exists ? presets.map(p => p.name === name ? { name, text } : p)
                   : [...presets, { name, text }])
    setSelected(name)
  }
  const del = () => {
    if (!selected) return
    if (!window.confirm(`Delete preset "${selected}"?`)) return
    persist(presets.filter(p => p.name !== selected))
    setSelected('')
    onLoad('')   // also clear the displayed text
  }

  // Download the presets as a JSON file (filename derived from the bar label).
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const exportPresets = () => {
    if (presets.length === 0) { alert('No presets to export.'); return }
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug || 'presets'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import from a JSON file: merge into the current list, overwriting on name clash.
  const fileRef = useRef<HTMLInputElement | null>(null)
  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''   // allow re-importing the same file later
    if (!file) return
    file.text().then(txt => {
      let parsed: unknown
      try { parsed = JSON.parse(txt) } catch { alert('Import failed — not valid JSON.'); return }
      const incoming = Array.isArray(parsed)
        ? parsed.filter((p): p is Preset =>
            !!p && typeof p.name === 'string' && typeof p.text === 'string')
        : []
      if (incoming.length === 0) { alert('Import failed — no valid presets found.'); return }
      const byName = new Map(presets.map(p => [p.name, p]))
      for (const p of incoming) byName.set(p.name, { name: p.name, text: p.text })
      persist([...byName.values()])
      alert(`Imported ${incoming.length} preset${incoming.length > 1 ? 's' : ''}.`)
    })
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="text-gray-500 shrink-0">{label}</span>
      <select value={selected} onChange={e => onSelect(e.target.value)}
        title="Load a saved preset into the input"
        className="bg-white border border-gray-300 text-gray-800 rounded px-1.5 py-0.5 min-w-[130px]">
        <option value="">— saved —</option>
        {[...presets]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
          .map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      <button type="button" onClick={save} title="Save current input as a preset"
        className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded">Save</button>
      <button type="button" onClick={del} disabled={!selected} title="Delete selected preset and clear the input"
        className="px-1.5 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 rounded disabled:opacity-40">Del</button>
      <button type="button" onClick={exportPresets} title="Export all presets to a JSON file"
        className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded">⤓</button>
      <button type="button" onClick={() => fileRef.current?.click()} title="Import presets from a JSON file (merge, overwrite on name clash)"
        className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded">⤒</button>
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} className="hidden" />
    </div>
  )
}

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
  onRun: (plan: string, direct: boolean, lang?: string, planner?: PlannerMethod, planOnly?: boolean, logData?: boolean, logTarget?: 'backend' | 'frontend', repeatTimes?: number, continueOnError?: boolean, logAll?: boolean) => void
  onStop: () => void
  recordEnabled: boolean
  onToggleRecord: (on: boolean) => void
  manualRecording: boolean
  onToggleManualRecord: () => void
  backendLogDir: string
  trial: number
}

export default function AgentPanel({ running, onRun, onStop, recordEnabled, onToggleRecord, manualRecording, onToggleManualRecord, backendLogDir, trial }: Props) {
  const [mode,       setMode]       = useState<'structured' | 'unstructured'>('structured')
  const [cells,      setCells]      = useState<string[]>(['', '', '', ''])
  const [activeCell, setActiveCell] = useState(0)
  const [prompt,     setPrompt]     = useState('')
  const [lang,       setLang]       = useState('en')
  const [planner,    setPlanner]    = useState<PlannerMethod>('grace')
  const [planOnly,   setPlanOnly]   = useState(true)
  const [logData,    setLogData]    = useState(true)
  const [logTarget,  setLogTarget]  = useState<'backend' | 'frontend'>('frontend')
  const [logAll,     setLogAll]     = useState(false)  // false → keep failed cases only
  // Repeat execution of a structured plan: once / N times / forever.
  const [repeatMode, setRepeatMode] = useState<'once' | 'n' | 'forever'>('once')
  const [repeatN,    setRepeatN]    = useState(2)
  const [repeatCOE,  setRepeatCOE]  = useState(false)   // continue looping on failure

  // Saved presets (per mode) — picked from a dropdown, edited via Save/Del
  const [structPresets,  setStructPresets]  = useState<Preset[]>([])
  const [unstructPresets,setUnstructPresets]= useState<Preset[]>([])
  const [structSel,      setStructSel]      = useState('')
  const [unstructSel,    setUnstructSel]    = useState('')

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
    // Defaults when nothing is stored yet: log data ON, frontend target,
    // failed cases only — capture what matters without filling Downloads.
    setLogData(localStorage.getItem(LS_LOG_DATA) !== '0')
    const lt = localStorage.getItem(LS_LOG_TARGET)
    if (lt === 'backend' || lt === 'frontend') setLogTarget(lt)
    setLogAll(localStorage.getItem(LS_LOG_ALL) === '1')
    const rm = localStorage.getItem(LS_REPEAT_MODE)
    if (rm === 'once' || rm === 'n' || rm === 'forever') setRepeatMode(rm)
    const rn = parseInt(localStorage.getItem(LS_REPEAT_N) || '', 10)
    if (Number.isFinite(rn) && rn >= 1) setRepeatN(rn)
    setRepeatCOE(localStorage.getItem(LS_REPEAT_COE) === '1')
    setStructPresets(loadPresets(LS_PRESETS_S))
    setUnstructPresets(loadPresets(LS_PRESETS_U))
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

  // Repeat only applies to structured plan execution (the Plan-presets row).
  const repeatTimes = repeatMode === 'once' ? 1 : repeatMode === 'forever' ? Infinity : Math.max(1, repeatN)
  const updateRepeatMode = (v: 'once' | 'n' | 'forever') => { setRepeatMode(v); localStorage.setItem(LS_REPEAT_MODE, v) }
  const updateRepeatN = (v: number) => { setRepeatN(v); localStorage.setItem(LS_REPEAT_N, String(v)) }
  const updateRepeatCOE = (v: boolean) => { setRepeatCOE(v); localStorage.setItem(LS_REPEAT_COE, v ? '1' : '0') }

  const run = () => {
    if (mode === 'structured') onRun(cells[activeCell], true, lang, undefined, undefined, logData, logTarget, repeatTimes, repeatCOE, logAll)
    else onRun(prompt, false, lang, planner, planOnly, logData, logTarget, 1, false, logAll)
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

  const updateLogTarget = (val: 'backend' | 'frontend') => {
    setLogTarget(val)
    localStorage.setItem(LS_LOG_TARGET, val)
  }

  const updateLogAll = (val: boolean) => {
    setLogAll(val)
    localStorage.setItem(LS_LOG_ALL, val ? '1' : '0')
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
      if (autoRunRef.current) onRun(transcript, false, lang, planner, planOnly, logData, logTarget, 1, false, logAll)
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

      {/* Capture row — logging + screen recording, kept off the mode/run row so
          neither row grows too wide. */}
      <div className="flex items-center gap-3 text-[11px] text-gray-600">
        <label className="flex items-center gap-1 cursor-pointer"
          title="Save rgb / depth / detection results of this run">
          <input type="checkbox" checked={logData}
            onChange={e => updateLogData(e.target.checked)} className="accent-blue-600" />
          log data
        </label>
        {logData && (
          <div className="inline-flex rounded border border-gray-300 overflow-hidden">
            {(['backend', 'frontend'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => updateLogTarget(t)}
                title={t === 'backend'
                  ? 'Save on the backend server (files written under ~/.kcare_robot/vision_logs)'
                  : 'Save each capture to this browser’s download folder, one folder per run'}
                className={`px-1.5 py-0.5 ${
                  logTarget === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
                }`}
              >{t}</button>
            ))}
          </div>
        )}
        {logData && (
          <div className="inline-flex rounded border border-gray-300 overflow-hidden">
            {([['all', true], ['failed only', false]] as const).map(([label, v]) => (
              <button
                key={label}
                type="button"
                onClick={() => updateLogAll(v)}
                title={v
                  ? 'Log every run'
                  : 'Keep only runs that failed — a step returning isdone False, an error, or a GRACE symbolic violation'}
                className={`px-1.5 py-0.5 ${
                  logAll === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
                }`}
              >{label}</button>
            ))}
          </div>
        )}
        {logData && logTarget === 'backend' && backendLogDir && (
          <span className="text-[10px] text-gray-400 font-mono truncate max-w-[16rem]" title={backendLogDir}>
            → {backendLogDir}
          </span>
        )}
        <label className="flex items-center gap-1 cursor-pointer"
          title="Record the screen for the working session — downloads a .webm when the plan ends">
          <input type="checkbox" checked={recordEnabled}
            onChange={e => onToggleRecord(e.target.checked)} className="accent-blue-600" />
          record screen
        </label>
        <button type="button" onClick={onToggleManualRecord}
          title={manualRecording ? 'Stop recording and save the .webm' : 'Start a manual screen recording (click again to stop & save)'}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${
            manualRecording
              ? 'border-red-300 bg-red-50 text-red-600'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}>
          <span className={manualRecording ? 'animate-pulse' : ''}>{manualRecording ? '⏹' : '⏺'}</span>
          {manualRecording ? 'stop' : 'record'}
        </button>
      </div>

      {/* Input area */}
      {mode === 'structured' ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <PresetBar
              label="Plan presets"
              presets={structPresets} setPresets={setStructPresets} lsKey={LS_PRESETS_S}
              selected={structSel} setSelected={setStructSel}
              current={() => cells[activeCell]}
              onLoad={t => updateCell(activeCell, t)}
            />
            {/* Repeat execution: ×1 / ×N / ∞ — right-aligned on the Plan-presets row */}
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-600 shrink-0">
              <span className="text-gray-500">exec</span>
              {running && repeatMode !== 'once' && (
                <span className="text-blue-600 font-mono tabular-nums" title="Current trial / total">
                  {trial}{repeatMode === 'n' ? `/${Math.max(1, repeatN)}` : ''}
                </span>
              )}
              <select
                value={repeatMode}
                onChange={e => updateRepeatMode(e.target.value as 'once' | 'n' | 'forever')}
                title="How many times to execute the plan"
                className="bg-white border border-gray-300 text-gray-800 rounded px-1 py-0.5"
              >
                <option value="once">×1</option>
                <option value="n">×N</option>
                <option value="forever">∞</option>
              </select>
              {repeatMode === 'n' && (
                <input
                  type="number" min={1} value={repeatN}
                  onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) updateRepeatN(Math.max(1, n)) }}
                  title="Number of executions"
                  className="w-12 bg-white border border-gray-300 text-gray-800 rounded px-1 py-0.5"
                />
              )}
              {repeatMode !== 'once' && (
                <label className="flex items-center gap-1 cursor-pointer" title="Keep looping even if a run fails; default stops on the first failure">
                  <input type="checkbox" checked={repeatCOE} onChange={e => updateRepeatCOE(e.target.checked)} className="accent-blue-600" />
                  keep on error
                </label>
              )}
            </div>
          </div>
          <div className="grid grid-cols-[2fr_1fr] grid-rows-1 gap-2" style={{ height: '90px' }}>
            <div className="relative h-full min-h-0">
              <textarea
                rows={1}
                value={cells[0]}
                onChange={e => updateCell(0, e.target.value)}
                onFocus={() => setActiveCell(0)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}
                placeholder={'find::apple\nnavigate::kitchen\npick::cup'}
                className={cellClass(0)}
              />
              <ExpandEditor
                value={cells[0]}
                onChange={v => updateCell(0, v)}
                title="Cell 1"
                className="absolute top-1 right-1 text-[11px] leading-none text-gray-400 hover:text-blue-600 bg-white/85 rounded px-1 py-0.5"
              />
            </div>
            <div className="flex flex-col gap-1 h-full min-h-0">
              {[1, 2, 3].map(i => (
                <div key={i} className="relative flex-1 min-h-0">
                  <textarea
                    rows={1}
                    value={cells[i]}
                    onChange={e => updateCell(i, e.target.value)}
                    onFocus={() => setActiveCell(i)}
                    onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}
                    placeholder="skill::params"
                    className={cellClass(i)}
                  />
                  <ExpandEditor
                    value={cells[i]}
                    onChange={v => updateCell(i, v)}
                    title={`Cell ${i + 1}`}
                    className="absolute top-0.5 right-0.5 text-[10px] leading-none text-gray-400 hover:text-blue-600 bg-white/85 rounded px-1"
                  />
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Click cell to select · Ctrl+Enter = run active</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <PresetBar
            label="Command presets"
            presets={unstructPresets} setPresets={setUnstructPresets} lsKey={LS_PRESETS_U}
            selected={unstructSel} setSelected={setUnstructSel}
            current={() => prompt}
            onLoad={t => updatePrompt(t)}
          />
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
