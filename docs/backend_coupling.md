# Backend coupling inventory

Where the dashboard knows things it should get from the backend (CLAUDE.md rules 1-3). This is an inventory
only: nothing listed here has been removed yet. Each entry names the backend endpoint that would replace it and
whether that endpoint exists today.

Read on 2026-10-30 from `robot_agent` 04f08a5 (`robot_agent/api/*.py`, `app_factory.create_app`) and
`kcare_robot` main. "In progress" means a branch of the architecture work (`arch/<stream>`), not merged.

## OpenAPI today

- `create_app` builds a plain `FastAPI(...)`, so `/openapi.json` and `/docs` are served (not disabled).
  [scripts/gen_types.sh](../scripts/gen_types.sh) dumps the same schema offline, without booting a robot, to
  `frontend/lib/generated/openapi.json` (38 paths, 21 schemas). `make lint` checks every URL built in
  `frontend/lib/api.ts` against it: all 50 exist (the two `/ws/*` routes are WebSockets, which OpenAPI does
  not describe).
- **No route declares a `response_model`.** The 21 schemas are request bodies only (`SkillIn`,
  `WorldStateReq`, `GuideUpsertReq`, `AddConnectReq`, ...). Generated TypeScript would type what the UI sends,
  and every response would be `unknown`. Responses need `response_model=` (pydantic) on the backend before
  rule 1 ("types generated from OpenAPI") buys much.
- `openapi-typescript` is not in `frontend/node_modules` and there is no network here, so `gen_types.sh`
  stops after the JSON. Installing it (`npm i -D openapi-typescript` in `frontend/`) makes the script also
  write `openapi.d.ts`.
- Backend bug found while dumping: **`POST /skills` is registered twice**, in `api/agent.py:38`
  (`add_skill`, `AddSkillReq`) and `api/skills.py:96` (`SkillIn`). FastAPI warns "Duplicate Operation ID
  add_skill_skills_post"; the router included first (`skills`) wins, so the `agent.py` one is dead code.
- `PATCH /skill-configs/{name}` (3-way merge, safe with several machines on one configs folder) exists, but
  `api.updateSkillConfig` uses `PUT` (whole group). The Map tab's read-modify-write of `ENV` / `MAP` can drop
  another machine's edit made in between.
- The `/ws/agent` event stream has **no schema** anywhere (not in OpenAPI, no JSON Schema, no shared enum).

## 1. Robot data bundled in the UI

| File | Used by | What it is | Replacement endpoint | Exists? |
|---|---|---|---|---|
| `frontend/lib/skill_configs.json` | `SkillPanel.tsx:6,12` (which config groups to show under a skill), `EnvPanel.tsx:7,14-17` (groups *not* tied to a skill go to Global Configs) | kcare's skill → config-group map (`pick` → `ARM_CONFIGS, LIFT_CONFIGS, GRIP_CONFIGS, FIND_CONFIGS`, ...), 30 kcare skill names. Another robot gets kcare's map or nothing | a `configs: [group, ...]` field per skill in `GET /skills` (from `SkillDef` / the manifest `SkillSpec`), or `GET /skill-configs` returning `{group: {skills: [...]}}` | **No.** `GET /skills` returns `SkillDef` (name, type, module_path, aliases, plan ...) without config groups; `GET /skill-configs` returns values only. The map exists nowhere in kcare either: it was written by hand for the UI |
| `frontend/lib/ros_templates.json` | `DevicePanel.tsx:6,25` (encode / decode / cancel templates in the add-connection form, matched on the scanned interface) | ROS interface templates: generic ones (`std_msgs/String`, ...) plus KETI's `rosinterfaces/srv|action/SendStringData` | `GET /connects/templates`: robot_agent's generic templates + the robot package's own | **No.** `GET /ros/scan` lists interfaces, not templates |
| `frontend/lib/room_configs.json` | nothing (no import) | an old kcare `ENV` sample (`ME`, `MOBILE_HEIGHT` 0.435, one living-room table) | `GET /skill-configs/ENV` | **Yes.** The file is dead; delete it in the clean-up pass |

`make lint` refuses a new `import ... from '*.json'` of robot data (allowlist: the two used files above).

## 2. Hand-written types (should be generated)

All in `frontend/lib/types.ts` unless noted. "Request model" = a pydantic model the generator would pick up
today; "response" = needs a `response_model` first.

| TS type | Backend source | Endpoint | Generatable today? |
|---|---|---|---|
| `SkillDef` | `core/skill_registry.SkillDef` (dataclass) | `GET /skills`, `POST/PUT /skills[/{name}]` | request only (`SkillIn`, `SkillUpdate`); response untyped |
| `WorldState` | `core/planning/base.WorldState.to_dict` | `GET/PUT /agent/world` | request only (`WorldStateReq`: 6 fields; the TS type also has `found_pose`, `found_pose_stale`, `holding_pose`, which only the response has) |
| `PlannerPrompt` | `api/planner.py` | `GET /planner/prompt` | no (response untyped) |
| `ClientEntry`, `ClientType` | `core/device_manager`, connect types | `GET /connects`, `POST/PUT /connects` | request only (`AddConnectReq.type` is a free `str`, no enum for `ClientType`) |
| `PoolKind`, `PoolLevel`, `PoolServerStatus`, `PoolStatus`; `ServerRow`, `Provider` (`components/ServerListEditor.tsx`) | `connect/pool.py` | `GET /connects/servers`, pool server config in `POST/PUT /connects` | no (response untyped; server rows are free dicts) |
| `RosScanResult` | `api/devices.py` | `GET /ros/scan` | no |
| `LlmInfo` | `api/agent.py` | `GET /agent/llm-config` | request only (`LLMConfigReq`) |
| `LocationsInfo` | `api/locations.py`, `presence.py` | `GET /config/locations` | request only (`CreateLocationReq`, `RenameLocationReq`) |
| `MapConfig`, `MapFrame`, `MapLayer`, `MapSurface`, `MapSkillCall`, `MapOrigin` | the `MAP` config group, written by `api/map.py` (snapshot) and kcare-sim | `GET /skill-configs/MAP` | no: config groups have no schema. Needs a per-group JSON Schema (e.g. `GET /skill-configs/{name}/schema`) |
| `SimState`, `SimObject`, `SimFurniture` | kcare-sim bridge `/sim/command` (JSON string over a ROS service) | `POST /agent/{agent}/send` | no: owned by kcare-sim; would need a schema published by the sim |
| `AgentEvent` (60+ optional fields), `StepLog`, `Step` (`components/PlanPanel.tsx`) | `UnifiedAgent`, `ClosedLoop`, `AssistLoop`, kcare `hri.py` (`speak`, `listen`, `choose`, `qa_state`, `alarm`) | `/ws/agent` | no: needs an event schema (a discriminated union on `event`). In progress: `arch/run-manager` adds `run_id` and `GET /runs`, `/runs/{id}` |
| return of `api.runSkill` (`{isdone, msg, ...}`) | each skill's dict | `POST /skill/{name}` | no. In progress: `arch/contract` adds `SkillResult` (`ok`, `code: FailureCode`, `msg`) with `to_legacy()` |
| `Robot` (`lib/api.ts`), `PlanCheck`, `QaLine`, `ConfigView`, `Lang` | UI only | - | not backend types; keep |

## 3. UI workarounds for backend bugs and inconsistencies

Tagged in the code with `BACKEND-WORKAROUND(<id>)`; `make lint` fails on a tag whose id is not in this table.

| Id | Where | What the UI does | Backend fix | Replacement exists? |
|---|---|---|---|---|
| `map-arrive-check` | `components/MapPanel.tsx:279` | after `goal` (kcare `moveb`) reads the pose back and reports "stopped N m short" when it is > **0.3 m** from the goal, because kcare reports `isdone: True` even when navigation gave up | kcare `mobile.moveb` / the `navigate_to_pose` decode return a failure (`SkillResult(ok=False, code=UNREACHABLE)`) when the goal is not reached; tolerance from the manifest (`geometry.arrive_tol_m: 0.3`) | **No.** The same check is duplicated in `robot_agent` `assist_loop.py:281,1087` (`arrive_tol` 0.3). In progress: `arch/contract` (`SkillResult`, `FailureCode.UNREACHABLE`), `arch/hygiene-manifest` (`geometry.arrive_tol_m`) |
| `done-event-shape` | `components/PlanPanel.tsx:574` | accepts two `done` shapes: `status` (`success / failed / planned / aborted`, closed loop) or a boolean `success` (direct / legacy `run`) | one `done` event: `{run_id, status, code?, msg}` on every path | **No** (no event schema). `arch/run-manager` is the natural owner |
| `plan-event-shape` | `components/PlanPanel.tsx:522-537` | renders a `plan` event as `plan_text`, else `plan` (string), else `steps` (`[{action, object}]`) | one `plan` event shape on every path (`steps` + `plan_text`) | **No** |
| `hri-narrator-gate` | `app/page.tsx:245` (`enqueueHri`, `hriPending`, `silenceNarration`) | drops milestone narration while an HRI speak / listen is queued, and cancels speech before a skill speaks, because narration before an HRI step (`plan_ready`) plays as the mic opens and gets transcribed | the backend should not emit `say` while an HRI interaction is open (`Announcer.SILENT_ACTIONS` covers only `reply` / `ask` step phrases) | **Partly**: `SILENT_ACTIONS` exists; nothing covers `plan_ready` |
| `delete-active-location` | `components/DevicePanel.tsx:431` | activates `default`, then deletes the site, because `DELETE /config/locations/{name}` refuses the active site; two calls, not atomic | `DELETE` switches to `default` itself (or a `?switch_to=`) | **No** (refuses with 400) |

Not tagged, same family (backend constraint the UI routes around, documented in
[features/map-tab.md](features/map-tab.md)): the Map tab polls the pose with `GET /agent/{name}/get` and never
`POST /skill/mobile_pose`, because every `POST /skill` calls `begin_run()`, which clears a Stop in progress.
Replacement: per-run cancel (`arch/run-manager`: `POST /runs/{id}/cancel`), after which a read-only skill call no
longer touches other runs.

## 4. Backend rules duplicated in the UI

Not bugs: the UI re-implements a backend check to show errors while typing. They drift when the backend
changes. Replacement for all of them: a dry-run validation endpoint that returns the backend's own errors.

| Where | Mirrors | Replacement endpoint | Exists? |
|---|---|---|---|
| `components/PlanSkillEditor.tsx` `checkPlan` | `core/plan_skill.validate_plan` (unknown skill, self call, parameter with two defaults) | `POST /skills/validate {plan}` | **No**; `POST/PUT /skills` re-check and return 400 |
| `components/EnvNamesEditor.tsx` `normalizeName`, `RESERVED = {home, base}`, `aliasProblems` | `env_names.normalize`, `env_names.validate_env`, kcare `move`'s shortcuts | `POST /skill-configs/ENV/validate`, reserved names from the manifest | **No**; `PUT /skill-configs/ENV` returns 400 |
| `components/SkillAliasesEditor.tsx` | `SkillRegistry.check_aliases` | `POST /skills/validate {aliases}` | **No**; save returns 400 |
| `components/MapPanel.tsx:249-262,334` auto lift: nearest surface within `reach_m` (default **0.8**) → `height + clearance` (default **0.1**) | kcare `utils.get_lift_height` (`height + 0.1`); kcare reach 0.78 (`assist_loop` `reach_*`) | defaults from the manifest `geometry` (`reach_m`), or a kcare skill `lift_for(x, y)` | **No** (`MAP.lift.clearance` / `reach_m` can be set per site; the defaults are hard-coded) |

## 5. Robot-specific names hard-coded in the UI

| Where | Name | Should come from | Exists? |
|---|---|---|---|
| `components/MapPanel.tsx:293` | skill `move` for a place click | the `MAP` config (like `goal` / `rotate` / `lift`) or the manifest skill with `action: MoveTo` | **No** (MAP has no `place` skill key) |
| `components/DevicePanel.tsx:474` | skill `warmup_servers` (Warm up button) | manifest / `GET /skills` capability flag; hide the button when the robot has no such skill | **No** |
| `app/page.tsx:530-531` | `qa::source='dashboard', lang=..., input='text', cam=...` (Q&A button) | manifest skill with a Q&A action and its params | **No** |
| `app/page.tsx:71-82`, `components/ConfigFields.tsx:51`, `DevicePanel.tsx:641,1429` | kcare `HRI_CONFIGS` keys (`speech_rate`, `source`, `dashboard_stt`) | a typed HRI settings endpoint, or the group's schema | **No** |
| `components/EnvPanel.tsx:14` | `FIRST_NAMES = ['ENV', 'HOME_LOC']` | config-group metadata (order / category) | **No** |
| `lib/api.ts:102` | default backend `http://<host>:8001` (kcare's port) | keep as a default, but make it configurable (env at build time) | n/a |
| `lib/types.ts` comments, `AgentEvent.skill` ("mapped kcare skill"), `plan_text` ("kcare `skill::inputs`") | kcare vocabulary in shared types | the event schema | **No** |

## Order suggested for the clean-up

1. Backend: `response_model` on the read endpoints the UI uses most (`/skills`, `/agent/world`, `/planner/prompt`,
   `/connects`, `/config/locations`), remove the duplicate `POST /skills`; then run `scripts/gen_types.sh` with
   openapi-typescript installed and replace the matching types in `lib/types.ts`.
2. Event schema for `/ws/agent` (with `arch/run-manager`), then drop `done-event-shape` and `plan-event-shape`.
3. `SkillResult` from `POST /skill/{name}` (with `arch/contract`) and a failing kcare `moveb`, then drop
   `map-arrive-check`.
4. Config groups per skill in `GET /skills` (manifest), then delete `skill_configs.json`; delete the unused
   `room_configs.json` now.
5. Validation endpoints, then drop the mirrored checks of section 4.
