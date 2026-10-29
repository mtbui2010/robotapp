'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { speakAndWait } from '../lib/hriVoice'

// Shared "Fields ⇄ JSON" config editing used by both the per-skill configs
// (SkillPanel) and the Global Configs (EnvPanel). The Fields view flattens a
// config object into editable leaf params keyed by dot-path; edits are pushed
// back as a JSON string so callers keep a single source of truth and unchanged
// save/validate logic.

export type ConfigView = 'fields' | 'json'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Flatten a config object into leaf params keyed by dot-path. Arrays are leaves.
function flattenLeaves(obj: Record<string, unknown>, prefix = ''): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (isPlainObject(v)) out.push(...flattenLeaves(v, path))
    else out.push({ path, value: v })
  }
  return out
}

// Immutably set a value at a dot-path (JSON clone — config is plain JSON).
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  let cur = clone as Record<string, unknown>
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isPlainObject(cur[keys[i]])) cur[keys[i]] = {}          // a new param under a new object
    cur = cur[keys[i]] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]] = value
  return clone
}

// Immutably remove the value at a dot-path; parent objects left empty go too.
function removeByPath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const keys = path.split('.')
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  const chain: Record<string, unknown>[] = [clone]
  for (let i = 0; i < keys.length - 1; i++) {
    const next = chain[i][keys[i]]
    if (!isPlainObject(next)) return clone
    chain.push(next)
  }
  delete chain[keys.length - 1][keys[keys.length - 1]]
  for (let i = keys.length - 2; i >= 0; i--) {
    if (Object.keys(chain[i + 1]).length === 0) delete chain[i][keys[i]]
  }
  return clone
}

// The typed value of a new param: JSON when it parses (0.3, true, [1, 2], {"dx": 0}), else the text.
function parseValue(t: string): unknown {
  try { return JSON.parse(t) } catch { return t }
}

// "+ param" row: a dot-path (dforward, placepose.dz) and a value.
function AddParamRow({ obj, onAdd }: { obj: Record<string, unknown>; onAdd: (path: string, v: unknown) => void }) {
  const [path, setPath] = useState('')
  const [val, setVal] = useState('')
  const p = path.trim()
  let err = ''
  if (p) {
    if (p.split('.').some(k => !k)) err = 'empty key in the path'
    else {
      let cur: unknown = obj
      const keys = p.split('.')
      for (let i = 0; i < keys.length; i++) {
        if (!isPlainObject(cur)) { err = `${keys.slice(0, i).join('.')} is not an object`; break }
        if (!(keys[i] in cur)) break
        if (i === keys.length - 1) err = 'already there — edit it above'
        cur = cur[keys[i]]
      }
    }
  }
  const add = () => {
    if (!p || err) return
    onAdd(p, parseValue(val.trim()))
    setPath(''); setVal('')
  }
  return (
    <div className="flex items-center gap-1 text-[11px] pt-1">
      <input value={path} onChange={e => setPath(e.target.value)} placeholder="+ param (e.g. dforward, placepose.dz)"
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className={`bg-white border rounded px-1.5 py-0.5 font-mono flex-1 min-w-0 focus:outline-none ${
          err ? 'border-red-400' : 'border-gray-200 focus:border-blue-400'}`} />
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="value: 0.3, true, [1,2], text"
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono w-32 focus:outline-none focus:border-blue-400" />
      <button type="button" onClick={add} disabled={!p || !!err} title={err || 'Add this param'}
        className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40">Add</button>
      {err && <span className="text-[10px] text-red-500">{err}</span>}
    </div>
  )
}

// One editable row for a single leaf param — input type follows the value type.
function FieldRow({ path, value, onChange }: { path: string; value: unknown; onChange: (v: unknown) => void }) {
  const label = <span className="font-mono text-gray-600 break-all flex-1 min-w-0" title={path}>{path}</span>

  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[11px] py-0.5">
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
        {label}
      </label>
    )
  }
  if (typeof value === 'number') {
    // HRI_CONFIGS.speech_rate / speech_rate_en: a slider, and a button to hear a sample line at that rate (not saved yet).
    const isRate = /(^|\.)speech_rate(_en)?$/.test(path)       // speech_rate_en: English lines
    if (isRate) {
      // A slider (0.5–2.0, the backend's clamp) + the value + ▶ to hear a sample at it.
      return (
        <label className="flex items-center gap-2 text-[11px] py-0.5">
          {label}
          <input
            type="range" min={0.5} max={2} step={0.05} value={value}
            onChange={e => onChange(Math.round(e.target.valueAsNumber * 100) / 100)}
            className="w-28 accent-blue-600"
          />
          <span className="font-mono w-9 text-right text-gray-700">{value.toFixed(2)}</span>
          <button
            type="button"
            title="Hear a sample line at this rate (1 = normal) — Save to keep it"
            onClick={e => {
              e.preventDefault()
              window.speechSynthesis?.cancel()
              if (path.endsWith('_en')) void speakAndWait('Hello. I will speak at this rate. How can I help you?', 'en', value)
              else void speakAndWait('안녕하세요. 이 속도로 말씀드릴게요. 무엇을 도와드릴까요?', 'ko', value)
            }}
            className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100"
          >
            ▶
          </button>
        </label>
      )
    }
    return (
      <label className="flex items-center gap-2 text-[11px] py-0.5">
        {label}
        <input
          type="number" step="any" defaultValue={value}
          onChange={e => { const n = e.target.valueAsNumber; if (!Number.isNaN(n)) onChange(n) }}
          className="bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono w-28 focus:outline-none focus:border-blue-400"
        />
      </label>
    )
  }
  if (typeof value === 'string') {
    return (
      <label className="flex items-center gap-2 text-[11px] py-0.5">
        {label}
        <input
          type="text" value={value} onChange={e => onChange(e.target.value)}
          className="bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono flex-1 min-w-0 focus:outline-none focus:border-blue-400"
        />
      </label>
    )
  }
  // array / null / other → edit as inline JSON; only commit when it parses.
  return <JsonLeafRow path={path} value={value} onChange={onChange} label={label} />
}

function JsonLeafRow({
  path, value, onChange, label,
}: { path: string; value: unknown; onChange: (v: unknown) => void; label: ReactNode }) {
  const [text, setText] = useState(JSON.stringify(value))
  const [err, setErr] = useState(false)
  return (
    <div className="flex items-center gap-2 text-[11px] py-0.5" key={path}>
      {label}
      <input
        type="text" value={text} spellCheck={false}
        onChange={e => {
          const t = e.target.value
          setText(t)
          try { onChange(JSON.parse(t)); setErr(false) } catch { setErr(true) }
        }}
        className={`bg-white border rounded px-1.5 py-0.5 font-mono flex-1 min-w-0 focus:outline-none ${
          err ? 'border-red-400' : 'border-gray-200 focus:border-blue-400'
        }`}
      />
    </div>
  )
}

// Form view over a config JSON string. Parses internally; pushes edits back as JSON text.
// `skipLeaf` hides params another editor owns (EnvPanel shows ENV aliases /
// label in its own Location names block).
export function ConfigFieldsEditor({
  text, onChange, skipLeaf, filter: outerFilter, editKeys = false,
}: {
  text: string; onChange: (t: string) => void; skipLeaf?: (path: string) => boolean
  filter?: string     // the panel's search box; replaces this editor's own filter while set
  editKeys?: boolean  // × per param and a "+ param" row (ENV locations)
}) {
  const [ownFilter, setFilter] = useState('')
  const filter = outerFilter || ownFilter
  let parsed: Record<string, unknown> | null = null
  let parseErr = ''
  try {
    const v = JSON.parse(text)
    if (isPlainObject(v)) parsed = v
    else parseErr = 'Config is not a JSON object — use JSON view.'
  } catch { parseErr = 'Invalid JSON — switch to JSON view to fix.' }

  if (parseErr) {
    return (
      <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
        {parseErr}
      </div>
    )
  }

  const leaves = flattenLeaves(parsed!).filter(l => !skipLeaf?.(l.path))
  const q = filter.trim().toLowerCase()
  const shown = q ? leaves.filter(l => l.path.toLowerCase().includes(q)) : leaves
  const update = (p: string, v: unknown) => onChange(JSON.stringify(setByPath(parsed!, p, v), null, 2))

  return (
    <div className="flex flex-col gap-1 bg-white border border-gray-200 rounded p-2">
      {leaves.length > 8 && !outerFilter && (
        <input
          value={filter} onChange={e => setFilter(e.target.value)}
          placeholder={`Filter ${leaves.length} params…`}
          className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-[11px] placeholder-gray-400 focus:outline-none focus:border-blue-400"
        />
      )}
      <div className="flex flex-col gap-0.5 max-h-72 overflow-y-auto divide-y divide-gray-100">
        {shown.map(l => editKeys ? (
          <div key={l.path} className="flex items-center gap-1">
            <div className="flex-1 min-w-0">
              <FieldRow path={l.path} value={l.value} onChange={v => update(l.path, v)} />
            </div>
            <button type="button" title={`Remove ${l.path}`}
              onClick={() => onChange(JSON.stringify(removeByPath(parsed!, l.path), null, 2))}
              className="text-gray-400 hover:text-red-500 px-1 text-[12px] leading-none">×</button>
          </div>
        ) : <FieldRow key={l.path} path={l.path} value={l.value} onChange={v => update(l.path, v)} />)}
        {shown.length === 0 && q && <span className="text-[10px] text-gray-400 py-1">No params match “{filter}”.</span>}
      </div>
      {editKeys && <AddParamRow obj={parsed!} onAdd={(p, v) => update(p, v)} />}
    </div>
  )
}
