// What a repeat loop does after a run ends. Pure: no React, no HTTP, no storage access (callers read/write localStorage).
// Spec: docs/features/repeat.md. Tests: scripts/test_repeat.mjs.

/** What to do when a run ends and more runs are left:
 *  ask      pause after EVERY run that is not the last (success or failure) and let the person choose (default)
 *  stop     continue while runs succeed, end at the first failure
 *  continue always continue, failure or not */
export type RepeatPolicy = 'ask' | 'stop' | 'continue'

export const POLICIES: readonly RepeatPolicy[] = ['ask', 'stop', 'continue']
export const DEFAULT_POLICY: RepeatPolicy = 'ask'

/** localStorage key of the policy. */
export const LS_REPEAT_ON_FAIL = 'robotapp_repeat_on_fail'
/** Old checkbox key: read once for migration, never written again. */
export const LS_REPEAT_COE_OLD = 'robotapp_repeat_continue_on_error'

/** The next move of the loop. */
export type RepeatStep = 'next' | 'ask' | 'end'

export function isPolicy(v: unknown): v is RepeatPolicy {
  return typeof v === 'string' && (POLICIES as readonly string[]).includes(v)
}

/**
 * Decide after a run ended.
 * @param policy    the chosen policy (an unknown value is treated as `ask`)
 * @param ok        the run succeeded
 * @param remaining runs still to do AFTER this one (Infinity for "forever")
 * @param active    false when the loop was ended from outside (user Stop / Cancel, socket loss, reset)
 * An inactive loop and an exhausted count always end and NEVER ask.
 */
export function nextStep(policy: RepeatPolicy | string | null | undefined, ok: boolean, remaining: number, active: boolean): RepeatStep {
  if (!active || !(remaining > 0)) return 'end'
  if (policy === 'continue') return 'next'
  if (policy === 'stop') return ok ? 'next' : 'end'
  return 'ask'
}

/**
 * The policy to start with. The NEW key wins when it is stored (an invalid stored value gives `ask`);
 * otherwise the OLD checkbox key: '1' -> continue, '0' -> stop; neither or anything else -> ask.
 */
export function migratePolicy(storedNew: string | null | undefined, storedOld: string | null | undefined): RepeatPolicy {
  if (storedNew != null) return isPolicy(storedNew) ? storedNew : DEFAULT_POLICY
  if (storedOld === '1') return 'continue'
  if (storedOld === '0') return 'stop'
  return DEFAULT_POLICY
}

/** The question a paused loop is waiting on (held by the SESSION of the robot). `n` = runs done, `total` = Infinity for "forever". */
export interface RepeatAsk { n: number; total: number; ok: boolean }

/** "Run 2 of 3 succeeded. Continue or stop?" (forever: no "of M"). */
export const askText = (a: RepeatAsk): string =>
  `Run ${a.n}${Number.isFinite(a.total) ? ` of ${a.total}` : ''} ${a.ok ? 'succeeded' : 'failed'}. Continue or stop?`
