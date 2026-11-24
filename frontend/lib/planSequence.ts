// A preset is a SEQUENCE of plans: the plans are separated by a line that is only `---` in the preset text.
// Each plan runs through the ordinary run (its own steps, record, failure handling); between two plans the operator clicks Next
// (or Stop). A preset without a `---` line is a sequence of one plan and behaves as before: no bar, no waiting.
// Pure functions only (no React, no network): unit-tested in scripts/test_lib.mjs.

export const PLAN_SEPARATOR = '---'

const isSeparator = (line: string) => line.trim() === PLAN_SEPARATOR

/** The plans of a preset text: split at the `---` lines; empty plans are dropped. Always at least one plan ('' for an empty text). */
export function splitPlans(text: string): string[] {
  const plans: string[] = []
  let cur: string[] = []
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (isSeparator(line)) { plans.push(cur.join('\n')); cur = [] } else cur.push(line)
  }
  plans.push(cur.join('\n'))
  const kept = plans.map(p => p.replace(/^\n+|\n+$/g, '')).filter(p => p.trim() !== '')
  return kept.length ? kept : ['']
}

/** The preset text of these plans (the inverse of splitPlans for a list of non-empty plans). */
export function joinPlans(plans: string[]): string {
  return plans.map(p => p.replace(/^\n+|\n+$/g, '')).join(`\n${PLAN_SEPARATOR}\n`)
}

/** A short name for a plan on the Next button: its first skills (`movej → lift → …`), at most 3, from the `skill::args` lines. */
export function planTitle(plan: string, max = 3): string {
  const skills = plan.split('\n').map(l => l.split('#')[0].trim()).filter(l => l.includes('::'))
    .map(l => l.split('&&')[0].split('::')[0].replace(/^[!~%\s]+/, '').trim()).filter(Boolean)
  if (!skills.length) return plan.trim().split('\n')[0]?.slice(0, 40) ?? ''
  return skills.slice(0, max).join(' → ') + (skills.length > max ? ' → …' : '')
}

/** What happened to one plan of the sequence: not run yet (or being run again), done, failed, or skipped by the operator. */
export type Mark = 'pending' | 'ok' | 'failed' | 'skipped'

export type SeqState =
  | { kind: 'idle' }
  | { kind: 'running'; plans: string[]; index: number; marks: Mark[] }   // plan `index` is running
  | { kind: 'waiting'; plans: string[]; index: number; marks: Mark[] }   // plan `index` is over (done, or skipped): Next runs index + 1
  | { kind: 'failed'; plans: string[]; index: number; marks: Mark[] }    // plan `index` failed: Retry, Skip or Stop
  | { kind: 'done'; plans: string[]; index: number; marks: Mark[] }      // the last plan is over (index = the last plan)

export const IDLE: SeqState = { kind: 'idle' }

/** A sequence has a bar only with two or more plans; one plan is the old single run. */
export const isSequence = (plans: string[]) => plans.length > 1

const mark = (marks: Mark[], i: number, m: Mark): Mark[] => marks.map((x, j) => (j === i ? m : x))
const over = (plans: string[], index: number, marks: Mark[]): SeqState =>
  index + 1 >= plans.length ? { kind: 'done', plans, index, marks } : { kind: 'waiting', plans, index, marks }

export function start(plans: string[]): SeqState {
  return plans.length ? { kind: 'running', plans, index: 0, marks: plans.map((): Mark => 'pending') } : IDLE
}

/** The running plan ended: ok -> waiting for the Next click (done after the last plan); not ok -> failed (the robot stays where it stopped). */
export function finish(s: SeqState, ok: boolean): SeqState {
  if (s.kind !== 'running') return s
  if (!ok) return { kind: 'failed', plans: s.plans, index: s.index, marks: mark(s.marks, s.index, 'failed') }
  return over(s.plans, s.index, mark(s.marks, s.index, 'ok'))
}

/** The running plan's run ended with this verdict (the run's own: success / planned / failed / aborted / error): success and plan-only
 *  count as done; aborted (Cancel / Stop / Reset) forgets the sequence; failed and error offer Retry / Skip. Not running: unchanged. */
export function afterRun(s: SeqState, verdict: string): SeqState {
  if (s.kind !== 'running') return s
  if (verdict === 'aborted') return IDLE
  return finish(s, verdict === 'success' || verdict === 'planned')
}

/** The verdict for a run whose socket closed without a `done` (the network dropped, the agent restarted): the operator did not stop it
 *  (`stopRequested` false) and a sequence is running -> `error`, so the bar offers Retry / Skip / Stop instead of forgetting the sequence. */
export function lostVerdict(s: SeqState, stopRequested: boolean): 'aborted' | 'error' {
  return s.kind === 'running' && !stopRequested ? 'error' : 'aborted'
}

/** Next click (after a plan, or after a skip): run the following plan. Anything else is unchanged. */
export function next(s: SeqState): SeqState {
  return s.kind === 'waiting' ? { kind: 'running', plans: s.plans, index: s.index + 1, marks: s.marks } : s
}

/** Retry click after a failure: the same plan again. */
export function retry(s: SeqState): SeqState {
  return s.kind === 'failed' ? { kind: 'running', plans: s.plans, index: s.index, marks: mark(s.marks, s.index, 'pending') } : s
}

/** Skip click after a failure: the failed plan counts as over (marked skipped); the next one still waits for its own click (nothing moves by itself). */
export function skip(s: SeqState): SeqState {
  return s.kind === 'failed' ? over(s.plans, s.index, mark(s.marks, s.index, 'skipped')) : s
}

/** Stop click (or Cancel, or another preset): the sequence is forgotten. */
export function stop(_s: SeqState): SeqState { return IDLE }

/** The plan to show a bar for: the one that just ended (waiting / failed), else none. */
export function nextPlan(s: SeqState): string | null {
  return s.kind === 'waiting' ? s.plans[s.index + 1] ?? null : null
}

/** `Plan 2/3` for the running / ended plan, '' when there is no sequence to show. */
export function progressLabel(s: SeqState): string {
  if (s.kind === 'idle') return ''
  const n = s.plans.length
  if (n < 2) return ''
  if (s.kind === 'done') return `Plan ${n}/${n}`
  return `Plan ${s.index + 1}/${n}`
}

/** One chip per plan for the bar: done (✓), running (▶), failed (✗), skipped (⏭), not run yet (○). */
export function chips(s: SeqState): { label: string; mark: '✓' | '▶' | '✗' | '⏭' | '○' }[] {
  if (s.kind === 'idle') return []
  return s.plans.map((_, i) => {
    const m = s.marks[i]
    const glyph = s.kind === 'running' && i === s.index ? '▶' : m === 'ok' ? '✓' : m === 'failed' ? '✗' : m === 'skipped' ? '⏭' : '○'
    return { label: String(i + 1), mark: glyph as '✓' | '▶' | '✗' | '⏭' | '○' }
  })
}

/** What the bar does when the shown run is LOST (the socket closed without a `done`: the backend run may still live, rule 7).
 *  Retry would be a second command, so it waits for the main Cancel (which keeps the place in the sequence); the bar's Stop ends the lost run too. */
export function barGuard(lost: boolean): { retryBlock: string | null; stopCancelsRun: boolean } {
  return { retryBlock: lost ? 'This tab lost track of the run: Cancel the lost run first (Cancel button), then Retry' : null, stopCancelsRun: lost }
}
