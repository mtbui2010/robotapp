# Per-robot sessions (2026-11-24)

One dashboard tab keeps one **session per robot**: its run state, the run's WebSocket, the chat log, the plan panel and its own
Cancel / Stop / Reset. Before this, a tab had a single run state: while robot A ran, the controls stayed locked after picking B,
and Cancel went to "the robot picked now" (so it cancelled B, not A).

## What it does

- A run keeps going while you look at another robot. Picking a robot shows THAT robot's session: live state while it runs, the result when it is done.
- The robot / fleet drop-down marks every robot whose session is not idle (`●` running, `◆` asks you, `○` stopping, `▲` lost track of).
- Cancel, Stop and Reset act on the robot of the session that is shown, and name its URL (`api.cancelRunAt(url)` in `lib/api.ts`).
  No Cancel reads "the active robot at call time".
- Starting a run on B while A runs is allowed.
- The Fleet view is unchanged: its chat talks to the fleet manager and is not a robot session. Cameras and the map are still rebuilt per robot.

## How to use

1. Pick robot A, run a command.
2. Pick robot B in the drop-down: its controls are free; A shows `● a · running`.
3. Run a command on B. Cancel (while viewing B) stops B only.
4. Pick A again, press Cancel: A stops.

## The one-client rule (rule 7)

A robot whose session is running takes no second command from this tab; the UI says why ("a second command would mean two clients driving
one robot, which is unsafe. Stop it first."). Two clients driving one robot is unsafe in general: Cancel stops both. This rule is per robot, not per tab.

## Code

- Pure store (create, select, mark running, per-robot chat log, the target of a Cancel): `frontend/lib/robotSessions.ts`, tests in `scripts/test_sessions.mjs` (`make unit`).
- The page draws the shown session (`useRobotSessions` in `app/page.tsx`); the drop-down text comes from `optionText`.

## Limits

- Sessions live in the tab's memory: a reload drops them. A run still going on a robot is then seen only as a run started by someone else (the read-only `/ws/events` badge).
- A robot removed or renamed in the list ends its session.
- The screen recorder is one per tab: only the session that began it ends it.
- Verified on two sim robots with `scripts/e2e_sessions.py`; not run on real robots.

## End-to-end check

`scripts/e2e_sessions.py` (Playwright) starts its own dashboard on port 3017 and drives two sim agents (`A_URL` 8021, `B_URL` 8022, structured `wait::N`):
a runs, b is free and a is marked running, b runs, Cancel on b leaves a running, Cancel on a stops a; both agents are cancelled at the end even on failure.
It prints one PASS / FAIL line per step and exits 0 only when all pass.
