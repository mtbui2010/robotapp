'use client'
import { useState } from 'react'
import type { SkillDef } from '../lib/types'
import { AliasInput, normalizeName } from './EnvNamesEditor'

// "Skill aliases" block of the Skill panel: per skill its name and its
// `aliases` as chips (collapsed by default), like the Location aliases of the
// ENV config. `라면가져와::신라면` then runs pick_top — the backend resolves
// aliases in SkillRegistry.resolve and refuses on save an alias that is
// another skill's name or alias; the same check runs here so the clash shows
// on the chip itself. Each change is saved at once (PUT /skills/<name>).

// Characters the plan / direct-mode parser gives a meaning to (skill_registry._ALIAS_BAD).
const BAD = /[:&!~#${},='"()\s]/

function problemsOf(skills: SkillDef[]): Map<string, string> {
  const owner = new Map<string, string>()
  for (const s of skills) owner.set(normalizeName(s.name), s.name)
  const out = new Map<string, string>()
  for (const s of skills) {
    for (const raw of s.aliases ?? []) {
      const a = normalizeName(raw)
      const id = `${s.name}\u0000${raw}`
      const bad = raw.trim().replace(/\s+/g, ' ').replace(/ /g, '').match(BAD)
      if (!a) out.set(id, 'empty alias')
      else if (bad) out.set(id, `contains "${bad[0]}"`)
      else if (a === normalizeName(s.name)) continue
      else {
        const other = owner.get(a)
        if (other !== undefined && other !== s.name)
          out.set(id, normalizeName(other) === a ? `already the skill "${other}"` : `already an alias of "${other}"`)
        else owner.set(a, s.name)
      }
    }
  }
  return out
}

export function SkillAliasesEditor({
  skills, onSave, filter = '',
}: {
  skills: SkillDef[]
  onSave: (name: string, aliases: string[]) => Promise<string | null>   // error text or null
  filter?: string
}) {
  const [userOpen, setOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, string[]>>({})   // shown while saving / refused
  const q = normalizeName(filter)
  const open = userOpen || !!q
  const view = skills.map(s => (s.name in pending ? { ...s, aliases: pending[s.name] } : s))
  const shown = view.filter(s =>
    !q || normalizeName(s.name).includes(q) || (s.aliases ?? []).some(a => normalizeName(a).includes(q)))
  const problems = problemsOf(view)
  const total = view.reduce((n, s) => n + (s.aliases?.length ?? 0), 0)

  const change = async (name: string, next: string[]) => {
    setPending(p => ({ ...p, [name]: next }))
    const local = problemsOf(view.map(s => (s.name === name ? { ...s, aliases: next } : s)))
    if ([...local.keys()].some(k => k.startsWith(`${name}\u0000`))) return   // fix the red chip first
    const err = await onSave(name, next)
    setErrors(e => { const n = { ...e }; if (err) n[name] = err; else delete n[name]; return n })
    if (!err) setPending(p => { const n = { ...p }; delete n[name]; return n })
  }

  return (
    <div className="bg-white border border-gray-200 rounded">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
      >
        <span className="w-3 text-left">{open ? '▾' : '▸'}</span>
        <span className="flex-1 text-left">Skill aliases</span>
        {problems.size > 0
          ? <span className="text-red-500">⚠ {problems.size} clash{problems.size > 1 ? 'es' : ''}</span>
          : <span className="text-gray-400">{total}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1 border-t border-gray-100 max-h-[40vh] overflow-y-auto">
          <span className="text-[10px] text-gray-400">
            Other names a skill answers to — <span className="font-mono">라면가져와::신라면</span>. Enter or comma
            to add; saved at once.
          </span>
          {shown.map(s => (
            <div key={s.name} className="flex flex-col gap-0.5">
              <span className="font-mono text-[10px] text-gray-500 break-all">{s.name}</span>
              <AliasInput
                aliases={s.aliases ?? []}
                problems={a => problems.get(`${s.name}\u0000${a}`)}
                onChange={next => change(s.name, next)}
              />
              {errors[s.name] && <span className="text-[10px] text-red-500">⚠ {errors[s.name]}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
