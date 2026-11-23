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
- A robot removed from the list ends its session (its run gets a best-effort cancel). Every write of the list (add, rename, edit url, remove) fires `ROBOTS_CHANGED_EVENT`, so the page reconciles at once. A running robot renamed in place keeps its session under the new name (still one client per robot). A run closure holds an immutable id of its robot's run state (`stableKey` / `resolveKey` in `lib/runHelpers.ts`), never the registry name: after a rename its events, `done` and repeat iterations still reach its own session, and a NEW robot given the old name is a separate robot. A rename moves the session only to a name that has no session of its own (a sibling sharing the url keeps its chat log), preferring a name new to the list.
- An idle session follows the url its robot has now; a busy one keeps the url of its run, so a Cancel reaches the robot that runs. After the run ends the session takes the edited url.
- The browser has one microphone (Whisper recording and the browser recogniser alike): a listen job's owner is remembered, and only that robot's Stop / answer ends the capture (`micMayEnd` in `lib/runHelpers.ts`, unit-tested). Hands-free `speaking` looks at the SHOWN session only (`handleBusy`), so a background run's speech does not block the shown robot's mic.
- With no robot registered, the shown session takes the legacy default agent url (`sessionUrl`), so an idle Cancel / Map Stop never posts to the dashboard origin.
- The screen recorder is one per tab: only the session that began it ends it.
- Verified on two sim robots with `scripts/e2e_sessions.py`; not run on real robots.

## End-to-end check

`scripts/e2e_sessions.py` (Playwright) starts its own dashboard on port 3017 and drives two sim agents (`A_URL` 8021, `B_URL` 8022, structured `wait::N`):
a runs, b is free and a is marked running, b runs, Cancel on b leaves a running, Cancel on a stops a, step 5b renames a through the robot editor while it runs (still marked running, Cancel stops it, Run works again); both agents are cancelled at the end even on failure.
It prints one PASS / FAIL line per step (plus `PASS option_marks a=<text> b=<text>`, the drop-down texts at step 3) and exits 0 only when all pass.
Screenshots go to `SHOTDIR`: `e2e_start.png` (a runs, a shown), `e2e_step3.png` (b shown, a running, robot list expanded) and `e2e_end.png`.
