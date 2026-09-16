# robotapp — Claude notes

Next.js 14 dashboard (App Router, TailwindCSS, static export → Cloudflare
Pages) that talks to a `robot_agent`-based backend over HTTP.

This package is the **UI mode** of the three-mode robot stack:

| Mode | Lives in | Talks to |
|---|---|---|
| **UI / HTTP** | this repo (`robotapp/frontend/`) | `robot_agent` FastAPI over HTTP |
| **CLI** | each robot pkg (`kcare_robot/__main__.py`, …) | bootstraps in-process |
| **Python API** | each robot pkg (`kcare_robot.skills.*`) | bootstraps in-process |

The dashboard is **not** required to operate the robot — it is an
optional multi-user interactive layer.

## Layout

```
robotapp/
├── frontend/                        # Next.js 14 app (App Router)
│   ├── app/                         # routes
│   ├── components/                  # React components (DevicePanel, ExecutionPanel, …)
│   ├── lib/                         # API client wrappers
│   ├── package.json                 # next 14, react 18, tailwind, wrangler
│   ├── next.config.js
│   ├── out/                         # static export (deploy artifact)
│   └── ...
├── Makefile                         # run-frontend / build-frontend / deploy / deploy-status
├── README.md
└── test                             # transient note file (not a test suite)
```

## Backend contract

The dashboard hits these `robot_agent` endpoints (full list in the agent's
[api/](../robot_agent/robot_agent/api/) routers):

| Endpoint | Used for |
|---|---|
| `GET  /skills`          | populate the skill picker |
| `POST /skill/<name>`    | run a skill (body = params) |
| `POST /skills/reload`   | refresh registry after edits |
| `GET  /devices`         | list configured devices |
| `POST /devices`         | add a device |
| `GET  /diagnostics/boot`| boot-error inspection |
| `GET  /camera/<id>`     | MJPEG / WebRTC stream |
| `GET/POST/PUT/DELETE /config/locations[...]` | per-site config profiles (see below) |
| `GET  /agent/world`     | read the persistent symbolic world state (see below) |
| `PUT  /agent/world`     | partial-update the world state (only sent fields) |
| `POST /agent/listen/<id>` | transcript for an HRI skill's `listen` event (see below) |
| `POST /agent/cancel`    | stop the robot — cancel everything in flight (see below) |
| `GET  /guides` · `GET /guides/<name>` | list / read versioned planner guides |
| `POST /guides` · `PUT /guides/<name>` · `DELETE /guides/<name>` · `POST /guides/<name>/activate` | create / edit / delete / select the active guide |

### Location config profiles

A robot backend stores one config folder per deployment site (its own
`connections.json` + global configs). The `DevicePanel` exposes a **Location**
picker (next to the Robot picker) to choose / add / rename / delete sites and
hot-switch between them. Wrappers live in [frontend/lib/api.ts](frontend/lib/api.ts)
(`listLocations`, `activateLocation`, `createLocation`, `renameLocation`,
`deleteLocation`); switching triggers a backend device reconnect, so the UI
refreshes the connections list right after. Sites are a **per-robot backend**
concept (distinct from the multi-robot URL registry kept in `localStorage`).

### Robot State (persistent world state)

A robot backend keeps a persistent symbolic **world state** — what the robot
believes about itself across plan runs — surfaced and editable in the dashboard.
`GET /agent/world` returns the world dict; `PUT /agent/world` applies a partial
update (only the fields sent), persists it, and returns the updated dict.

World dict shape:
`{ arrived, found, holding, opened:[], on:[], holding_since, found_pose, found_pose_stale, holding_pose }`

- `arrived` — nearest configured location the robot is at; the only
  **sensor-derived** field (reconciled from localization).
- `found` / `holding` — object most recently found / currently grasped. These
  are **beliefs**: there is no gripper sensor, so they reflect what the planner
  thinks, not a measurement.
- `opened` / `on` — sets of open containers / on appliances (beliefs). `on` has
  no corresponding kcare skill, so it stays empty in practice.
- `holding_since` — epoch seconds the grasp belief was set.
- `found_pose` — geometric memory of the found object
  `{loc_3d, pose_3d, side_pose?, grasppose?, ts, robot_pose:[x,y,rz]}`, in the
  base frame at detection time. **Display-only.**
- `found_pose_stale` — `true` once the base has moved away (>0.25 m) from the
  detection spot; the pose must not be trusted for grasping then.
- `holding_pose` — the grasp actually used to pick the held object
  `{grasppose:[dx,dy,dz,angle,width], ts, robot_pose:[x,y,rz]}` (`pick` returns it).
  A record of how/where it was grasped. **Display-only.**

The `PlanPanel` renders a **Robot State** block above the Plan block
([frontend/components/PlanPanel.tsx](frontend/components/PlanPanel.tsx),
`WorldStateBlock`): editable inputs for `arrived` / `holding` / `found` /
`opened` (csv) / `on` (csv), live-editable at any time (each save is a
`PUT /agent/world`, even mid-run), a "held Nm ago" age hint next to `holding`,
and a read-only "found pose" section (`loc_3d`, `grasp`) with a fresh / ⚠ stale
badge. The value shown comes from the latest agent WebSocket event carrying a
`world` field, falling back to `GET /agent/world` on mount. Both the closed-loop
and the open-loop / direct execution paths emit `world` events over the agent
WebSocket (`/ws/agent`), so the panel updates live each step. Wrappers live in
[frontend/lib/api.ts](frontend/lib/api.ts) (`getWorld`, `setWorld`); the
`WorldState` type and `AgentEvent.world` field are in
[frontend/lib/types.ts](frontend/lib/types.ts).

### HRI voice (dashboard mic)

kcare's `reply` / `ask` skills (`kcare_robot/skills/hri.py`) talk and listen
either on the robot (`source='robot'`: gTTS + robot mic + `vlms` Whisper) or
through this browser (`source='dashboard'`). In dashboard mode the skill emits
agent-WebSocket events: `speak` (always voiced, unlike the gated `say`) and
`listen: {id, lang, max_sec, prompt}`. `page.tsx` queues them in order —
speak to completion, then `recognizeOnce` ([frontend/lib/hriVoice.ts](frontend/lib/hriVoice.ts))
— and posts `{text, error}` to `POST /agent/listen/<id>` (`api.answerListen`).
Only runs started from the Agent panel have this channel; `/skill/<name>` and
the CLI must use `source='robot'`.

### Cancel / Stop

Closing the agent WebSocket never reached the robot: the plan runs in a backend
thread (`UnifiedAgent.run`), so the skill in flight finished and every remaining
step still executed. Stopping is now explicit — `POST /agent/cancel`
(`api.cancelRun`), sent by the Agent panel's **Stop** and by the always-live
**Cancel** button in the top bar, and also triggered backend-side when the agent
WebSocket disconnects mid-run (reload, closed tab, dropped network).

The backend side is [robot_agent/core/run_control.py](../robot_agent/robot_agent/core/run_control.py)
plus `CustomNode.cancel_all()`
([connect/ros/node.py](../robot_agent/robot_agent/connect/ros/node.py)), which:

- cancels every in-flight **action goal** in two steps: `cancel_goal_async()` on
  the handles this process holds, then a **CANCEL_ALL** on the action's own
  `<conn_name>/_action/cancel_goal` service (zero uuid + zero stamp — the Python
  form of the `ros2 service call ... action_msgs/srv/CancelGoal` command), which
  also stops goals this process never held: sent by another client, or left
  running across a backend restart. The kcare servers (`arm_moveJ/T/L`,
  `lift_move`, `head_move`, `navigate_to_pose`) accept both and stop the motion;
  a cancelled goal's Result is reported as a failure instead of being decoded as
  a success. Agents are cancelled in parallel, so one unreachable action cannot
  hold up the rest;
- drops the **service** calls being waited on, so the skill unwinds at once;
- sets a node-wide flag, so an action / service agent **refuses to send** while
  cancelled — a skill mid-sequence cannot start a fresh motion;
- releases any HRI skill blocked on the dashboard microphone.

The flag is process-wide (one robot per process), so Cancel also stops a skill
started from the CLI or a second client. It is cleared by `begin_run()` at every
entry point (`/ws/agent`, `POST /skill/<name>`, `POST /agent/<name>/send`), so a
cancel never leaks into the next command. A cancelled run ends with
`done{status:'aborted'}`; the closed loop stops instead of replanning.

**Per-connection `cancel_func`.** A ROS *action* connection can define its own
cancel, edited in the `DevicePanel` add/edit form next to `encode_func` /
`decode_func` and stored in `connections.json` the same way (templates in
[frontend/lib/ros_templates.json](frontend/lib/ros_templates.json) carry a
sample):

```python
def cancel_func(node, agent):        # return True if a stop was sent
    return agent.cancel_all_goals()  # what the default does
```

Creating a ROS *action* connection (add form or quick-connect from a ROS scan)
prefills the box with that sample, so a new action starts from a working stop
rather than a blank editor; editing an existing connection leaves whatever it
already has. kcare's `mobile_move` (`/navigate_to_pose`) carries it filled in.

It **replaces** the default for that connection, so cancel the goal handles
yourself if you still want that
(`for h in list(agent._goal_handles): h.cancel_goal_async()`). Leaving the box
empty is also fine — the backend default is exactly what the sample spells out.

**Limitation — mobile services.** `mobile/shift_pose`, `mobile/rotate` and
`mobile/absolute_rotate` are ROS *services*, which have no cancel protocol.
Cancelling stops the client waiting, but `slamtec_bridge.py` keeps publishing
`/cmd_vel` for the whole duration of a shift, and its only stop command
(`/slamware_ros_sdk_server_node/cancel_action`) lives in the slamware ROS
domain, which `robot_agent` cannot reach. Making the base stop on cancel needs a
stop service on the robot side (`keti_assist_ai_robot_ros2`); once it exists,
register it with `node.add_cancel_hook(...)` — no change needed here.

### Planner guide versions

The LLM **guide** (the prompt that turns a task into a plan) is now versioned and
editable. The backend stores versions in `common_dir/guides.json` (seeded on first
run from the robot's `configs/guide*.py` modules); the **active** version is what
the planner uses, falling back to the modules when the store is empty. Each version
is `{ name, guide, format }` — `format` is `null` for a freeform guide
(`llm.chat_guide`) or a JSON schema for a structured one (`llm.chat`). The
`GuideEditorPanel` ([frontend/components/GuideEditorPanel.tsx](frontend/components/GuideEditorPanel.tsx),
in sidebar 1) is an expandable block to select / edit / add / delete versions and
set the active one; wrappers (`listGuides`/`createGuide`/`updateGuide`/`deleteGuide`/
`activateGuide`) and the `GuideVersion` type live in
[frontend/lib/api.ts](frontend/lib/api.ts) / [frontend/lib/types.ts](frontend/lib/types.ts).
(Distinct from `GuidePanel.tsx`, which is the connection-config help modal.)

`POST /skill/<name>` is the same path the CLI mode (`<pkg> <name>::<inputs>`)
ultimately resolves through `SkillRegistry.execute()`. Two clients (UI +
CLI) calling the same robot simultaneously is **unsafe** — document this
in any operator-facing UI.

## Dev / deploy

```bash
make install            # npm install in frontend/
make run-frontend       # next dev on :3007
make build-frontend     # static export to frontend/out/
CLOUDFLARE_API_TOKEN=… make deploy
make deploy-status
```

Cloudflare Pages project: `robotapp`. Custom domain:
`robot.aistations.org`. Account ID is pinned in [Makefile](Makefile).

## Related

- [robot_agent](../robot_agent) — backend FastAPI runtime. New endpoints
  added there must be reflected in `frontend/lib/`.
- [kcare_robot](../kcare_robot) — reference robot backend used in
  development. Boots on port 8001.
- [robot_template](../robot_template) — generator for new robot
  backends. Every new project is dashboard-compatible by default
  (same `robot_agent` API).
