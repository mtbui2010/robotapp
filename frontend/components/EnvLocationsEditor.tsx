'use client'
import { useState } from 'react'
import { api } from '../lib/api'
import { readRobotPose } from '../lib/robotPose'
import { ConfigFieldsEditor } from './ConfigFields'
import { normalizeName } from './EnvNamesEditor'

// ENV in the Fields view (EnvPanel): one foldable row per location with its params, and
//   • + Add location — empty (defaults), at the robot's position now (MAP.pose), or a copy of another one;
//   • 🗑 per location — asks first, naming the plan skills / buttons / guides that still say its name;
//     ↶ brings the last one back;
//   • inside a location: × per param and a "+ param" row (add / remove attributes).
// Nothing is saved until the panel's Save; that save only sends what changed (PATCH, merged per location),
// so a location another machine added meanwhile is kept. Aliases are edited in the block above.

type Env = Record<string, unknown>
type Spec = Record<string, unknown>

const isObj = (v: unknown): v is Spec => typeof v === 'object' && v !== null && !Array.isArray(v)
const RESERVED = new Set(['home', 'base'])
const DEFAULT_SPEC: Spec = {
  default_mode: 'front', height: 0.75, loc: { x: 0, y: 0, rz: 0 }, dforward: 0, dshift: 0, placepose: { dx: 0, dy: 0 },
}
const ROBOT = '\u0000robot', DEFAULTS = '\u0000defaults'
const isAliasLeaf = (path: string) => /^aliases$/.test(path)

const aliasesOf = (spec: unknown): string[] =>
  isObj(spec) && Array.isArray(spec.aliases) ? spec.aliases.filter((a): a is string => typeof a === 'string') : []

// Why `name` cannot be a new location's key ('' = fine) — the same rule as the backend's validate_env.
function nameProblem(env: Env, name: string): string {
  const n = normalizeName(name)
  if (!n) return ''
  if (RESERVED.has(n)) return `"${n}" is reserved (move::${n})`
  for (const [key, spec] of Object.entries(env)) {
    if (normalizeName(key) === n) return `"${key}" exists`
    if (aliasesOf(spec).some(a => normalizeName(a) === n)) return `already an alias of "${key}"`
  }
  return ''
}

// Where a location's name or aliases still appear (free text, so only a warning).
async function referencesOf(names: string[]): Promise<string[]> {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const res = names.filter(Boolean).map(n => new RegExp(`(^|[^\\w가-힣])${esc(n)}($|[^\\w가-힣])`, 'i'))
  const hit = (t: unknown) => typeof t === 'string' && res.some(r => r.test(t))
  const out: string[] = []
  const [skills, buttons, guides] = await Promise.all([
    api.listSkills().catch(() => []), api.listButtons().catch(() => []),
    api.listGuides().catch(() => ({ active: null, versions: [] })),
  ])
  for (const s of skills) if (s.type === 'plan' && hit(s.plan)) out.push(`plan skill ${s.name}`)
  for (const b of buttons) if (hit(b.plan)) out.push(`button "${b.label}"`)
  for (const g of guides.versions) if (hit(g.guide)) out.push(`guide ${g.name}`)
  return out
}

const summary = (spec: unknown): string => {
  if (!isObj(spec)) return 'not an object — JSON view'
  const loc = isObj(spec.loc) ? spec.loc : null
  const f = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : '?')
  return [spec.default_mode, typeof spec.height === 'number' ? `h ${spec.height}` : null,
          loc ? `(${f(loc.x)}, ${f(loc.y)}, ${f(loc.rz)}°)` : 'no loc'].filter(Boolean).join(' · ')
}

export function EnvLocationsEditor({ env, onChange, filter = '' }: {
  env: Env; onChange: (env: Env) => void; filter?: string
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [from, setFrom] = useState(DEFAULTS)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleted, setDeleted] = useState<{ key: string; spec: unknown; index: number } | null>(null)
  const q = filter.trim().toLowerCase()
  const keys = Object.keys(env)
  const problem = nameProblem(env, newName)

  const toggle = (k: string) => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const add = async () => {
    const name = newName.trim()
    if (!name || problem) return
    let spec: Spec
    setMsg('')
    if (from === ROBOT) {
      setBusy(true)
      try {
        const p = await readRobotPose()
        spec = { ...JSON.parse(JSON.stringify(DEFAULT_SPEC)),
                 loc: { x: +p.x.toFixed(3), y: +p.y.toFixed(3), rz: +(p.yaw * 180 / Math.PI).toFixed(1) } }
      } catch (e) {
        setMsg(`robot position: ${e instanceof Error ? e.message : e}`); setBusy(false); return
      }
      setBusy(false)
    } else if (from === DEFAULTS || !isObj(env[from])) {
      spec = JSON.parse(JSON.stringify(DEFAULT_SPEC))
    } else {
      // a copy keeps the numbers, not the names (an alias would name two places) nor the place's own qa block
      spec = JSON.parse(JSON.stringify(env[from])) as Spec
      for (const drop of ['aliases', 'label', 'qa', 'source']) delete spec[drop]
    }
    const out: Env = {}
    const after = from !== DEFAULTS && from !== ROBOT && from in env ? from : null
    for (const k of keys) { out[k] = env[k]; if (k === after) out[name] = spec }
    if (!after) out[name] = spec
    onChange(out)
    setOpen(s => new Set(s).add(name))
    setAdding(false); setNewName(''); setFrom(DEFAULTS)
    setMsg(`added "${name}" — set its loc / height, then Save`)
  }

  const remove = async (key: string) => {
    setBusy(true)
    const refs = await referencesOf([key, ...aliasesOf(env[key])]).catch(() => [])
    setBusy(false)
    const text = `Delete the location "${key}"?` +
      (refs.length ? `\n\nIts name is still used in:\n- ${refs.join('\n- ')}\n(those will fail to find it)` : '') +
      '\n\nNothing is saved until you press Save.'
    if (!window.confirm(text)) return
    const out: Env = {}
    keys.forEach(k => { if (k !== key) out[k] = env[k] })
    setDeleted({ key, spec: env[key], index: keys.indexOf(key) })
    onChange(out)
    setMsg('')
  }

  const undoDelete = () => {
    if (!deleted || deleted.key in env) { setDeleted(null); return }
    const ks = Object.keys(env), out: Env = {}
    ks.forEach((k, i) => { if (i === deleted.index) out[deleted.key] = deleted.spec; out[k] = env[k] })
    if (!(deleted.key in out)) out[deleted.key] = deleted.spec
    onChange(out)
    setDeleted(null)
  }

  const shown = q ? keys.filter(k => k.toLowerCase().includes(q) || JSON.stringify(env[k]).toLowerCase().includes(q)) : keys

  return (
    <div className="flex flex-col gap-1 bg-white border border-gray-200 rounded p-2 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500 font-medium">Locations ({keys.length})</span>
        <button type="button" onClick={() => { setAdding(a => !a); setMsg('') }}
          className="ml-auto px-1.5 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100">
          {adding ? 'Cancel' : '+ Add location'}
        </button>
      </div>
      {adding && (
        <div className="flex flex-col gap-1 border border-blue-200 bg-blue-50/40 rounded p-1.5">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="name, e.g. bed@main room"
            onKeyDown={e => { if (e.key === 'Enter') void add() }}
            className={`bg-white border rounded px-1.5 py-0.5 font-mono focus:outline-none ${
              problem ? 'border-red-400' : 'border-gray-200 focus:border-blue-400'}`} />
          {problem && <span className="text-[10px] text-red-500">{problem}</span>}
          <div className="flex items-center gap-1">
            <span className="text-gray-500">start from</span>
            <select value={from} onChange={e => setFrom(e.target.value)}
              className="bg-white border border-gray-200 rounded px-1 py-0.5 flex-1 min-w-0">
              <option value={DEFAULTS}>defaults (front, h 0.75, loc 0 0 0)</option>
              <option value={ROBOT}>the robot&apos;s position now</option>
              {keys.map(k => <option key={k} value={k}>copy of {k}</option>)}
            </select>
            <button type="button" onClick={() => void add()} disabled={!newName.trim() || !!problem || busy}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded">Add</button>
          </div>
        </div>
      )}
      {msg && <span className="text-[10px] text-gray-500">{msg}</span>}
      {deleted && !(deleted.key in env) && (
        <div className="flex items-center gap-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
          <span className="flex-1">deleted &ldquo;{deleted.key}&rdquo; (not saved yet)</span>
          <button type="button" onClick={undoDelete} className="underline">↶ undo</button>
        </div>
      )}
      <div className="flex flex-col divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
        {shown.map(k => {
          const spec = env[k]
          const isOpen = q ? true : open.has(k)
          return (
            <div key={k} className="py-0.5">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => toggle(k)} className="flex items-center gap-1 flex-1 min-w-0 text-left">
                  <span className="text-gray-500 text-[10px] w-3">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-mono text-gray-800 truncate">{k}</span>
                  <span className="text-gray-400 truncate">{summary(spec)}</span>
                </button>
                <button type="button" title={`Delete ${k}`} disabled={busy} onClick={() => void remove(k)}
                  className="text-gray-400 hover:text-red-500 px-1 disabled:opacity-40">🗑</button>
              </div>
              {isOpen && (isObj(spec) ? (
                <div className="pl-4 pt-1">
                  <ConfigFieldsEditor
                    text={JSON.stringify(spec, null, 2)}
                    onChange={t => { try { onChange({ ...env, [k]: JSON.parse(t) }) } catch { /* stays */ } }}
                    skipLeaf={isAliasLeaf}
                    editKeys
                  />
                </div>
              ) : (
                <div className="pl-4 text-[10px] text-gray-500">{JSON.stringify(spec)} — not an object (an old-style entry): edit it in the JSON view</div>
              ))}
            </div>
          )
        })}
        {shown.length === 0 && <span className="text-[10px] text-gray-400 py-1">{q ? `No location matches “${filter}”.` : 'No locations yet.'}</span>}
      </div>
    </div>
  )
}
