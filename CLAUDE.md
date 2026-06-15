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
