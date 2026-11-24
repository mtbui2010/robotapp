'use client'
import { useState, useEffect, useRef } from 'react'
import { ExpandEditor } from './ExpandEditor'
import type { Lang } from '../lib/types'
import type { PlannerMethod } from '../lib/planner'
import RecordAudioToggles from './RecordAudioToggles'
import PopoverButton from './PopoverButton'
import { splitPlans } from '../lib/planSequence'

const LS_CELLS   = 'robotapp_cells'
const LS_LOG_DATA = 'robotapp_log_data'
const LS_LOG_TARGET = 'robotapp_log_target'   // 'backend' | 'frontend'
const LS_LOG_ALL    = 'robotapp_log_all'      // '1' = every run, '0' = failed cases only
const LS_REPEAT_MODE = 'robotapp_repeat_mode' // 'once' | 'n' | 'forever'
const LS_REPEAT_N    = 'robotapp_repeat_n'
const LS_REPEAT_COE  = 'robotapp_repeat_continue_on_error'
const LS_PRESETS_S = 'robotapp_presets_structured'   // saved plan presets (Structured step editor)

interface Preset { name: string; text: string }

function loadPresets(key: string): Preset[] {
  try {
    const a = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(a) ? a.filter(p => p && typeof p.name === 'string') : []
  } catch { return [] }
}

// Reusable "saved presets" bar: pick / save / rename / delete a named snippet.
function PresetBar({
  label, presets, setPresets, lsKey, selected, setSelected, current, onLoad, onOpenGuide,
}: {
  label: string
  presets: Preset[]
  setPresets: (p: Preset[]) => void
  lsKey: string
  selected: string
  setSelected: (s: string) => void
  current: () => string
  onLoad: (text: string) => void
  onOpenGuide?: () => void           // an item of the ⋯ menu
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
  // ✎: the selected preset under a new name; its text as saved (not the input), its place in the list kept
  const rename = () => {
    if (!selected) return
    const name = window.prompt(`Rename preset "${selected}" to:`, selected)?.trim()
    if (!name || name === selected) return
    if (presets.some(p => p.name === name)) { alert(`A preset named "${name}" already exists.`); return }
    persist(presets.map(p => p.name === selected ? { ...p, name } : p))
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

  const item = 'text-left px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent whitespace-nowrap'
  return (
    <div className="flex items-center gap-1 text-[11px] shrink-0">
      {/* One control: the select says "Presets" when nothing is chosen (the label and the "— saved —" box were two); 72 px, the dropdown list and the tooltip show the full names */}
      <select value={selected} onChange={e => onSelect(e.target.value)} aria-label={label}
        title={selected ? `${selected} — load a saved preset into the input` : 'Load a saved preset into the input'}
        className="bg-white border border-gray-300 text-gray-800 rounded px-1 py-0.5 w-[72px]">
        <option value="">{label}</option>
        {[...presets]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
          .map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      <PopoverButton label="⋯" title="Save, rename, delete, export or import presets · Guide" testId="presets-menu"
        buttonClass="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 font-bold leading-none">
        {close => (
          <div className="flex flex-col">
            <button type="button" className={item} title="Save the current input as a preset" onClick={() => { close(); save() }}>💾 Save as…</button>
            <button type="button" className={item} disabled={!selected} title="Rename the selected preset" onClick={() => { close(); rename() }}>✎ Rename</button>
            <button type="button" className={`${item} text-red-600`} disabled={!selected} title="Delete the selected preset and clear the input" onClick={() => { close(); del() }}>🗑 Delete</button>
            <button type="button" className={item} title="Export all presets to a JSON file" onClick={() => { close(); exportPresets() }}>⤓ Export</button>
            <button type="button" className={item} title="Import presets from a JSON file (merge, overwrite on name clash)" onClick={() => { close(); fileRef.current?.click() }}>⤒ Import</button>
            {onOpenGuide && <>
              <div className="my-1 border-t border-gray-200" />
              <button type="button" className={item} onClick={() => { close(); onOpenGuide() }}>? Guide</button>
            </>}
          </div>
        )}
      </PopoverButton>
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} className="hidden" />
    </div>
  )
}

function loadCells(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_CELLS) || '["","","",""]') }
  catch { return ['', '', '', ''] }
}

interface Props {
  toolbarExtra?: React.ReactNode    // shown before Run / Stop (the page's voice toggle and Guide)
  running: boolean
  lang: Lang                       // the app's one language (Agent runs and Q&A), picked in the page's control bar
  onRun: (plan: string, direct: boolean, lang?: string, planner?: PlannerMethod, planOnly?: boolean, logData?: boolean, logTarget?: 'backend' | 'frontend', repeatTimes?: number, continueOnError?: boolean, logAll?: boolean) => void
  onStop: () => void
  stopText?: string   // 'Stop' / 'Stopping…' / 'Force reset' (same flow as the other Cancel buttons)
  recordEnabled: boolean
  onToggleRecord: (on: boolean) => void
  manualRecording: boolean
  onToggleManualRecord: () => void
  backendLogDir: string
  trial: number
  onOpenGuide?: () => void           // the ⋯ menu's Guide item (the page owns the Guide dialog)
}

export default function AgentPanel({ toolbarExtra, running, lang, onRun, onStop, stopText, recordEnabled, onToggleRecord, manualRecording, onToggleManualRecord, backendLogDir, trial, onOpenGuide }: Props) {
  const [cells,      setCells]      = useState<string[]>(['', '', '', ''])
  const [activeCell, setActiveCell] = useState(0)
  const [logData,    setLogData]    = useState(true)
  const [logTarget,  setLogTarget]  = useState<'backend' | 'frontend'>('frontend')
  const [logAll,     setLogAll]     = useState(false)  // false → keep failed cases only
  // Repeat execution of a structured plan: once / N times / forever.
  const [repeatMode, setRepeatMode] = useState<'once' | 'n' | 'forever'>('once')
  const [repeatN,    setRepeatN]    = useState(2)
  const [repeatCOE,  setRepeatCOE]  = useState(false)   // continue looping on failure

  // Saved presets of the Structured step editor — picked from a dropdown, edited via Save/Del
  const [structPresets,  setStructPresets]  = useState<Preset[]>([])
  const [structSel,      setStructSel]      = useState('')

  useEffect(() => {
    setCells(loadCells())
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
  }, [])

  const updateCell = (i: number, val: string) => {
    setCells(prev => {
      const next = [...prev]
      next[i] = val
      localStorage.setItem(LS_CELLS, JSON.stringify(next))
      return next
    })
  }

  // Repeat only applies to structured plan execution (the Plan-presets row).
  const repeatTimes = repeatMode === 'once' ? 1 : repeatMode === 'forever' ? Infinity : Math.max(1, repeatN)
  const updateRepeatMode = (v: 'once' | 'n' | 'forever') => { setRepeatMode(v); localStorage.setItem(LS_REPEAT_MODE, v) }
  const updateRepeatN = (v: number) => { setRepeatN(v); localStorage.setItem(LS_REPEAT_N, String(v)) }
  const updateRepeatCOE = (v: boolean) => { setRepeatCOE(v); localStorage.setItem(LS_REPEAT_COE, v ? '1' : '0') }

  // Structured mode runs the ACTIVE cell (blue border) — editing a cell through
  // its ⤢ editor makes it active too, else Run would send another cell's plan.
  // A cell with `---` lines is a sequence of plans: the first runs now, the next ones when you click Next (the bar in the plan panel).
  const nPlans = splitPlans(cells[activeCell]).length
  const run = () => onRun(cells[activeCell], true, lang, undefined, undefined, logData, logTarget, repeatTimes, repeatCOE, logAll)

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

  // Cells 2-3 are about two lines tall and cell 1 about five: a preset loaded into a
  // Cells 2-4 are one line tall and cell 1 about four: a preset loaded into a
  // small cell left six hidden steps under the visible one, and they ran with
  // whatever was typed there. Show how many steps a cell really holds.
  const stepsIn = (text: string) => text.split('\n').filter(l => l.includes('::')).length
  const stepBadge = (i: number, visible: number, cls: string) => {
    const n = stepsIn(cells[i])
    return n > visible ? (
      <span title={cells[i]}
        className={`absolute ${cls} text-[10px] leading-none px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 pointer-events-auto cursor-help`}>
        {n} steps
      </span>
    ) : null
  }

  const cellClass = (i: number) =>
    // text-[11px] = 80 % of text-sm (2026-10-27, as the Plan / Execution blocks)
    `w-full h-full min-h-0 block bg-white text-gray-800 text-[11px] font-mono px-2 py-1 placeholder-gray-300 focus:outline-none resize-none border rounded ${
      activeCell === i ? 'border-blue-500' : 'border-gray-300'
    }`

  return (
    <div className="flex flex-col gap-1">

      {/* Capture row — logging + screen recording, and Run / Stop at its end (free-text commands go through the 💬 Chat card) */}
      <div className="flex items-center gap-2 text-[11px] text-gray-600 whitespace-nowrap min-w-0">
        <PresetBar
              label="Presets"
              presets={structPresets} setPresets={setStructPresets} lsKey={LS_PRESETS_S}
              selected={structSel} setSelected={setStructSel}
              current={() => cells[activeCell]}
              onLoad={t => updateCell(activeCell, t)}
              onOpenGuide={onOpenGuide}
            />
        <span className="w-px h-4 bg-gray-200 shrink-0" />
        <label className="flex items-center gap-1 cursor-pointer"
          title="Save rgb / depth / detection results of this run">
          <input type="checkbox" checked={logData}
            onChange={e => updateLogData(e.target.checked)} className="accent-blue-600" />
          log
        </label>
        {logData && (
          <PopoverButton label="▾" title="Log options: where it is saved, which runs" testId="log-options"
            buttonClass="px-1 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 leading-none" panelClass="w-64">
            {() => (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-10">save in</span>
                  <div className="inline-flex rounded border border-gray-300 overflow-hidden">
                    {(['backend', 'frontend'] as const).map(t => (
                      <button key={t} type="button" onClick={() => updateLogTarget(t)}
                        title={t === 'backend'
                          ? 'Save on the backend server (files written under ~/.kcare_robot/vision_logs)'
                          : 'Save each capture to this browser’s download folder, one folder per run'}
                        className={`px-1.5 py-0.5 ${logTarget === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                      >{t}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-10">runs</span>
                  <div className="inline-flex rounded border border-gray-300 overflow-hidden">
                    {([['all', true], ['failed only', false]] as const).map(([label, v]) => (
                      <button key={label} type="button" onClick={() => updateLogAll(v)}
                        title={v ? 'Log every run' : 'Keep only runs that failed — a step returning isdone False, an error, or a SAGE symbolic violation'}
                        className={`px-1.5 py-0.5 ${logAll === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                {logTarget === 'backend' && backendLogDir && (
                  <span className="text-[10px] text-gray-400 font-mono break-all" title={backendLogDir}>→ {backendLogDir}</span>
                )}
              </div>
            )}
          </PopoverButton>
        )}
        <label className="flex items-center gap-1 cursor-pointer"
          title="Record the screen for the working session — downloads a .webm when the plan ends">
          <input type="checkbox" checked={recordEnabled}
            onChange={e => onToggleRecord(e.target.checked)} className="accent-blue-600" />
          rec screen
        </label>
        <RecordAudioToggles />
        <button type="button" onClick={onToggleManualRecord}
          title={manualRecording ? 'Stop recording and save the .webm' : 'Start a manual screen recording (click again to stop & save)'}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${
            manualRecording
              ? 'border-red-300 bg-red-50 text-red-600'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}>
          <span className={manualRecording ? 'animate-pulse' : ''}>{manualRecording ? '⏹' : '⏺'}</span>
          {manualRecording && 'stop'}
        </button>
        {/* Repeat execution: ×1 / ×N / ∞ */}
        <div className="flex items-center gap-1 text-[11px] text-gray-600 shrink-0">
          {running && repeatMode !== 'once' && (
            <span className="text-blue-600 font-mono tabular-nums" title="Current trial / total">
              {trial}{repeatMode === 'n' ? `/${Math.max(1, repeatN)}` : ''}
            </span>
          )}
          <select
            value={repeatMode}
            onChange={e => updateRepeatMode(e.target.value as 'once' | 'n' | 'forever')}
            title="Repeat execution: how many times to run the plan (×1 / ×N / ∞)"
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
        <div className="ml-auto flex items-center gap-2">
          {toolbarExtra}
          {running
            ? <button onClick={onStop}
                className="px-4 py-1 bg-red-600 hover:bg-red-500 text-white text-sm rounded">{stopText ?? 'Stop'}</button>
            : <button onClick={run} data-testid="run-button"
                title={`Run cell ${activeCell + 1} (the one with the blue border) · click a cell to select · Ctrl+Enter = run` + (nPlans > 1 ? ` · ${nPlans} plans separated by --- lines: the first runs now, a click on Next runs each following one (repeat "forever" runs each plan once)` : '')}
                className="px-4 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded">{nPlans > 1 ? `Run (${nPlans} plans)` : 'Run'}</button>
          }
        </div>
      </div>

      {/* Input area */}
      {(
        <div className="flex flex-col gap-1">
          {/* 2 lines of the 11px mono text: 40px (2/3 of the 60px of 3 lines, 2026-11-13); a longer plan scrolls, ⤢ opens the whole cell */}
          <div className="grid grid-cols-[3fr_2fr] grid-rows-1 gap-2" style={{ height: '40px' }}>
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
              {stepBadge(0, 3, 'bottom-1 right-1')}
              <ExpandEditor
                value={cells[0]}
                onChange={v => { setActiveCell(0); updateCell(0, v) }}
                title="Cell 1"
                className="absolute top-1 right-1 text-[11px] leading-none text-gray-400 hover:text-blue-600 bg-white/85 rounded px-1 py-0.5"
              />
            </div>
            <div className="relative h-full min-h-0">
              <textarea
                rows={1}
                value={cells[1]}
                onChange={e => updateCell(1, e.target.value)}
                onFocus={() => setActiveCell(1)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}
                placeholder="skill::params"
                className={cellClass(1)}
              />
              {stepBadge(1, 3, 'bottom-1 right-1')}
              <ExpandEditor
                value={cells[1]}
                onChange={v => { setActiveCell(1); updateCell(1, v) }}
                title="Cell 2"
                className="absolute top-1 right-1 text-[11px] leading-none text-gray-400 hover:text-blue-600 bg-white/85 rounded px-1 py-0.5"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
