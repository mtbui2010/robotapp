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
