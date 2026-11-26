# Code map

One row per module page: what the module is for, its main files, the backend endpoints it calls, and the page. Paths are under `frontend/` unless they start with `scripts/` or `Makefile`. Every call goes through `lib/api.ts`. Endpoint lists follow each module page, which was checked in code at `4a810a3717ab`; none was run against a robot.

!!! abstract "In this page"
    - 21 module pages in one table: 1 for `app/`, 12 by panel group (31 components), 5 for `lib/`, 3 for scripts and build.
    - A second table for the files that are not components or `lib/`.
    - Coverage: every component and `lib/` file is a `sources:` entry of at least one module page, with one exception, named at the end.

## Modules

| Page | Purpose | Main files | Endpoints it calls |
|---|---|---|---|
| [Home page](../modules/page.md) | Owns the run: opens the socket, handles every event, runs Stop, Reset and repeat. | `app/page.tsx`, `app/layout.tsx`, `lib/chatRun.ts` | `WS /ws/agent`, `POST /agent/cancel`, `POST /agent/listen/<id>` and `/audio`, `POST /agent/qa/end`, `GET /skill-configs/HRI_CONFIGS` |
| [API client](../modules/api-client.md) | The one file that builds URLs; also the list of robots. | `lib/api.ts`, `lib/types.ts` | All: 77 URL templates (75 HTTP, 2 WebSocket). See [Endpoints](../reference/endpoints.md). |
| [Generated contract](../modules/generated-contract.md) | The OpenAPI snapshot and the script that dumps it. | `lib/generated/openapi.json`, `lib/types.ts`, `scripts/gen_types.sh`, `scripts/dump_openapi.py` | None from the browser. The dump imports the backend routers offline. |
| [Chat](../modules/chat.md) | The chat card: text, planner choice, language, Stop. | `components/ChatPanel.tsx`, `components/LanguagePicker.tsx`, `lib/chatRun.ts`, `lib/planner.ts` | `GET` and `PUT /robot/languages`; the run itself is in Home page |
| [Voice](../modules/voice.md) | Speech out, the microphone, hands-free listening. | `lib/hriVoice.ts`, `lib/useVoiceOutput.ts`, `lib/useHandsFree.ts`, `lib/chatMic.ts` | `POST /agent/listen/<id>` and `/audio`, `GET /tts` |
| [Structured runs](../modules/structured-runs.md) | Plans written as `skill::params` lines and the button panel. | `components/AgentPanel.tsx`, `components/ButtonPanel.tsx`, `lib/buttonGroups.ts` | `/buttons`, `/buttons/groups`, `/buttons/bulk`, `/buttons/reorder`; the run uses `WS /ws/agent` |
| [Plan view](../modules/plan-view.md) | The plan progress list and the Robot State panel. | `components/PlanPanel.tsx`, `components/PlanList.tsx`, `lib/planView.ts` | `GET` and `PUT /agent/world`, `GET /agent/llm-config` |
| [Cameras](../modules/cameras.md) | Live camera frames and depth capture. | `components/CameraFeed.tsx`, `components/CameraCell.tsx`, `lib/depthPng.ts` | `WS /ws/camera/<id>` |
| [Map](../modules/map.md) | The map tab: layers, click to move, settings, simulator. | `components/MapPanel.tsx`, `components/MapSettings.tsx`, `lib/mapObjects.ts`, `components/mapSim.tsx` | `POST /map/snapshot`, `/skill-configs/MAP` and `/ENV`, `PUT /agent/world`, `POST /skill/<name>`, `/agent/<name>/get` and `/send`, `WS /ws/camera/<id>` |
| [Teleop and poses](../modules/teleop-poses.md) | Teleop switches and the Go-to pose editor. | `components/TeleopBar.tsx`, `components/PoseEditor.tsx`, `lib/teleop.ts`, `lib/poses.ts` | `/teleop`, `/teleop/<name>/enable`, `/teleop/<name>/speed`, `/poses`, `/poses/<id>/run`, `/poses/speed`, `/poses/defaults` |
| [Recorder](../modules/recorder.md) | Start and stop a teleoperation recording. | `components/RecorderBar.tsx`, `lib/recorder.ts`, `lib/useRecorder.ts` | `/recorder`, `/recorder/start`, `/recorder/stop`, `/recorder/prompt`, `POST /poses/<id>/run`, `POST /teleop/<name>/enable` |
| [Data tab](../modules/data-tab.md) | Browse, edit, clean and export recorded episodes. | `components/DataPanel.tsx`, `lib/recordings.ts` | `/recordings`, `/recordings/<day>/<episode>` (`GET`, `DELETE`), `.../edit` (`PUT`, `DELETE`), `.../frame`, `POST /recordings/auto-clean`, `POST /recordings/export`, `GET /recorder` |
| [Robots and connections](../modules/robots-connections.md) | Choose a robot, manage connections, API keys and sites. | `components/DevicePanel.tsx`, `components/ServerListEditor.tsx`, `lib/targetBadge.ts` | `/connects`, `/connects/status`, `/connects/servers`, `/ros/scan`, `/config/locations`, `/agent/api-keys`, `POST /agent/api-key`, `POST /skill/warmup_servers`, `GET /skills` |
| [Skills](../modules/skills.md) | List, add, edit and reload skills and their configs. | `components/SkillPanel.tsx`, `components/PlanSkillEditor.tsx`, `components/SkillAliasesEditor.tsx` | `/skills`, `/skills/<name>`, `/skills/status`, `POST /skills/reload`, `/skill-configs/<name>` |
| [Configs](../modules/configs.md) | Global configs: places, planner prompt, config fields. | `components/EnvPanel.tsx`, `components/EnvNamesEditor.tsx`, `components/EnvLocationsEditor.tsx`, `components/ConfigFields.tsx`, `components/PlannerPromptPanel.tsx` | `/skill-configs`, `/skill-configs/<name>` (`GET`, `PUT`, `PATCH`), `GET /planner/prompt`, `GET /skills`, `GET /buttons`, `GET /agent/<name>/get` |
| [Capture and logs](../modules/capture-logs.md) | Browser-side screen, audio and dataset capture for a run. | `lib/useScreenRecorder.ts`, `lib/recordAudio.ts`, `lib/datasetLog.ts`, `components/RecordAudioToggles.tsx` | `GET /tts`; the files are written in the browser |
| [Shared widgets](../modules/shared-widgets.md) | Small parts that several panels use. | `components/PopoverButton.tsx`, `components/PanelSearch.tsx`, `components/ExpandEditor.tsx`, `components/GuidePanel.tsx` | None |
| [Hooks](../modules/hooks.md) | Polling hooks that hold backend state for a panel. | `lib/useRecorder.ts`, `lib/useTeleop.ts`, `lib/usePoses.ts`, `lib/useRobotLanguages.ts` | `GET /recorder`, `/teleop`, `/poses`, `/robot/languages` |
| [Lint](../modules/lint.md) | Static rules: one client, URLs in the snapshot, workaround tags. | `scripts/lint.mjs` | None (reads `lib/api.ts` and the snapshot) |
| [Tests](../modules/tests.md) | Unit tests of the pure `lib/` modules on recorded runs. | `scripts/test_lib.mjs`, `scripts/fixtures/events/` | None |
| [Build and deploy](../modules/build-deploy.md) | Static export and the `make` targets. | `Makefile`, `next.config.js`, `package.json` | None |

## Files that are not components or `lib/`

| File | What it is | Page |
|---|---|---|
| `Makefile` | Targets for run, install, lint, typecheck, unit, smoke, ci, gen-types and deploy. | [Build and deploy](../modules/build-deploy.md) |
| `frontend/next.config.js` | Sets `output: 'export'`, so the build is plain files. | [Build and deploy](../modules/build-deploy.md) |
| `frontend/package.json`, `package-lock.json` | Dependencies and npm scripts. | [Build and deploy](../modules/build-deploy.md) |
| `frontend/tsconfig.json`, `tailwind.config.ts`, `postcss.config.js` | TypeScript and styling configuration. | [Build and deploy](../modules/build-deploy.md) |
| `.github/workflows/deploy-docs.yml`, `.gitignore` | Publishing the existing docs site; ignored paths. | [Build and deploy](../modules/build-deploy.md) |
| `scripts/lint.mjs` | The lint. | [Lint](../modules/lint.md) |
| `scripts/test_lib.mjs`, `scripts/fixtures/events/` | The unit tests and 8 recorded event streams. | [Tests](../modules/tests.md) |
| `scripts/gen_types.sh`, `scripts/dump_openapi.py` | Dump the backend OpenAPI into `lib/generated/openapi.json`. | [Generated contract](../modules/generated-contract.md) |
| `CLAUDE.md`, `README.md` | Rules for contributors and the project readme. | [Lint](../modules/lint.md) (rules) |

## Coverage check

A script listed every tracked file under `frontend/app/`, `frontend/components/` and `frontend/lib/` at `4a810a3717ab` and compared it with the `sources:` lists of the 21 module pages. One file is on no page: `lib/room_configs.json`. Nothing imports it, and `docs/backend_coupling.md` in the repo says so. It is an old sample of an `ENV` config and has no effect on the dashboard.

!!! note
    Two bundled JSON files are used: `lib/skill_configs.json` and `lib/ros_templates.json`. They are the only data files the lint allows in the bundle. See [Lint](../modules/lint.md).
