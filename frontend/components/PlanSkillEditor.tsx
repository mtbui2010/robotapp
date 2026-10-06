'use client'

// Plan editor for a `type: 'plan'` skill (SkillPanel add / edit). Checks the
// text as it is typed — unknown skills, parameters, a plan calling itself —
// with the rules of robot_agent/core/plan_skill.py, which re-checks on save.
// Nothing here runs the robot: try a saved plan skill from the Agent panel
// (`pick_top::cup`) like any other skill.

const PARAM = /\$([A-Za-z_]\w*)(?:=([^$]*))?\$/g

export const PLAN_PLACEHOLDER = `move::$loc=counter2@kitchen$
lift::1
movej::pre_pick
forward::0.1
fine_move::$inputs$
forward::-0.5
movej::give
lift::0.5`

export interface PlanCheck {
  steps: number
  params: { name: string; def: string | null }[]
  errors: string[]
}

const bare = (action: string) => action.replace(/[!~]/g, '').trim()

export function checkPlan(name: string, plan: string, known: string[]): PlanCheck {
  const errors: string[] = []
  let steps = 0
  plan.split('\n').forEach((raw, i) => {
    const line = raw.split('#')[0].trim()
    if (!line.includes('::')) return
    steps += 1
    for (const part of line.split('&&')) {
      const bits = part.split('::')
      if (bits.length !== 2 || !bits[0].trim()) { errors.push(`line ${i + 1}: expected "skill::args"`); continue }
      const target = bare(bits[0])
      if (target === name && name) errors.push(`line ${i + 1}: "${name}" would call itself`)
      else if (!known.includes(target)) errors.push(`line ${i + 1}: unknown skill "${target}"`)
    }
  })
  const defs = new Map<string, string | null>()
  for (const m of Array.from(plan.matchAll(PARAM))) {
    const [, p, d] = m
    const def = d === undefined ? null : d
    const prev = defs.get(p)
    if (prev !== undefined && prev !== null && def !== null && prev !== def)
      errors.push(`$${p}$ has two defaults: "${prev}" and "${def}"`)
    if (prev === undefined || prev === null) defs.set(p, def)
  }
  if (!steps) errors.push('no steps yet — one "skill::args" per line')
  return { steps, params: Array.from(defs, ([n, def]) => ({ name: n, def })), errors }
}

export function PlanSkillEditor({
  name, plan, known, onChange,
}: { name: string; plan: string; known: string[]; onChange: (plan: string) => void }) {
  const chk = checkPlan(name, plan, known)
  const usage = chk.params.some(p => p.name === 'inputs') ? `${name || 'skill'}::<inputs>` : `${name || 'skill'}::`
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={plan}
        rows={Math.min(14, Math.max(6, plan.split('\n').length + 1))}
        spellCheck={false}
        placeholder={PLAN_PLACEHOLDER}
        onChange={e => onChange(e.target.value)}
        className={`font-mono text-[11px] bg-white border rounded px-2 py-1.5 resize-y placeholder-gray-300 focus:outline-none ${
          plan && chk.errors.length ? 'border-red-300' : 'border-gray-200 focus:border-blue-400'}`}
      />
      <div className="text-[10px] text-gray-500 leading-relaxed">
        <span className="font-mono text-gray-700">{usage}</span>
        {' · '}{chk.steps} step{chk.steps === 1 ? '' : 's'}
        {chk.params.length > 0 && <>{' · params: '}{chk.params.map((p, i) => (
          <span key={p.name} className="font-mono">{i ? ', ' : ''}{p.name}{p.def === null ? '' : `=${p.def}`}</span>
        ))}</>}
      </div>
      {plan && chk.errors.map(e => <span key={e} className="text-[10px] text-red-500">⚠ {e}</span>)}
      <span className="text-[10px] text-gray-400">
        <span className="font-mono">$inputs$</span> = what follows the skill name ·{' '}
        <span className="font-mono">$name=default$</span> = a parameter · <span className="font-mono">&&</span> parallel ·{' '}
        <span className="font-mono">!</span>skill ignore failure. On a failure the plan stops and the robot stays as it is.
      </span>
    </div>
  )
}
