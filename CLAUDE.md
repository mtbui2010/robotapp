# robotapp — rules

Next.js 14 dashboard (App Router, TailwindCSS, static export → Cloudflare Pages) that talks to a
`robot_agent`-based backend over HTTP. It is the **UI mode** of the robot stack; the CLI and the Python API
live in each robot package (`kcare_robot/__main__.py`, `kcare_robot.skills.*`) and bootstrap in-process. The
dashboard is **not** required to operate the robot.

This file holds rules only. Specs: [docs/features/](docs/features/README.md). History:
[docs/CHANGELOG.md](docs/CHANGELOG.md). What the UI still knows that it should get from the backend:
[docs/backend_coupling.md](docs/backend_coupling.md).

## Rules

1. **Only call endpoints that are in robot_agent's OpenAPI**, and only from `frontend/lib/api.ts` (a
   `fetch` / `WebSocket` elsewhere takes its URL from an `api.` helper). Types for backend data are
   generated from OpenAPI / the event schema (`make gen-types`), not written by hand; until the backend
   declares response models, keep hand-written types in `frontend/lib/types.ts` and list them in
   `docs/backend_coupling.md`. A new endpoint in robot_agent is reflected in `frontend/lib/` and in
   `frontend/lib/generated/openapi.json` (`make gen-types`).
2. **Do not bundle robot data** (skill names, config-group maps, ENV / locations, capabilities). Get it from
   the backend. The two existing bundles (`lib/skill_configs.json`, `lib/ros_templates.json`) are on an
   allowlist in `scripts/lint.mjs`; do not add to it.
3. **Do not compensate for backend bugs in the UI.** Report the bug in the backend repo and fix it there,
   then delete the UI code. Existing workarounds are tagged `BACKEND-WORKAROUND(<id>)` and listed in
   `docs/backend_coupling.md`; a new tag without an entry there fails `make lint`.
4. **CI: `make ci`** (= `make lint typecheck smoke`) passes before a commit. It needs
   `frontend/node_modules` and nothing else: no backend, no network, no dev server.
5. **Docs:** a feature change updates its `docs/features/<feature>.md` and adds one dated line to
   `docs/CHANGELOG.md`. This file stays short: rules only.
6. **Never start a run as a side effect of reading.** Every `POST /skill/<name>` (and
   `POST /agent/<name>/send`) calls `begin_run()`, which clears a Stop / Cancel in progress. Read device
   state with `GET /agent/<name>/get` (the Map tab's pose), never by running a skill such as `mobile_pose`.
7. **Two clients driving one robot is unsafe.** `POST /skill/<name>` is the same path the CLI
   (`<pkg> <name>::<inputs>`) resolves through `SkillRegistry.execute()`; Cancel is process-wide and stops
   both. Say so in any operator-facing UI that can move the robot.
8. **Ask before motion on real robots**: map clicks and similar one-click motion go through the
   `confirm_goal` check (`MAP.confirm_goal`).
9. **Commit messages say what changed and why** (no bare `YYYYMMDD -`).

## Layout

```
robotapp/
├── frontend/                 # Next.js 14 app
│   ├── app/                  # routes (page.tsx = the dashboard)
│   ├── components/           # DevicePanel, AgentPanel, PlanPanel, MapPanel, …
│   ├── lib/api.ts            # the only HTTP / WebSocket client
│   ├── lib/types.ts          # hand-written backend types (to be generated)
│   ├── lib/generated/        # openapi.json (+ openapi.d.ts) from scripts/gen_types.sh
│   └── out/                  # static export (deploy artifact, gitignored)
├── docs/features/            # feature specs (moved from this file)
├── docs/CHANGELOG.md         # dated history
├── docs/backend_coupling.md  # bundled data, hand-written types, workarounds → endpoints
├── docs/                     # also the Astro docs site (src/, astro.config.mjs)
├── scripts/                  # lint.mjs, gen_types.sh, dump_openapi.py
├── Makefile
└── test                      # transient note file (not a test suite)
```

## Commands

```bash
make install            # npm install in frontend/
make run-frontend       # next dev on :3007
make ci                 # lint + typecheck + smoke (static build)
make gen-types ROBOT_AGENT_DIR=../robot_agent PYTHON=python3   # refresh lib/generated/openapi.json
make build-frontend     # static export to frontend/out/
CLOUDFLARE_API_TOKEN=… make deploy
make deploy-status
```

Cloudflare Pages project: `robotapp`. Custom domain: `robot.aistations.org`. Account ID is pinned in
[Makefile](Makefile).

## Related

- [robot_agent](../robot_agent) — backend FastAPI runtime (`app_factory.create_app`).
- [kcare_robot](../kcare_robot) — reference robot backend used in development. Boots on port 8001.
- [robot_template](../robot_template) — generator for new robot backends; every new project is
  dashboard-compatible by default (same `robot_agent` API).
