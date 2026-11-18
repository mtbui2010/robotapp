---
sources:
  - scripts/dump_openapi.py
  - scripts/gen_types.sh
  - scripts/lint.mjs
  - Makefile
  - frontend/lib/types.ts
  - frontend/lib/api.ts
  - frontend/lib/generated/openapi.json
  - docs/backend_coupling.md
  - CLAUDE.md
verified_at: 4a810a3717ab
---

# 2. The contract: OpenAPI, the lint check, and hand-written types

You will learn how the dashboard and the backend agree on what URLs exist, what is checked, and what is not.

!!! abstract "In this chapter"
    - The repo keeps a snapshot of the backend's OpenAPI. A lint check uses it to test that every URL in `lib/api.ts` is a real path.
    - The types of the replies are written by hand in `lib/types.ts`. They are not generated. No `openapi.d.ts` exists at the pinned commit.
    - The WebSocket routes are not in OpenAPI, so the event stream has no machine-checked contract at all.

## The question: how do I know the dashboard calls real endpoints?

OpenAPI is a standard JSON description of an HTTP API: its paths, methods and (when the server declares them) request and reply shapes. A FastAPI backend can produce one from its code. Getting it normally means booting the backend, which here means a robot. The repo avoids that.

`scripts/dump_openapi.py` mounts the same 16 routers on a bare FastAPI app, in the order the backend uses, and asks the app for its OpenAPI. No robot, device or ROS is started.

[`scripts/dump_openapi.py:17-33`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/dump_openapi.py#L17-L33)

```python
ROUTERS = ['devices', 'skills', 'configs', 'buttons', 'agent', 'camera',
           'diagnostics', 'locations', 'planner', 'robot', 'tts', 'map', 'teleop', 'recorder', 'recordings', 'poses']


def main(out: str) -> None:
    app = FastAPI(title='robot_agent')
    for name in ROUTERS:
        app.include_router(importlib.import_module(f'robot_agent.api.{name}').router)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        spec = app.openapi()
    for w in caught:                       # e.g. duplicate POST /skills (agent.py + skills.py)
        print(f'warning: {w.message}', file=sys.stderr)
    with open(out, 'w') as f:
        json.dump(spec, f, indent=1, sort_keys=True, ensure_ascii=False)
        f.write('\n')
    print(f'{out}: {len(spec["paths"])} paths, {len(spec.get("components", {}).get("schemas", {}))} schemas')
```

`make gen-types` (`Makefile:56-60`) runs `scripts/gen_types.sh`, which needs a `robot_agent` checkout (`ROBOT_AGENT_DIR`) and a Python with FastAPI. It writes `frontend/lib/generated/openapi.json`. It writes `openapi.d.ts` only if `openapi-typescript` is installed in `frontend/node_modules`, and it is not. This command was not run for this site.

## What the snapshot contains

Counted from the committed `openapi.json` with a short script on 2026-11-19, offline Linux workstation:

| number | value |
|---|---|
| paths | 66 |
| operations (method plus path) | 85 |
| schemas | 63 |
| operations with a typed 200 reply (a `$ref` to a schema, or an array of `$ref`) | 47 |
| URL templates built in `lib/api.ts` | 77 (75 HTTP, 2 WebSocket) |

Typed replies by router prefix, for the families the dashboard uses most:

| prefix | operations | typed |
|---|---|---|
| `/agent` | 12 | 9 |
| `/buttons`, `/config`, `/connects` | 11, 6, 7 | 0, 0, 0 |
| `/poses` | 7 | 7 |
| `/recorder` | 4 | 4 |
| `/recordings` | 8 | 7 |
| `/runs` | 8 | 8 |
| `/teleop` | 3 | 3 |

Setup calls (`/connects`, `/buttons`, `/config`) have no declared reply shape. The full table is on [the generated contract page](../modules/generated-contract.md). A different test of "typed" (any 2xx, not only 200) gives slightly different counts there. Neither number says that a declared shape is complete.

## What the lint does with it

`make lint` runs `scripts/lint.mjs`. Check 1 reads each `${getAgentUrl()}/...` and `${getWsBase()}/...` template in `lib/api.ts`, turns it into a plain path, and tests it against every OpenAPI path.

[`scripts/lint.mjs:51-60`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/lint.mjs#L51-L60)

```js
  const re = /\$\{get(?:AgentUrl|WsBase)\(\)\}(\/[^`?]*)/g
  let m, n = 0
  while ((m = re.exec(text))) {
    n += 1
    // `${...}` segments → one placeholder segment; a `.join('/')` path → many
    const path = m[1].replace(/([^/])\$\{[^}]*\}$/, '$1')    // trailing `${q}`: a query string
      .replace(/\$\{[^}]*join\('\/'\)\}/g, 'x/y').replace(/\$\{[^}]*\}/g, 'x')
    if (path.startsWith('/ws/')) continue
    if (!known.some(([, r]) => r.test(path))) err(apiFile, lineOf(text, m.index), `${m[1]} is not in robot_agent's OpenAPI`)
  }
  console.log(`lint: ${n} endpoint URLs in lib/api.ts checked against ${known.length} OpenAPI paths`)
```

Real output, `node scripts/lint.mjs`, 2026-11-19, same machine, exit code 0 (the first line is the one for this chapter):

```text
lint: 77 endpoint URLs in lib/api.ts checked against 66 OpenAPI paths
lint: 65 files, 5 BACKEND-WORKAROUND tags
lint: eslint not installed in frontend/node_modules — skipped (npm i -D eslint eslint-config-next to enable)
lint: ok
```

What the check proves and what it does not:

| it checks | it does not check |
|---|---|
| each HTTP path in `api.ts` exists in the snapshot | the HTTP method (a wrong method on a real path passes) |
| `/ws/` paths are skipped (OpenAPI does not list WebSocket routes) | request bodies and reply shapes |
| the snapshot is the one in the repo | that the snapshot is as new as the running backend |

If `openapi.json` is missing, the check is skipped with a message and the lint can still print `lint: ok`.

## Why the types are still written by hand

Repo rule 1 says "generate types (`make gen-types`)". At the pinned commit that is not what happens. `make gen-types` makes only the JSON snapshot. `lib/api.ts` imports its types from `lib/types.ts` (292 lines) and from small type files such as `poses.ts` and `recorder.ts`. `docs/architecture.md` says of `lib/types.ts`: "hand-written backend types (to be generated)".

This is current behaviour, not a plan. The consequence is a real gap. `fetch` replies are cast, so a field the backend renamed makes `tsc` pass and fails later, where the page reads the field. The same is true of events: `AgentEvent` in `lib/types.ts` is one interface with 54 optional fields besides `event`. It has one field, `_rx`, that the backend never sends.

!!! note
    `docs/backend_coupling.md` still says 38 paths, 21 schemas and no typed replies. The counts above come from the committed snapshot and are newer.

!!! code "Where in the code"
    - Snapshot writer: [`scripts/dump_openapi.py:17-33`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/dump_openapi.py#L17-L33), wrapper [`scripts/gen_types.sh`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/gen_types.sh#L13-L31)
    - The check: [`scripts/lint.mjs:39-62`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/lint.mjs#L39-L62)
    - Hand-written types: [`frontend/lib/types.ts`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/lib/types.ts#L1-L292)
    - Module pages: [generated contract](../modules/generated-contract.md), [lint](../modules/lint.md)

## What this means when you use it

- Add an endpoint call only in `lib/api.ts`. Run `make lint`; it fails if the path is not in the snapshot.
- A passing lint does not mean the call works. Test it against the backend.
- When the backend adds a route, refresh the snapshot with `make gen-types`, then commit the diff. If you do not, the lint will reject the new URL.
- Treat `lib/types.ts` as a claim you must keep in step with the backend by reading it. Nothing flags drift.
- For the backend side of the contract, see [the robot_agent site](https://mtbui2010.github.io/robot_agent/).

**Next:** [3. The agent event stream →](03-event-stream.md)
