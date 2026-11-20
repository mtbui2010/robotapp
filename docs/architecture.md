# robotapp architecture

Next.js 14 dashboard (App Router, TailwindCSS, static export -> Cloudflare Pages)
that talks to a `robot_agent`-based backend over HTTP. It is the **UI mode** of
the robot stack; the CLI and the Python API live in each robot package
(`kcare_robot/__main__.py`, `kcare_robot.skills.*`) and bootstrap in-process. The
dashboard is **not** required to operate the robot.

## Layout

```
robotapp/
├── frontend/                 # Next.js 14 app
│   ├── app/                  # routes (page.tsx = the dashboard)
│   ├── components/           # DevicePanel, AgentPanel, ChatPanel, PlanPanel (+ PlanList), MapPanel, FleetPanel, …
│   ├── lib/api.ts            # the only robot_agent HTTP / WebSocket client
│   ├── lib/fleet.ts          # the only robot_fleet (fleet manager) client; types in lib/fleet_types.ts
│   ├── lib/types.ts          # hand-written backend types (to be generated)
│   ├── lib/generated/        # openapi.json (+ openapi.d.ts) from scripts/gen_types.sh
│   └── out/                  # static export (deploy artifact, gitignored)
├── docs/features/            # feature specs
├── docs/CHANGELOG.md         # dated history
├── docs/backend_coupling.md  # bundled data, hand-written types, workarounds → endpoints
├── docs/                     # also the Astro docs site (src/, astro.config.mjs)
├── scripts/                  # lint.mjs, gen_types.sh, dump_openapi.py
├── Makefile
└── test                      # transient note file (not a test suite)
```

## Related repos

- [robot_agent](../../robot_agent/CLAUDE.md): backend FastAPI runtime (`app_factory.create_app`).
- [kcare_robot](../../kcare_robot/CLAUDE.md): reference robot backend used in development. Boots on port 8001.
- [robot_template](../../robot_template/CLAUDE.md): generator for new robot backends; every new project
  is dashboard-compatible by default (same `robot_agent` API).
- robot_fleet (`../robot_fleet`, [SPEC](../../robot_fleet/docs/SPEC.md)): the fleet manager the Fleet tab talks to
  (default `http://localhost:8100`); it drives several robot_agent robots.
