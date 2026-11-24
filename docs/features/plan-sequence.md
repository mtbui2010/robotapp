# A preset as a sequence of plans (2026-11-24)

A plan in a cell of the Structured editor (and so a preset) can be a **sequence of plans**: put a line that is only `---` between the plans.
The first plan runs when you click Run. When it is over, a bar appears in the plan panel: **▶ Run plan 2** or **■ Stop**. Nothing runs by itself
between two plans: the click is the operator's go for the robot to move (rule 8). Each plan is an ordinary run: its own step list, run record,
failure handling, log data, repeat and Cancel. A cell without a `---` line is one plan and behaves exactly as before (no bar).

```
move::sofa
movej::approach_standing
---
wait_hand::camera=arm, max_wait=20
grip::open
---
movej::fold
```

## What you see

- The Run button says `Run (3 plans)` when the cell holds more than one plan (its tooltip says how they run).
- The bar (above the plan list, `components/SequenceBar.tsx`): `Plan 2/3`, one chip per plan (`✓` done, `▶` running, `✗` failed, `⏭` skipped, `○` waiting),
  and the buttons of the state:

| State | Bar | Buttons |
|---|---|---|
| a plan is running | `running…` | none (Cancel stops the run **and** the sequence) |
| a plan finished well | `Plan 1 done. Next: Plan 2 — <its first skills>` | **▶ Run plan 2**, **■ Stop** |
| a plan failed | `Plan 2 failed: the robot stayed where it stopped.` | **↻ Retry plan 2** (the same plan again, from its first step), **⏭ Skip** (the plan counts as over; the next one still waits for its click), **■ Stop** |
| the last plan finished (or was skipped) | `Sequence done (3 plans).` | Close |

- A plan that ends in a plan-only run (`planned`) counts as done. Cancel / Stop / Reset while a plan runs (the verdict `aborted`) ends the sequence.
- A plan **lost to the network** (the socket closes without a `done`, the agent restarts) is an error, not a Stop: the bar shows Retry / Skip / Stop, so you do not start again from plan 1.
- Each chip keeps what happened to its plan: `✓` done, `✗` failed, `⏭` skipped, `○` not run yet, `▶` running. A skipped plan is never shown as done; the last bar says `Sequence done (3 plans, 1 skipped)`.
- On a failure the robot stops where it is, as for any plan (rule: stop in place); the bar never continues by itself.
- Repeat (once / N times) and "keep on error" apply to **each plan** like a plain run; the bar waits until the plan's repeats are over. Repeat **forever** would never get past plan 1, so in a sequence each plan runs once (the Run button's tooltip says so).
- Running any other command in the same robot's session (a shortcut button, the chat, a one-plan cell) ends a waiting sequence.
- The sequence belongs to the **robot's session** (per-robot sessions, [sessions.md](sessions.md)): picking another robot shows that robot's bar; the first
  robot's sequence waits for its own click.

## Code

- Pure parts (split at `---`, the states and what a verdict does, titles and chips): `frontend/lib/planSequence.ts`, tests in `scripts/test_lib.mjs`
  (`planSequence: …`, 11 tests) and `scripts/test_sessions.mjs` (the `seq` field of a session, `endRun` moves it by the verdict, a renamed robot keeps a waiting sequence).
- `RobotSession.seq` (`lib/robotSessions.ts`): `endRun` moves a running sequence by the run's verdict (`afterRun`). `RunHandles.seqKeep` / `seqRepeat`
  carry "the next `run()` belongs to the sequence" and the repeat options.
- `app/page.tsx`: `runPreset` (what the Run button calls: one plan runs as before, several start the sequence), `seqGo` (Next / Retry run a plan with the
  options of the run before it), `seqSkipClick`, `seqStopClick`; `run()` clears a sequence that is not its own.
- No backend change: every plan goes through `/ws/agent` as it did.
- End-to-end: `scripts/e2e_plan_sequence.py` (Playwright, one sim robot at `A_URL`, `make run ROBOT=home PORT=8021 HOST=127.0.0.1` in symbolic_robot): 17 steps
  (only plan 1 runs, Next, the last plan, a failing plan with Retry / Skip / Stop, nothing runs by itself, the skipped chip, Stop, a plain run clears a waiting sequence,
  a one-plan cell is unchanged). Run by hand. Cancel during a running plan is not driven there (the symbolic robot's `wait` returns at once); it is covered by the unit tests.

## Limits (v1)

- The editor is the existing cell: type the `---` line yourself (a saved preset keeps it in its text, so export / import are unchanged). Plan cards with
  `＋ Plan` and drag to reorder are not built.
- Sessions live in the tab's memory ([sessions.md](sessions.md)): a reload while the bar waits loses the place in the sequence. A robot renamed in place keeps a waiting sequence; removing the robot drops it.
- Every plan is a separate run, so the data log of a plan is its own run; the sequence has no record of its own.
- No "continue by itself" option per boundary, and no voice or chat control of the bar.
- A line that is exactly `---` is always a separator; a skill argument that merely contains dashes is not (tested).
