# robotapp — Real-time Robot Operations Console

> A Next.js 14 ops dashboard for ROS2 mobile manipulators. Live RGB-D streaming,
> open-vocabulary perception control, on-the-fly skill orchestration — deployed
> globally on Cloudflare Pages.

Production URL: **<https://robot.aistations.org>**

The UI tier of a three-mode robot stack (UI / CLI / Python API). Talks to
[`robot_agent`](../robot_agent) — the FastAPI runtime that wraps any ROS2 robot
(reference implementation: [`kcare_robot`](../kcare_robot), generator:
[`robot_template`](../robot_template)).

---

## Why it's interesting

| Capability | What's behind it |
|---|---|
| **Live RGB-D streams** | WebSocket bridge → zlib-compressed uint16 depth → JET colormap decode in the browser, pixel-hover tooltip in millimetres |
| **Multi-camera ops** | Persistent tab order in `localStorage`, drag-to-reorder, auto-tab when a skill emits a `log_image` |
| **Skill orchestration** | Live skill registry CRUD, JSON-edit per-skill configs, hot-reload via `POST /skills/reload` — no robot restart |
| **Streaming task plans** | `GET /ws/agent` yields `start → plan → step_start → step_log(image) → step_done → done` events; UI renders the timeline with inline frames |
| **Multi-robot / multi-tenant** | Robot registry in `localStorage`, active-robot toggle, every API call routed to the selected base URL |
| **Open-vocab perception UI** | Type `apple` or `the red mug on the table` into the agent panel; the backend dispatches to GroundingDINO / GroundedSAM running on a TCP VLM service |
| **Edge deployment** | Static export (`next.config.js: output: 'export'`), uploaded to Cloudflare Pages via `wrangler` — sub-100 ms TTFB from anywhere |

---

## Stack

- **Next.js 14.2** (App Router, static export)
- **React 18.3** + **TypeScript 5** (strict mode)
- **TailwindCSS 3** + PostCSS
- **Wrangler 3.78** for Cloudflare Pages CD
- **Zero state-management lib** — local `useState/useRef`, server state via the typed API client in [frontend/lib/](frontend/lib/)

---

## Architecture

```
                ┌──────────────────────────────────────┐
                │  robotapp (this repo)                │   browser / Cloudflare Pages
                │  Next.js 14 · TypeScript · Tailwind  │
                └────────────────┬─────────────────────┘
                                 │  HTTP + WebSocket
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │  robot_agent  (FastAPI)                          │   on robot host, port 8001
       │  · 30+ REST endpoints                            │
       │  · /ws/camera/{id}     RGB + depth streams       │
       │  · /ws/agent           streaming plan execution  │
       │  · SkillRegistry, DeviceManager, UnifiedAgent    │
       └────────────┬──────────────────────┬──────────────┘
                    │                      │
                    ▼                      ▼
            ROS2 (Humble)          Devices (RealSense, xArm-class
            rclpy · Nav2           cobot, gripper, TCP VLM service)
```

---

## Key components

| Component | LOC | What it does |
|---|---:|---|
| [components/CameraFeed.tsx](frontend/components/CameraFeed.tsx) | 615 | Multi-camera tabs, WebSocket frame decode, depth colormap, pixel-hover mm readout, rectangle annotation overlay |
| [components/DevicePanel.tsx](frontend/components/DevicePanel.tsx) | 1070 | ROS scan, register pub/sub/service/action/WebRTC/TCP/LLM clients, encode/decode template editor |
| [components/SkillPanel.tsx](frontend/components/SkillPanel.tsx) | 422 | Skill CRUD, hot-reload, per-skill JSON config editor with live diff |
| [components/AgentPanel.tsx](frontend/components/AgentPanel.tsx) | 131 | Structured / unstructured prompt input, language selector (EN / KO / VI), Ctrl+Enter dispatch |
| [components/PlanPanel.tsx](frontend/components/PlanPanel.tsx) | 157 | Live task-plan timeline with step status, expandable JSON results, inline log images |
| [components/ButtonPanel.tsx](frontend/components/ButtonPanel.tsx) | 268 | Server-persisted quick-action buttons with drag-reorder + bulk import |
| [components/EnvPanel.tsx](frontend/components/EnvPanel.tsx) | 143 | Live ENV / HOME_LOC editor backed by `/skill-configs` |
| [lib/api.ts](frontend/lib/api.ts) | — | Strongly-typed client covering every backend endpoint |

---

## Local dev

```bash
make install            # npm install in frontend/
make run-frontend       # next dev on http://localhost:3007
```

Point the dashboard at a running `robot_agent` (e.g. `http://192.168.1.42:8001`)
via the **Device** panel. The active robot URL is persisted per browser.

## Deploy to Cloudflare Pages

```bash
export CLOUDFLARE_API_TOKEN=<token>     # needs "Cloudflare Pages: Edit"
make deploy                              # next build → out/ → wrangler pages deploy
make deploy-status                       # custom domain + SSL status
```

Pinned in [Makefile](Makefile): account ID, project name (`robotapp`), domain
(`robot.aistations.org`).

---

## Backend contract (what the dashboard consumes)

```
Skills        GET  /skills           POST /skill/<name>     POST /skills/reload
              PUT  /skills/<name>    DELETE /skills/<name>  GET  /skills/status
              GET  /skill-configs/<name>   PUT /skill-configs/<name>

Devices       GET  /connects         POST /connects         GET /connects/status
              PUT  /connects/<id>    DELETE /connects/<id>  POST /connects/<id>/set_active

Discovery     GET  /ros/scan
Diagnostics   GET  /diagnostics      GET  /diagnostics/boot
Agent         POST /agent/llm-config POST /agent/api-key    GET  /agent/api-keys
Buttons       GET  /buttons          POST /buttons          POST /buttons/reorder ...

Streaming     WS   /ws/camera/<id>   WS   /ws/agent
```

Full router source in [robot_agent/robot_agent/api/](../robot_agent/robot_agent/api/).

---

## Safety note

The robot accepts commands from any of: UI, CLI, or Python API. **Do not run two
clients against the same arm at the same time** — there is no central
arbitration layer. This is surfaced in the dashboard's Guide panel.

---

## Related

- [`robot_agent`](../robot_agent) — FastAPI runtime, skill registry, device
  manager, streaming agent
- [`kcare_robot`](../kcare_robot) — 23-skill reference implementation on a 6-DOF
  cobot with RealSense D405 + Femto Bolt
- [`robot_template`](../robot_template) — cookiecutter that emits a
  dashboard-compatible robot package in seconds
