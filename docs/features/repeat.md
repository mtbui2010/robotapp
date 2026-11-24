# Repeat policy: what a repeat loop does after a run (2026-11-24)

The Agent panel repeats a command `×N` or forever (`∞`). When repeat is not `×1`, a small icon-only select
(`data-testid="repeat-policy"`) next to the repeat selector says what the loop does after a run that is not the last one.
It replaces the old "continue on failure" checkbox.

## The three modes

| Icon | Policy | After a run that is not the last |
|---|---|---|
| `?` | `ask` (default) | the loop pauses after EVERY run, success or failure, and asks: "Run N of M succeeded|failed. Continue or stop?" |
| `⏹` | `stop` | continues while runs succeed, ends at the first failure (old checkbox off) |
| `▶` | `continue` | always continues, failure or not (old checkbox on) |

With `ask`, the question is a notice (`data-testid="repeat-ask"`) in the shown robot's column with buttons Continue
(`repeat-continue`) and Stop (`repeat-stop`), plus a system line in that robot's chat. There is no time limit: the loop waits.
`∞` has no "of M" in the text and asks after every run.

## What never asks

A user Stop or Cancel, a lost socket, a reset, and an exhausted count (the last run) always end the loop without a question.

## Per-robot sessions

The waiting state belongs to the SESSION of the robot, keyed by its immutable `sid:` token (see [sessions](sessions.md)),
not to the registry name. While it asks, the robot counts as busy (no second command from this tab, the unload guard stays armed)
and the robot drop-down marks it `◆ asks you`. A question on robot A never blocks robot B. Removing a robot that asks ends the question
like it cancels a running robot; a rename keeps it.

## Storage and migration

The policy is kept in localStorage `robotapp_repeat_on_fail` (`ask` | `stop` | `continue`). The old key
`robotapp_repeat_continue_on_error` is read once when the new key is absent: `1` -> `continue`, `0` -> `stop`; neither, or anything else -> `ask`.
The old key is never written again. Preset sequences (plan-sequence, not in this branch) still pass a boolean `continueOnError`; when that work lands, its `seqRepeat.coe` must switch to `onFail` (follow-up).

## Code and proof

- Pure decision logic: `frontend/lib/repeatPolicy.ts` (`nextStep`, `migratePolicy`, `askText`); unit tests `scripts/test_repeat.mjs` (`make unit`).
- The `onRun` signature carries the policy (`onFail`) instead of `continueOnError`.
- End-to-end proof on two real sim agents: `scripts/e2e_repeat.py` (own dashboard on port 3027; steps: default `ask`, ask after success with
  Continue then Stop, ask after failure, `stop` ends with no ask, `continue` runs back to back, ask on a while b stays usable and a is marked `◆`,
  Cancel never asks, migration of the old key). Screenshots `e2e_start.png`, `e2e_ask.png`, `e2e_end.png`.

A run cancelled from elsewhere (`done` with status `aborted`: another window, the fleet's Stop all) ends the loop in every policy and never asks. While the loop asks, a run started on the robot by another client is drawn, and Continue waits until it has ended.
