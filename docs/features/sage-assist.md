# SAGE planner + assist layer (2026-10-09)

<!-- Moved verbatim from CLAUDE.md (lines 897-954) on 2026-10-30; links rebased to docs/features/. -->

**SAGE** is the paper's planner ("SAGE: Symbolic Action-Gating and Editing", code identifier GRACE:
`pyplanner.GRACEPlanner`, GRACE-Fixed settings). Agent panel → **SAGE + assist** (`planner: 'sage'` on
`/ws/agent`, or `ROBOT_AGENT_PLANNER=sage`) runs [core/planning/assist_loop.py](../../../robot_agent/robot_agent/core/planning/assist_loop.py)
(`AssistLoop`) around it; **SAGE (plain loop)** (`'grace'`) is the original `ClosedLoop`. Every plan and every
change of plan comes from SAGE — the assist layer never adds, drops or reorders steps:

1. **Understand** (one LLM JSON call on the translated *and* the original words): goals
   `{type: on|in|open|close, object, from, to}`, or `unsafe` / `infeasible` → `done{status:'refused'}`.
   Places are grounded on the live ENV without the LLM; a place word naming several places (`shelf`), a key the
   user never said (`test table` for 식탁 → "table"), or `me` without a place → a question through the `ask`
   skill; answers are read back. Object memory is *not* in the prompt (a 7B model refused / asked about every
   object it did not list).
2. **Plan**: SAGE `generate_plan`; the checker `_check` simulates the plan as written and reports violations
   (not a listed place, Pick without Find, Open with a full hand, goals not reached, the task repeated after
   the goals are done …). Critical findings go to **SAGE's own sub-goal Editing** (`GRACEPlanner._refine` on
   the offending sub-goal block, `_sage_edit`, `edit_rounds` 3); a block the earlier blocks already achieved is
   asked for no steps. Offline (`kcare-sim/scripts/bench_plan.py`, 13 tasks, qwen3-vl:8b): valid plans 5/13 as
   generated → 9–10/13 after SAGE's edits (`replan`-based editing did not help: it keeps the future sub-goals).
3. **Guard each step** (table below). Anything that needs another plan — object not here, robot at the wrong
   place, a precondition, Place failed, plan ended short of the goals — goes to SAGE's suffix repair
   (`replan`, E / R / S reason, `max_replans` 6). The run ends as soon as the goals hold.
4. **Done** only when the goals hold in the belief state.

**Per-step recovery (2026-10-09, tested with injected faults — `kcare-sim/scripts/task_runner.py --faults`,
bridge `/sim/command {cmd: fault, set: {nav_fail | nav_offset | no_grasp | slip | drop_on_move}}`):**

| Step | Fault | Caught by | Policy |
|---|---|---|---|
| ask (STT) | silence | empty answer | ask again once ("Sorry, I didn't hear you") |
| | garbled ("shell in the rest room") / other language | grounding finds no place | ask again; ENV `aliases` (화장실 선반) ground directly |
| | misheard but valid ("kitchen" for "restroom") | — | **read-back** after any answer: "I will … Is that right?"; "no, …" corrects (latest answer wins) |
| command | misheard ("beach bottle") | — | `options.confirm_task` reads every task back (voice users) |
| MoveTo | nav gives up / stops off the spot — kcare `move` still says done | base > `arrive_tol` 0.3 m from the ENV loc | retry once → ask "is something in the way? say yes" → retry → stop |
| Find | object moved / absent | not found | SAGE replans where to look (searched places in its observation) → after 3 misses "where is it?" → stop |
| | false detection (absent object "found" 48/82 at min_conf 0) | `find_min_conf` 0.55 | detections below are not seen; VLM crop check (`find_verify`) not worth it in sim |
| | seen > 1 m away | find's pose_3d | Find counts as failed ("seen near X, out of reach") → SAGE replan |
| Pick | misses / slips while lifting | `grasp_succeed` again after the arm folds | re-Find + Pick once (not when > 0.78 m sideways) → ask to move it to the edge (an answer naming a place sends the robot there) |
| | failed but something is in the gripper | `grasp_succeed` | stop: "please take it from me" |
| carry | dropped on the way | `grasp_succeed` before Place | stop, say where (no floor pick) |
| Place | check says "still in the gripper" | second `grasp_succeed` | empty → success; still held → replan once → stop |
| | rolls off after the release | **not caught** (place = gripper empty, by decision) | known gap |
| any | skill bug (`unexpected keyword …`) / same failure twice | message | stop, no replan |

A location-bound step (Place / PutIn / Open / Close) with the robot elsewhere is a precondition failure → SAGE
replan. Questions and failure messages are spoken in the run's `lang` (LLM-translated). Per-run overrides:
`/ws/agent {…, options: {confirm_task, confirm_answers, find_min_conf, find_verify, arrive_tol, …}}`
(`ASSIST_OPTIONS`). Ollama keeps one model resident on the shared A6000s: alternating qwen2.5:7b (planner) and
qwen3-vl (QA / verify), or a different `num_ctx`, reloads it (~20–30 s per call instead of 0.3 s).

kcare: `placeat`, `placep`, `approach`, `approach_close(f)` and the card skills that used them (`pick_card`,
`collect_card`, `return_card`, `pick_no_sound`) are removed (`approach.py`, `_approach_helpers.py` deleted);
`grace_namemap` Place / PutIn → `place`. `find::verify=True` asks the QA VLM about each detection's crop.
Sim results (16 NL tasks, `kcare-sim/scripts/task_runner.py`, truth-graded): SAGE 9 / 8 / 6 of 16 over three
runs, GRACE 2 / 16 (39 replans). Remaining failures are skill-level: pick reach / IK, place IK on far spots, and
`find` accepting any detection (`min_conf` 0: 35 / 60 finds of absent objects "found").
