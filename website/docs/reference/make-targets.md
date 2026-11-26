---
sources:
  - Makefile
  - frontend/package.json
  - frontend/next.config.js
  - frontend/tsconfig.json
  - scripts/lint.mjs
  - scripts/test_lib.mjs
  - scripts/gen_types.sh
  - scripts/dump_openapi.py
verified_at: 4a810a3717ab
---

# Make targets

!!! abstract "In this page"
    Every target of the root `Makefile` at commit `4a810a3717ab`: what it runs, what it needs, what it writes, and the real output of `lint` and `unit`. Targets that need a browser, a network, a backend or an install were not run for this page.

Run `make <target>` in the repository root. Targets that use the checks need `frontend/node_modules` (run `make install` once); they stop with a message if `frontend/node_modules/.bin/tsc` is missing (`check-deps`).

## Targets

| Target | Runs | Needs | Writes |
|---|---|---|---|
| `install`, `install-frontend` | `npm install` in `frontend/` | network, npm | `frontend/node_modules/` |
| `run-frontend` | `npm run dev -- -p 3007` in `frontend/` | `node_modules` | `frontend/.next/` |
| `terminate` | `fuser -k 3007/tcp`, then prints "Terminated frontend (3007)" | `fuser` | nothing |
| `build-frontend` | `npm run build` (`next build`) | `node_modules` | `frontend/.next/`, `frontend/out/` |
| `check-deps` | tests that `frontend/node_modules/.bin/tsc` is executable | `node_modules` | nothing |
| `lint` | `node scripts/lint.mjs` | `check-deps` | nothing |
| `typecheck` | `tsc --noEmit -p .` in `frontend/` | `check-deps` | `frontend/tsconfig.tsbuildinfo` |
| `unit` | `node --test-reporter=spec scripts/test_lib.mjs` | `check-deps` | files in the temp directory |
| `smoke` | `next build` with telemetry off, then checks that `frontend/out/index.html` has `<html` | `check-deps` | `frontend/.next/`, `frontend/out/` |
| `ci` | `lint`, `typecheck`, `unit`, `smoke`, in that order | all of the above | all of the above |
| `gen-types` | `scripts/gen_types.sh` with `ROBOT_AGENT_DIR` and `PYTHON` | a `robot_agent` checkout, Python with FastAPI | `frontend/lib/generated/openapi.json` |
| `deploy` | builds, then uploads `frontend/out/` to a static host | a token in the environment, network | the host |
| `deploy-status` | asks the host for the state of the last upload | a token in the environment, network | nothing |

`ci` is defined as `ci: lint typecheck unit smoke` (`Makefile:54`). The contributor note `docs/rules.md` says `ci` is lint, typecheck and smoke; at this commit it also runs `unit`.

### The dev port

`Makefile:15` passes `-p 3007`, while `frontend/package.json:6` sets `next dev --port 3001`. `make run-frontend` runs `npm run dev -- -p 3007`, so both flags reach `next dev`. The README and the Makefile say 3007. Which flag wins was not run here; if you start the server with `npm run dev` directly, the port is 3001. `make terminate` frees 3007 only.

### `typecheck` writes a file

`frontend/tsconfig.json` sets `incremental: true`, so `make typecheck` writes `frontend/tsconfig.tsbuildinfo`. The file is ignored by git. Running `tsc --noEmit -p . --incremental false` in `frontend/` checks the same and writes nothing; run for this page it took about 3 s and exited 0.

### `gen-types` and the types

`gen-types` runs `scripts/dump_openapi.py` against the `robot_agent` checkout (default `../robot_agent` next to this repo) and writes `openapi.json`. It then runs `openapi-typescript` only if `frontend/node_modules/.bin/openapi-typescript` exists; otherwise it prints that it skipped `openapi.d.ts` and ends. At this commit there is no `openapi.d.ts` and the package is not in `package.json`, so the dashboard's types are the hand-written `lib/types.ts`. The only use of `openapi.json` is the lint's endpoint check. The skip message ends with "most responses are untyped anyway: robot_agent routes declare no response_model"; that text is out of date, see [Endpoints](endpoints.md) (47 of 85 operations name a reply schema). `gen-types` was not run here: it needs a `robot_agent` checkout.

### `deploy`

`deploy` and `deploy-status` upload the static export to a static host and need a token in the environment. They are not described further here and were not run.

## What `lint` checks

`scripts/lint.mjs` has four checks and runs ESLint too when it is installed:

| # | Check | Fails when |
|---|---|---|
| 1 | endpoints | a path built in `lib/api.ts` is not in `openapi.json` (`/ws/*` is skipped) |
| 2 | HTTP only in `lib/api.ts` | `fetch(` or `new WebSocket(` elsewhere does not take its URL from an `api.` helper |
| 3 | bundled robot data | a `.json` under `frontend/lib` is imported and is not `lib/skill_configs.json` or `lib/ros_templates.json` |
| 4 | workaround tags | a `BACKEND-WORKAROUND(<id>)` id is not written in `docs/backend_coupling.md` |

ESLint is not in `package.json`, so that step is skipped. See [Backend coupling](backend-coupling.md) for what checks 3 and 4 cover.

## Real output

`node scripts/lint.mjs` (the command `make lint` runs), Node v22 on an offline Linux workstation, 2026-11-19, working tree at `4a810a3717ab` with three uncommitted doc and config files that the lint does not use for these counts:

```text
lint: 77 endpoint URLs in lib/api.ts checked against 66 OpenAPI paths
lint: 65 files, 5 BACKEND-WORKAROUND tags
lint: eslint not installed in frontend/node_modules — skipped (npm i -D eslint eslint-config-next to enable)
lint: ok
```

`node --test-reporter=spec scripts/test_lib.mjs` (the command `make unit` runs), same machine and day, summary lines (the 78 test lines before them are not copied):

```text
ℹ tests 78
ℹ suites 0
ℹ pass 78
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 54.575967
```

| Command | Date | Machine | Result |
|---|---|---|---|
| `node scripts/lint.mjs` | 2026-11-19 | offline Linux workstation | exit 0, 4 lines above |
| `node --test-reporter=spec scripts/test_lib.mjs` | 2026-11-19 | offline Linux workstation | 78 tests, 78 pass, 55 ms |

`make smoke`, `make build-frontend` and `make run-frontend` were not run: they write `frontend/.next/` or `frontend/out/`, or start a server.

!!! code "Where in the code"
    [`Makefile:34-54`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/Makefile#L34-L54) (checks), [`scripts/lint.mjs`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/lint.mjs), [`scripts/gen_types.sh`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/gen_types.sh). See also [Lint](../modules/lint.md) and [Tests](../modules/tests.md).
