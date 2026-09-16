'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'

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
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] as Record<string, unknown>
  cur[keys[keys.length - 1]] = value
  return clone
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
export function ConfigFieldsEditor({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const [filter, setFilter] = useState('')
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

  const leaves = flattenLeaves(parsed!)
  const q = filter.trim().toLowerCase()
  const shown = q ? leaves.filter(l => l.path.toLowerCase().includes(q)) : leaves
  const update = (p: string, v: unknown) => onChange(JSON.stringify(setByPath(parsed!, p, v), null, 2))

  return (
    <div className="flex flex-col gap-1 bg-white border border-gray-200 rounded p-2">
      {leaves.length > 8 && (
        <input
          value={filter} onChange={e => setFilter(e.target.value)}
          placeholder={`Filter ${leaves.length} params…`}
          className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-[11px] placeholder-gray-400 focus:outline-none focus:border-blue-400"
        />
      )}
      <div className="flex flex-col gap-0.5 max-h-72 overflow-y-auto divide-y divide-gray-100">
        {shown.map(l => <FieldRow key={l.path} path={l.path} value={l.value} onChange={v => update(l.path, v)} />)}
        {shown.length === 0 && <span className="text-[10px] text-gray-400 py-1">No params match “{filter}”.</span>}
      </div>
    </div>
  )
}
