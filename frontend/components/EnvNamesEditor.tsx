'use client'
import { useState } from 'react'

// "Location aliases" block of the ENV global config (EnvPanel, Fields view):
// per location its canonical key and its `aliases` as chips (collapsed by default).
// `move::옷장` then reaches `dressroom@main room` — the backend resolver is
// robot_agent/env_names.py, which also refuses on save an alias naming two
// places; the same check runs here so the clash shows on the chip itself.

type Env = Record<string, unknown>
type Spec = Record<string, unknown>

const isPlainObject = (v: unknown): v is Spec =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Mirrors env_names.normalize: NFC, case, whitespace (per `@` segment).
export const normalizeName = (s: string) =>
  s.normalize('NFC').trim().toLowerCase().split('@').map(p => p.split(/\s+/).filter(Boolean).join(' ')).join('@')

const RESERVED = new Set(['home', 'base'])

const aliasesOf = (spec: unknown): string[] =>
  isPlainObject(spec) && Array.isArray(spec.aliases)
    ? spec.aliases.filter((a): a is string => typeof a === 'string')
    : []

// Why each alias is refused, keyed `${key}\u0000${alias}` — env_names.validate_env.
function aliasProblems(env: Env): Map<string, string> {
  const owner = new Map<string, string>()
  for (const key of Object.keys(env)) owner.set(normalizeName(key), key)
  const out = new Map<string, string>()
  for (const [key, spec] of Object.entries(env)) {
    for (const raw of aliasesOf(spec)) {
      const a = normalizeName(raw)
      const id = `${key}\u0000${raw}`
      if (!a) out.set(id, 'empty alias')
      else if (RESERVED.has(a)) out.set(id, `"${a}" is reserved (move::${a})`)
      else {
        const other = owner.get(a)
        if (other !== undefined && other !== key)
          out.set(id, normalizeName(other) === a ? `already the location "${other}"` : `already an alias of "${other}"`)
        else owner.set(a, key)
      }
    }
  }
  return out
}

export function AliasInput({
  aliases, problems, onChange,
}: { aliases: string[]; problems: (a: string) => string | undefined; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const parts = draft.split(',').map(s => s.trim()).filter(Boolean)
    setDraft('')
    const next = [...aliases]
    for (const p of parts)
      if (!next.some(a => normalizeName(a) === normalizeName(p))) next.push(p)
    if (next.length !== aliases.length) onChange(next)
  }
  return (
    <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0 bg-white border border-gray-200 rounded px-1 py-0.5 focus-within:border-blue-400">
      {aliases.map((a, i) => {
        const why = problems(a)
        return (
          <span
            key={`${a}-${i}`}
            title={why}
            className={`inline-flex items-center gap-0.5 rounded px-1 text-[10px] ${
              why ? 'bg-red-50 text-red-700 border border-red-300' : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}
          >
            {a}
            <button
              type="button"
              onClick={() => onChange(aliases.filter((_, j) => j !== i))}
              className="text-gray-400 hover:text-red-500 leading-none"
              aria-label={`Remove alias ${a}`}
            >×</button>
          </span>
        )
      })}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          // Enter / comma add; ignore Enter while an IME (Korean) is composing.
          if ((e.key === 'Enter' || e.key === ',') && !e.nativeEvent.isComposing) {
            e.preventDefault(); commit()
          } else if (e.key === 'Backspace' && draft === '' && aliases.length > 0) {
            onChange(aliases.slice(0, -1))
          }
        }}
        onBlur={commit}
        placeholder="+ alias"
        className="flex-1 min-w-[3rem] text-[11px] font-mono bg-transparent focus:outline-none placeholder-gray-300"
      />
    </div>
  )
}

export function EnvNamesEditor({
  env, onChange, filter = '',
}: { env: Env; onChange: (next: Env) => void; filter?: string }) {
  const [userOpen, setOpen] = useState(false)
  // The panel's search opens the block on the locations whose key or alias matches.
  const q = normalizeName(filter)
  const open = userOpen || !!q
  const shown = Object.entries(env).filter(([key, spec]) =>
    !q || normalizeName(key).includes(q) || aliasesOf(spec).some(a => normalizeName(a).includes(q)))
  const problems = aliasProblems(env)
  const total = Object.values(env).reduce<number>((n, spec) => n + aliasesOf(spec).length, 0)
  const setAliases = (key: string, next: string[]) => {
    const spec = { ...(env[key] as Spec) }
    if (next.length === 0) delete spec.aliases
    else spec.aliases = next
    onChange({ ...env, [key]: spec })
  }

  return (
    <div className="bg-white border border-gray-200 rounded">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
      >
        <span className="w-3 text-left">{open ? '▾' : '▸'}</span>
        <span className="flex-1 text-left">Location aliases</span>
        {problems.size > 0
          ? <span className="text-red-500">⚠ {problems.size} clash{problems.size > 1 ? 'es' : ''}</span>
          : <span className="text-gray-400">{total}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1 border-t border-gray-100">
          <span className="text-[10px] text-gray-400">
            Other names for the same spot — <span className="font-mono">move::옷장</span>. Enter or comma to add.
          </span>
          {shown.map(([key, spec]) => (
            <div key={key} className="flex flex-col gap-0.5">
              <span className="font-mono text-[10px] text-gray-500 break-all">{key}</span>
              {isPlainObject(spec) ? (
                <AliasInput
                  aliases={aliasesOf(spec)}
                  problems={a => problems.get(`${key}\u0000${a}`)}
                  onChange={next => setAliases(key, next)}
                />
              ) : (
                <span className="font-mono text-[10px] text-gray-400">→ {JSON.stringify(spec)} (edit in JSON)</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
