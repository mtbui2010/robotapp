---
sources:
  - frontend/lib/api.ts
  - frontend/lib/types.ts
  - frontend/lib/chatRun.ts
  - frontend/lib/chatMic.ts
  - frontend/lib/planner.ts
  - frontend/lib/planView.ts
  - frontend/lib/recordings.ts
  - frontend/lib/teleop.ts
  - frontend/lib/poses.ts
  - frontend/app/page.tsx
  - frontend/components/ChatPanel.tsx
  - frontend/components/EnvPanel.tsx
  - frontend/components/MapPanel.tsx
  - frontend/next.config.js
  - scripts/lint.mjs
verified_at: 4a810a3717ab
---

# Glossary

!!! abstract "In this page"
    Every internal term of the dashboard, with one plain meaning and the code that fixes it. Other pages link here with `../reference/glossary.md#<id>`. Line numbers are at commit `4a810a3717ab`.

The id of each term is the anchor in the first column. Meanings were checked in the code, not copied from older notes.

## Robot and backend

| Term | Meaning | Checked in |
|---|---|---|
| <a id="robot-agent"></a>robot_agent | The backend (a FastAPI server) that a robot package runs. The dashboard talks only to it: `lib/api.ts` is the only file allowed to call `fetch` or open a WebSocket (lint rule 2). | `scripts/lint.mjs:9-10`, `lib/api.ts` |
| <a id="backend"></a>backend, robot URL | The base URL of one robot's `robot_agent`, for example `http://<host>:8001`. The dashboard keeps a list of named robots in the browser; the active one is the base of every call. With no robot configured it falls back to `http://<page host>:8001`. | `lib/api.ts:116-126` |
| <a id="ui-mode"></a>UI mode | Driving the robot from this dashboard. The README names the other two modes of the robot stack: a command line (CLI) and a Python API. | `README.md` (line 9) |
| <a id="site"></a>site, location profile | A set of connections and global configs kept on the backend. One site is active at a time; the Devices panel lists, creates, renames, deletes and activates them. In `types.ts` it is `LocationsInfo`: `locations`, `active`, `others`. | `lib/types.ts:283-292`, `lib/api.ts:738-792` |
| <a id="connection"></a>connection (client) | A device link the backend holds: a ROS topic, service or action, a camera, an LLM, a socket and so on. The type list is `ClientType`. The code uses both words: `ClientEntry` in types, "connects" in URLs. | `lib/types.ts:1-2`, `lib/types.ts:26-39` |
| <a id="ai-server-pool"></a>AI-server pool (`vlms`, `visions`, `voices`) | One connection with several servers in fallback order. The status says which level works (`ok`: the main server, `warn`: a fallback, `error`: none). | `lib/types.ts:5-22` |
| <a id="device-agent"></a>device agent | The backend object behind a connection. The dashboard reads its latest value with `GET /agent/<name>/get` (safe to poll) and sends data with `POST /agent/<name>/send`. | `lib/api.ts:804-819` |

## Runs and planners

| Term | Meaning | Checked in |
|---|---|---|
| <a id="run"></a>run | One task or plan sent over `/ws/agent`, from the first message the browser sends to the backend's `done` or `error`. | `app/page.tsx:328-335` |
| <a id="event"></a>event | One JSON message the backend sends during a run, for example `step_start`, `say`, `listen`. The browser adds `_rx`, the time it received it. Fields are in [Agent events](agent-events.md). | `lib/types.ts:102-185`, `app/page.tsx:337-339` |
| <a id="structured-run"></a>Structured run | Plan lines `skill::params` run as written: the browser sends `direct: true` and no planner takes part. | `app/page.tsx:332`, `app/page.tsx:244-246` |
| <a id="chat-run"></a>chat run | Free text planned by a planner (`direct: false`). A chat run may open the chat card when the robot asks a question; a Structured run only makes the Chat button pulse. | `app/page.tsx:416` |
| <a id="planner"></a>planner: SAGE + assist, SAGE plain loop, Direct | The three choices in the chat header. Stored values are `sage`, `grace` and `direct`. `sage` is the default ("SAGE + assist": understands the task first, asks when unclear, guards each step). `grace` is labelled "SAGE plain loop" in the chat (no understanding layer). The code and the event names still use "GRACE" for the closed-loop planner and its trace. | `lib/planner.ts:6-8`, `components/ChatPanel.tsx:90-95` |
| <a id="plan-only"></a>plan only | Plan the task and stop; the robot does not move. On by default when nothing is stored. The run ends with status `planned`, which the dashboard counts as success. | `lib/planner.ts:10-14`, `app/page.tsx:374-376` |
| <a id="stop-cancel-force-reset"></a>Stop / Cancel / Force reset | Stop and Cancel call the same handler, which sends `POST /agent/cancel` and waits for `done`. If no answer comes within `STOP_TIMEOUT_MS` (5000 ms), the button turns into "Force reset", which drops the run on the browser side only. | `lib/chatRun.ts:10-13`, `lib/chatRun.ts:62-71`, `app/page.tsx:661-678` |
| <a id="splice-recover-replan"></a>splice / recover / replan | `replan` replaces the not-yet-run part of the plan with a new list. `recover` marks that the steps that start next are inserted by a recovery, not part of the plan: they are "spliced" until the failed step is retried. | `lib/planView.ts:5-16`, `lib/planView.ts:122-140` |
| <a id="world-state"></a>world state / Robot State | The backend's persistent beliefs about the world: `arrived`, `found`, `holding`, `opened`, `on`. The Plan panel shows it as "Robot State"; each value may carry where it came from (sensor, operator, belief, unknown). | `lib/types.ts:65-99`, `components/PlanPanel.tsx:270` |

## Skills and configs

| Term | Meaning | Checked in |
|---|---|---|
| <a id="skill"></a>skill | A named robot action the backend runs, such as `move` or `pick`. Run one with `POST /skill/<name>`; the answer is the skill's result, where `isdone: false` is a failure. Types: `internal`, `external`, `plan`. | `lib/types.ts:48-57`, `lib/api.ts:796-802` |
| <a id="plan-skill"></a>plan skill | A skill of type `plan`, defined as a list of other skills' steps, one `skill::args` per line. The backend refuses one that names an unknown skill or calls itself. | `lib/types.ts:55`, `lib/api.ts:152-161` |
| <a id="alias"></a>alias | Another name a skill (`SkillDef.aliases`) or a location (`<location>.aliases` in ENV) answers to. A new alias that already names another location is refused. | `lib/types.ts:56`, `components/EnvLocationsEditor.tsx:25-37` |
| <a id="config-group"></a>config group / skill config | A named JSON object on the backend (`ENV`, `MAP`, `HRI_CONFIGS`, ...). Read with `GET /skill-configs/<name>`; saved with `PUT` (the whole group) or `PATCH` (only what changed, merged on the backend). | `lib/api.ts:296-349` |
| <a id="env"></a>ENV | The config group of named places (locations). Each has a pose `loc` (x, y, rz), a `height`, a `default_mode`, and aliases. The Map tab draws ENV entries when `MAP.places` is `'ENV'`; a click runs `move::<name>`. | `components/EnvLocationsEditor.tsx:22`, `lib/types.ts:252` |
| <a id="map-config"></a>MAP config | The config group that tells the Map tab what to draw and which skills a click runs. Keys and defaults: [MAP config](map-config.md). | `lib/types.ts:193-281` |
| <a id="occupancy-layer"></a>occupancy layer | A map image in `MAP.layers.occupancy` whose pixel values mean free, too close to an obstacle for the robot base (`inflated`, default 128), and obstacle (`occupied`, default 255). | `lib/types.ts:205-210`, `components/MapPanel.tsx:235` |
| <a id="backend-workaround"></a>BACKEND-WORKAROUND | A tag in a code comment, `BACKEND-WORKAROUND(<id>)`, on UI code that routes around a backend behaviour. The lint checks that each id appears in the repo's `docs/backend_coupling.md`. List: [Backend coupling](backend-coupling.md). | `scripts/lint.mjs:14-15`, `scripts/lint.mjs:86-102` |

## Voice and human-robot interaction

| Term | Meaning | Checked in |
|---|---|---|
| <a id="hri"></a>HRI | Human-robot interaction skills that speak and listen (`ask`, `reply`, `qa`). With `source='dashboard'` the robot sends `speak` and `listen` events and the browser voices and records. | `lib/hriVoice.ts:3-6`, `lib/types.ts:136-157` |
| <a id="listen-speak-say"></a>listen / speak / say | `listen`: the robot waits for an answer, and the browser posts it to `/agent/listen/<id>`. `speak`: a skill's own line, always voiced when sound is on. `say`: a milestone narration, dropped while an HRI line is queued. | `lib/types.ts:133-157`, `app/page.tsx:347-365` |
| <a id="earcon"></a>earcon | A short tone: two rising notes when the mic opens ("your turn"), two falling ones when a phrase was taken ("got it"). `listen.earcon` is the volume; 0 is off. | `lib/hriVoice.ts:19-24` |
| <a id="hands-free"></a>hands-free | The chat mic that listens for a new command only while the chat is idle, the robot is silent, and `GUARD_MS` (1000 ms) has passed since it spoke. | `lib/chatMic.ts:1-13`, `lib/useHandsFree.ts` |
| <a id="echo-guard"></a>echo guard | Drops a transcript that is very similar (`ECHO_SIMILARITY` 0.6) to something the robot said in the last `ECHO_WINDOW_MS` (10 s): the mic heard the speaker. | `lib/chatMic.ts:12-13`, `lib/chatMic.ts:75-97` |

## Teleoperation and data

| Term | Meaning | Checked in |
|---|---|---|
| <a id="teleop-function"></a>teleop function | A part of the robot driven by an input device on the robot (for example a SpaceMouse). The backend lists them with `GET /teleop`; each has a name, a label and a state `inactive`, `hold` or `active`. Empty list: nothing configured. | `lib/teleop.ts:21-27`, `lib/api.ts:499-513` |
| <a id="go-to-pose"></a>Go-to pose | A named plan (label and steps) that moves the arm to a pose. All poses run at one speed (0.05 to 1). | `lib/poses.ts:1-8`, `lib/api.ts:537-573` |
| <a id="episode"></a>episode | One recording of teleoperation, made by the robot's recorder and listed as `<day>/<episode>`. | `lib/recordings.ts:19-31`, `lib/api.ts:574-590` |
| <a id="vla"></a>VLA | Vision-language-action model: a model trained on recorded episodes to output robot actions. The dashboard only records, cleans and exports the data. | `components/RecorderBar.tsx:10`, `lib/recorder.ts:1` |
| <a id="edit-list"></a>edit list | The non-destructive changes to an episode: `trim_start_s`, `trim_end_s`, `label`, `exclude`, `note`, `robot_mode`, `prompt`. It is saved beside the raw folder; the raw files are not changed. | `lib/recordings.ts:18`, `lib/api.ts:592-602` |

## Build

| Term | Meaning | Checked in |
|---|---|---|
| <a id="static-export"></a>static export | The `next build` output as plain files in `frontend/out/`, with no Node server. Any static host can serve it. | `frontend/next.config.js:4` |
