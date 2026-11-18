---
sources:
  - frontend/lib/types.ts
  - frontend/lib/planView.ts
  - frontend/app/page.tsx
  - frontend/components/PlanPanel.tsx
  - frontend/components/PlanList.tsx
  - scripts/fixtures/events/README.txt
verified_at: 4a810a3717ab
---

# Agent events

!!! abstract "In this page"
    The JSON messages the backend sends over `/ws/agent` during a [run](glossary.md#run): the event names the dashboard knows, every field of the `AgentEvent` type, and which file reads each field. Checked at commit `4a810a3717ab`; "reads" means a line of code that uses the field on an event, found by search and read.

## How an event arrives

The browser opens `/ws/agent` and sends one message when the socket opens: `prompt`, `lang`, `direct`, `planner`, `plan_only`, `log_data`, `log_mode`, `log_all` (`app/page.tsx:331-335`). Every later message from the backend is parsed as an `AgentEvent`. The dashboard adds one field to it, `_rx`, the receive time in milliseconds, and it never comes from the backend (`app/page.tsx:337-339`).

Three places read the stream:

| Reader | What it does with events |
|---|---|
| `app/page.tsx` (`ws.onmessage`, lines 337-576) | voice (`say`, `speak`, `listen`, `alarm`), the chat lines, the step list, the failure test, the log files, the run verdict and the repeat loop |
| `lib/planView.ts` (`reducePlan`, line 103) | turns the events into the plan list rows: steps, notes, goals, final verdict |
| `components/PlanPanel.tsx` | the status line, the plan text, the GRACE planning trace, the Robot State block, the done and error badges |

An event name the code does not know is ignored: `reducePlan` returns the view unchanged (`lib/planView.ts:196-197`, the `default:` branch).

## Event names

The type has `event: string`; it does not list the names. These are the names the code branches on, and the names found in the recorded event files `scripts/fixtures/events/*.json` (8 files, simulated home robot, used by `scripts/test_lib.mjs`).

| Event | Meaning | Read by |
|---|---|---|
| `start` | a run begins; the plan list is emptied | `planView`, `PlanPanel` (counts starts to refetch the LLM info) |
| `understand` | SAGE + assist: the goals it understood, a status, a reason, a question | `planView` |
| `clarify` | SAGE + assist: a question to the user | `planView` (a note row), `page.tsx:372` (a chat line) |
| `plan` | the plan: `steps`, `plan_text` or `plan` | `planView`, `PlanPanel` |
| `plan_step` | GRACE planning progress, one per phase and sub-goal | `PlanPanel` (trace), `page.tsx` (failure test) |
| `replan` | the not-yet-run part of the plan is replaced | `planView`, `page.tsx` (always a failure event) |
| `recover` | a recovery inserts steps, see [splice](glossary.md#splice-recover-replan) | `planView` |
| `step_start` | a step starts | `page.tsx:497`, `planView` |
| `step_log` | debug data and an image of a step | `page.tsx:529` |
| `step_done` | a step ends; `result.isdone` tells if it worked | `page.tsx:515`, `planView` |
| `goal_check` | SAGE + assist: a goal checked, with evidence | `planView` |
| `world` | a world-state snapshot (the type has the `world` field on any event) | `PlanPanel:150-158` |
| `status` | a text line shown while the task is planned (`msg`) | `PlanPanel:569` |
| `done` | the run ends; `status` or `success` is the verdict | `page.tsx`, `planView`, `PlanPanel` |
| `error` | the run ends with an error; `msg`, optional `trace` | `page.tsx`, `planView`, `PlanPanel` |
| `stopped` | made by the dashboard, never sent by the backend: the run ended without a `done` (Stop, closed socket) | `planView`; `PlanList.tsx:82-84` adds it |
| `search` | in 4 fixtures (`object`); no code reads it | none |

Counts in the fixtures (8 recorded runs): `step_start` 79, `step_done` 79, `recover` 22, `plan` 8, `start` 8, `done` 8, `clarify` 8, `understand` 7, `search` 4, `goal_check` 3, `replan` 2, `world` 5 (all of them without a payload; the payload was stripped), `step_log` 2.

### Fields in the fixtures that the type does not declare

`at_index` (`replan`, `recover`), `problems` and `search` (`replan`), `round` (`clarify`), `certified` (`plan`), `code` and `device` (`done`), and `grounded` inside each `steps` item. No dashboard code reads them. The type is hand-written, so a field the backend adds does not show up there until someone adds it.

## Fields of `AgentEvent`

Only `event` is required. Everything else is optional: which fields exist depends on the event, the planner and the robot package. Line numbers are in `lib/types.ts`. "Read by" lists the files; the short names are `page` (`app/page.tsx`), `planView`, `PlanPanel`, `PlanList`.

### Run and step

| Field | Type | Meaning | Read by |
|---|---|---|---|
| `event` | string | the name | all |
| `step` | number | step number (direct and structured runs) | `page`, `planView` |
| `index` | number | step index (SAGE); reused after a recovery splice | `page`, `planView`, `PlanPanel` |
| `total` | number | number of steps | `page`, `planView`, `PlanPanel` |
| `task` | string | the step as text; the first one names the run's log folder | `page`, `planView` |
| `action`, `object` | string | the GRACE action and its object; the row label is `action object` | `page`, `planView`, `PlanPanel` |
| `skill` | string or null | the mapped skill | no reader |
| `status` | string | step or run status: `success`, `failed`, `planned`, `aborted` | `page`, `planView`, `PlanPanel` |
| `success` | boolean | the older verdict of `done`; used only when `status` is absent | `page`, `planView`, `PlanPanel` |
| `result` | object | a step's result; `isdone: false` is a failure | `page`, `planView` |
| `reason` | string | why a step failed, or why the plan changed | `planView` |
| `msg` | string | a message: the verdict text of `done`, the error text, a `status` line | `page`, `planView`, `PlanPanel` |
| `trace` | string | Python trace of an `error` | `PlanPanel` |
| `run_id` | string | declared | no reader |
| `warnings` | string array | declared | no reader on events (`DataPanel` has its own `warnings` of a recording) |
| `elapsed_ms` | number | the whole run, measured by the dashboard when `done` or `error` arrives (the comment in the type says "client-measured") | set in `page`, shown by `PlanPanel` |
| `ts` | number | unix seconds; a `step_log` entry uses it, else the current time | `page` |
| `_rx` | number | receive time in ms; made by the dashboard | `page` (set), `planView` (step times) |
| `prompt`, `text` | string | declared | no reader on events (`page` reads `prompt` of a `listen` request, a different object) |

### Plan

| Field | Type | Meaning | Read by |
|---|---|---|---|
| `plan` | string or string array | plan text (direct runs); in `replan`, the new step list | `planView`, `PlanPanel` |
| `plan_text` | string | the plan in `skill::inputs` lines, the form the robot runs | `planView`, `PlanPanel` |
| `steps` | list | plan steps (`{action, object}`); also in `plan_step` | `planView`, `PlanPanel` |
| `plan_meta` | object | planner numbers: sub-goals, LLM calls, refines, latency | `PlanPanel` |

The shape of `plan` differs by path: a direct or legacy run sends `plan` as a string, the closed loop sends `steps`. `PlanPanel.tsx:555` carries `BACKEND-WORKAROUND(plan-event-shape)` for this, and `PlanPanel.tsx:615` `BACKEND-WORKAROUND(done-event-shape)` for the two verdict forms (`status` or `success`). See [Backend coupling](backend-coupling.md).

### Planner trace (`plan_step`, GRACE)

| Field | Type | Meaning | Read by |
|---|---|---|---|
| `phase` | string | `decompose`, `expand`, `expanded`, `refine`, `refined`, `verified` | `PlanPanel`, `page` |
| `subgoals` | string array | the sub-goals found in `decompose` | `PlanPanel` |
| `subgoal` | string | the current sub-goal | `PlanPanel` |
| `attempt` | number | refine attempt | `PlanPanel` |
| `ok` | boolean | the verdict of `verified`; also a `goal_check` result | `PlanPanel`, `page`, `planView` |
| `violations` | list | symbolic violations of a plan; any entry marks a failure | `PlanPanel`, `page` |

### SAGE + assist

| Field | Type | Meaning | Read by |
|---|---|---|---|
| `goals` | list | the goals it understood (`understand`) | `planView` |
| `goal` | object | the goal of a `goal_check` | `planView` |
| `question` | string or null | the question it asks (`understand`, `clarify`) | `planView`, `page` |
| `kind` | string | the kind of a recovery | `planView` |
| `evidence` | string | the evidence of a goal check | `planView` |
| `verifies` | list | declared | no reader |

### World

| Field | Type | Meaning | Read by |
|---|---|---|---|
| `world` | `WorldState` | a snapshot of the persistent [world state](glossary.md#world-state) | `PlanPanel` (the latest one on any event wins) |

### Voice and human-robot interaction

| Field | Type | Meaning | Read by |
|---|---|---|---|
| `say` | string | a localized milestone phrase for voice output | `page`, `planView` |
| `say_lang` | string | the phrase's language when it is not the run's | `page` |
| `quiet` | boolean | `step_start` of a `%skill::...` step: not narrated, no 15 s nudge | `page` |
| `speak` | string | a skill's own line; always voiced when sound is on | `page` |
| `speak_lang`, `speak_rate` | string or null, number | its language and speed | `page` |
| `speak_id` | string | the skill waits until the line is reported spoken (`POST /agent/listen/<id>`) | `page` |
| `alarm` | `{volume?, cycles?}` | play the siren (a simulated emergency call), in order with the lines | `page` |
| `qa_state` | `{active}` | a `qa` conversation runs or is over (the "End Q&A" button) | `page` |
| `choose` | `{id, options, prompt?}` | the options of a question as buttons until a click | `page` |
| `choose_close` | string | the `choose` id to close | `page` |
| `listen` | object | ask the browser to capture one phrase and post it; see below | `page` |

Fields of `listen`: `id`, `lang`, `max_sec`, `prompt`, `mode` (`voice` or `text`), `capture` (`whisper`: record and post the audio; `browser`: the browser's recogniser), `silence_sec`, `earcon` (volume, 0 is off), `rate`. See [listen / speak / say](glossary.md#listen-speak-say) and [earcon](glossary.md#earcon).

### Logging

| Field | Type | Meaning | Read by |
|---|---|---|---|
| `data` | object | a `step_log` payload; `data.lang_detected.lang` sets the voice language | `page` |
| `log_image` | string or null | a base64 debug image of a step | `page` |
| `log_image_reset` | boolean | clear the shown image first | `page` |
| `log_dir` | string | the backend's capture folder (when `log_data` is `backend`) | `page` |
| `dataset` | object | a streamed vision capture (`log_data` is `frontend`): `rgb`, `annotated`, zlib `depth` with `depth_w` and `depth_h`, `results`, `tag`, `ts` | `page` |

## The failure test

The dashboard decides by itself whether a run has failed, to flush the buffered captures and to name the log folder. `isFailureEvent` says in its comment that it mirrors the backend's `unified_agent._is_failure_event`. It is a copy of a backend rule: if the backend changes the rule, this function does not follow. [Backend coupling](backend-coupling.md) lists it.

```ts
// Mirrors the backend's failure test (unified_agent._is_failure_event): a step
// returning isdone False, a run-level error, or a GRACE symbolic violation.
const isFailureEvent = (ev: AgentEvent): boolean => {
  if (ev.event === 'error') return true
  if (ev.event === 'step_done') {
    if (ev.status === 'failed') return true
    if (ev.result && (ev.result as { isdone?: unknown }).isdone === false) return true
  }
  if (ev.event === 'done') {
    return ev.status != null ? !(ev.status === 'success' || ev.status === 'planned') : ev.success === false
  }
  if (ev.event === 'plan_step' && ev.phase === 'verified' && ev.ok === false) return true
  if (ev.event === 'plan_step' && Array.isArray(ev.violations) && ev.violations.length > 0) return true
  if (ev.event === 'replan') return true
  return false
}
```

!!! code "Where in the code"
    `isFailureEvent`: [`frontend/app/page.tsx:50-65`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/app/page.tsx#L50-L65). The type: [`frontend/lib/types.ts:102-185`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/lib/types.ts#L102-L185). The reducer: [`frontend/lib/planView.ts`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/lib/planView.ts#L103-L199).

## Real events

Two events from the committed file `scripts/fixtures/events/mug_en_simple_success.json` (read by a script, not edited):

```json
{"event": "step_start", "index": 0, "action": "MoveTo", "object": "counter@kitchen", "skill": "move", "say": "I will move to kitchen counter"}
{"event": "done", "status": "success", "msg": "", "say": "Task completed"}
```

## Failure modes

| What happens | Why | What to do |
|---|---|---|
| An event with a new name is not shown | `reducePlan` ignores unknown names | add a `case` in `lib/planView.ts` and a field in `types.ts` |
| The plan never shows ("Generating...") | the backend sends `steps` or `plan` in a shape the panel does not read | the workaround tag `plan-event-shape` covers `plan`, `plan_text` and `steps` |
| A run counts as failed in the logs while the backend says success, or the reverse | `isFailureEvent` is a copy of the backend rule | compare it with the backend's `_is_failure_event` after a backend change |
| `done` with neither `status` nor `success` | both readers treat it as failed | the backend should send `status` |
