# robotapp

**A browser dashboard for any `robot_agent` backend: give the robot a task, watch every step, and stop it at any time.**

robotapp is a set of static web files. In the browser it sends a task (text or a written plan) to one backend URL, and it turns the backend's answers, event stream and camera frames into panels: chat, plan steps, cameras, a map and a recorder. It holds no robot data of its own, so one copy serves any robot that runs `robot_agent`. The backend is described on the [robot_agent site](https://mtbui2010.github.io/robot_agent/).

## The panels

| Panel | What it does | Page |
|---|---|---|
| Chat | Type a task, pick a planner, answer the robot, stop | [Chat](modules/chat.md) |
| Plan, log, Robot State | Shows one run as a list of steps with ticks | [Plan view](modules/plan-view.md) |
| Agent and shortcut buttons | Run a plan you wrote, once, N times or forever; saved plans as buttons | [Structured runs](modules/structured-runs.md) |
| Cameras tab | Live colour and depth frames | [Cameras](modules/cameras.md) |
| Map tab | The site map with the robot; a click sends the robot there | [Map](modules/map.md) |
| Remote control strip and Go-to poses | Teleop switches and named arm poses | [Teleop and poses](modules/teleop-poses.md) |
| Record bar | Start and stop a teleoperation recording | [Recorder](modules/recorder.md) |
| Data tab | Look at, clean and export recorded episodes | [Data tab](modules/data-tab.md) |
| Devices | Choose the robot, the site, connections and AI servers | [Robots and connections](modules/robots-connections.md) |
| Skills | List, edit and reload the robot's skills and their configs | [Skills](modules/skills.md) |
| Global configs, Planner prompt | Edit places (`ENV`) and other config groups | [Configs](modules/configs.md) |
| Voice | The browser speaks the robot's lines and records answers | [Voice](modules/voice.md) |

The Data tab and the remote control strip appear only when the backend offers them.

## Start here

1. [Getting started](getting-started.md): install, and run the three offline checks.
2. [Where robotapp sits](overview.md): the dashboard, the backend and the robot.
3. [Key ideas](how-it-works/key-ideas.md): the eight design ideas, with evidence.

## Where to go

| You are | Read |
|---|---|
| An operator | [Connect to a robot](guides/connect.md), [Give a task in the chat](guides/chat-task.md), [Stop a run](guides/stop.md), [Move from the Map tab](guides/map-move.md), [Use two tabs](guides/two-tabs.md) |
| An integrator | [1. Where robotapp sits](learn/01-ui-mode.md), [2. The contract](learn/02-contract.md), [Endpoints](reference/endpoints.md), [Backend coupling](reference/backend-coupling.md), [MAP config](reference/map-config.md) |
| A developer | [How it works](how-it-works/index.md), [Code map](how-it-works/code-map.md), [Proving it works](how-it-works/correctness.md), [Tests](modules/tests.md), [Make targets](reference/make-targets.md), [Glossary](reference/glossary.md) |

## Verified so far

Everything here was checked at commit `4a810a3717ab`, on one offline Linux workstation with Node v22.23.3, on 2026-11-19.

| What | How it was checked | Result |
|---|---|---|
| Repo rules | `node scripts/lint.mjs`: 77 URLs in `lib/api.ts` against 66 OpenAPI paths | `lint: ok` |
| Pure logic | 78 unit tests on 8 recorded runs ([Tests](modules/tests.md)) | 78 passed, 0 failed |
| Types | `tsc --noEmit` | exit 0 |
| Pure `lib/` modules | probe scripts that load them through the repo's own esbuild; their output is on the module pages | output shown as run |
| Every other claim | read in the code | pinned links on each page |

## Not yet

- No browser: nothing visual was seen, and there are no screenshots.
- No backend: no HTTP or WebSocket call was made.
- No robot: every guide says "checked in code, not run against a robot".
- No `next build` or `make smoke`: they write build folders.

See [Proving it works](how-it-works/correctness.md) for the levels, and [Backend coupling](reference/backend-coupling.md) for what the dashboard still assumes about a backend.
