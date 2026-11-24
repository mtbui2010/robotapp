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
The old key is never written again.

## Inside a sequence of plans

A preset with `---` lines ([plan-sequence](plan-sequence.md)) runs plan by plan; the chosen policy (`onFail`) and the repeat count apply to **each plan's repeats**
(`runPreset`, `seqGo` and `RunHandles.seqRepeat` carry `onFail`). A session waits in ONE way at a time: a question in the middle of a plan (`◆ asks you`)
or the bar between plans (`◇ waits for Next` / `plan failed`).

| Policy | In the middle of a plan's repeats | When the repeats are over |
|---|---|---|
| `ask` | asks Continue / Stop BETWEEN the repeats | after the LAST repeat nothing asks: the bar (Next / Stop, or Retry / Skip / Stop after a failure) is the go / stop question |
| `stop` | a failed repeat ends the plan's repeats | the bar shows Retry / Skip / Stop |
| `continue` | repeats go on after a failure | the bar appears; the plan counts as done or failed by its LAST repeat |

- Repeat **forever** in a sequence is one run per plan (plan-sequence.md), so no question is asked inside a plan.
- The question's Stop (`endLoop`) ends the repeat loop **and** the sequence. A run that ends `aborted` (cancelled elsewhere, or by the main Stop / Cancel when the robot reports it so) ends them too and never asks (`afterRun`). The main Stop during a running repeat only cancels the run: its `done` goes through `endRun(verdictOf(ev))` and `afterRun`, so a `success` verdict that lands before the cancel leaves the sequence `waiting` with Next, and a `failed` verdict gives Retry / Skip / Stop.
  The run keeps its own verdict.
- While the loop asks, the bar says so (no Next button; the plan is still the running one), the robot is busy (`startBlock`) and the drop-down shows `◆`, never `◇`.
  `endRun` clears the question and moves the sequence by the plan's verdict in one step, so both can never be set together.
- Tests: `scripts/test_repeat.mjs` (`sequence, …`), `scripts/test_sessions.mjs` (`plan repeats in a sequence: …`).

## Code and proof

- Pure decision logic: `frontend/lib/repeatPolicy.ts` (`nextStep`, `migratePolicy`, `askText`); unit tests `scripts/test_repeat.mjs` (`make unit`).
- The `onRun` signature carries the policy (`onFail`) instead of `continueOnError`.
- End-to-end proof on two real sim agents: `scripts/e2e_repeat.py` (own dashboard on port 3027; steps: default `ask`, ask after success with
  Continue then Stop, ask after failure, `stop` ends with no ask, `continue` runs back to back, ask on a while b stays usable and a is marked `◆`,
  Cancel never asks, migration of the old key). Screenshots `e2e_start.png`, `e2e_ask.png`, `e2e_end.png`.

A run cancelled from elsewhere (`done` with status `aborted`: another window, the fleet's Stop all) ends the loop in every policy and never asks. While the loop asks, a run started on the robot by another client is drawn, and Continue waits until it has ended.
