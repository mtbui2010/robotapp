---
sources:
  - scripts/lint.mjs
  - frontend/lib/api.ts
  - frontend/lib/generated/openapi.json
  - docs/backend_coupling.md
  - CLAUDE.md
  - docs/rules.md
verified_at: 4a810a3717ab
---

# Repo rules as a lint (`scripts/lint.mjs`)

!!! abstract "In this page"
    What `make lint` checks, how each check works, the real output of a run, and what the lint does not see. It needs only Node and `frontend/node_modules`. No backend, no network.

The lint is one file of 112 lines with no dependencies. It turns the first rules of `CLAUDE.md` into checks that fail the build. It reads source text with regular expressions; it does not parse TypeScript.

## What it checks

| # | Rule | How | Lines |
|---|---|---|---|
| 1 | Every backend URL built in `lib/api.ts` exists in the OpenAPI file `frontend/lib/generated/openapi.json` | Find each `${getAgentUrl()}/...` and `${getWsBase()}/...` template, turn it into a plain path, match it against every OpenAPI path | `lint.mjs:39-62` |
| 2 | Only `lib/api.ts` talks HTTP | In every other file, `fetch(` and `new WebSocket(` must take a first argument that starts with `api.` | `lint.mjs:67-74` |
| 3 | No new bundled robot data | A `import x from '...json'` under `frontend/` must resolve to `lib/skill_configs.json` or `lib/ros_templates.json` | `lint.mjs:23, 75-81` |
| 4 | Every workaround is listed | Each `BACKEND-WORKAROUND(<id>)` tag in the code must have its `<id>` in `docs/backend_coupling.md` | `lint.mjs:84-96` |
| - | ESLint | Run `next lint` only when `node_modules/.bin/eslint` exists | `lint.mjs:98-105` |

The scan covers `frontend/app`, `frontend/components` and `frontend/lib` (`.ts` and `.tsx`; folders named `node_modules`, `out` or starting with a dot are skipped). Any problem prints as `<file>:<line>: <message>`, then `lint: <n> problem(s)`, and the exit code is 1.

## Real output

Run on 2026-11-19 at commit `4a810a3717ab`, Node v22.23.3, Linux, from the repo root with `node scripts/lint.mjs`. Exit code 0.

```
lint: 77 endpoint URLs in lib/api.ts checked against 66 OpenAPI paths
lint: 65 files, 5 BACKEND-WORKAROUND tags
lint: eslint not installed in frontend/node_modules — skipped (npm i -D eslint eslint-config-next to enable)
lint: ok
```

| Number | Meaning |
|---|---|
| 77 | URL templates found in `lib/api.ts` (WebSocket routes under `/ws/` are counted but not checked) |
| 66 | Paths in the OpenAPI file |
| 65 | `.ts` and `.tsx` files scanned |
| 5 | `BACKEND-WORKAROUND` tags in the code |

The five tags at this commit:

| Id | Where |
|---|---|
| `hri-narrator-gate` | `frontend/app/page.tsx:347` |
| `delete-active-location` | `frontend/components/DevicePanel.tsx:448` |
| `map-arrive-check` | `frontend/components/MapPanel.tsx:279` |
| `plan-event-shape` | `frontend/components/PlanPanel.tsx:555` |
| `done-event-shape` | `frontend/components/PlanPanel.tsx:615` |

!!! note
    `docs/backend_coupling.md` section 3 gives older line numbers for these tags. The table above comes from a search of the code at the pinned commit.

## The endpoint check

```js
// 1. endpoints vs OpenAPI
const specPath = join(FE, 'lib/generated/openapi.json')
if (!existsSync(specPath)) {
  console.log('lint: no frontend/lib/generated/openapi.json (scripts/gen_types.sh) — endpoint check skipped')
} else {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const toRe = p => new RegExp('^' + p.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{(?:[^}]+:path|path|cid|connect_id)\}/g, '.+')   // FastAPI drops `:path` from OpenAPI
    .replace(/\{[^}]+\}/g, '[^/]+') + '$')
  const known = Object.keys(spec.paths).map(p => [p, toRe(p)])
  const apiFile = join(FE, 'lib/api.ts')
  const text = readFileSync(apiFile, 'utf8')
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
}
```

Source: [`scripts/lint.mjs:39-62`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/lint.mjs#L39-L62).

Read it in this order. Each OpenAPI path becomes a regular expression: a `{name}` segment matches one segment, and a path-typed segment (name followed by `:path` inside braces) (and the names `path`, `cid`, `connect_id`) matches several, because FastAPI removes the `:path` marker from the OpenAPI file. Each URL in `api.ts` becomes a plain path: `${...}` parts become the letter `x`, a trailing `${q}` is read as a query string and dropped. If the OpenAPI file is missing, the check is skipped with a message and the run can still end with `lint: ok`.

## Limits

- The check compares the path only, not the HTTP method. If `api.ts` calls `DELETE /x` and the backend has only `GET /x`, the lint passes (`lint.mjs:51-59` read the path and nothing else).
- It sees only URLs written as a template that starts with `${getAgentUrl()}` or `${getWsBase()}`. A URL built another way is not checked.
- The `/ws/` routes are skipped, because OpenAPI does not list WebSocket routes.
- Rule 4 tests that the id appears anywhere in `docs/backend_coupling.md` (`coupling.includes(id)`), not that it has its own entry.
- Rule 3 matches only default imports of a `.json` file (`import name from '...json'`).
- ESLint is not a dependency of the frontend, so that step is skipped. To turn it on, install it as the message says.
- The OpenAPI file is a copy. `make gen-types` refreshes it from a `robot_agent` checkout; the lint does not.

## Failure modes

| You see | Cause | Fix |
|---|---|---|
| `<path> is not in robot_agent's OpenAPI` | A new URL in `api.ts` that the backend file does not have, or an old copy of the OpenAPI file | Fix the path, or run `make gen-types` against a current `robot_agent` |
| `fetch() outside lib/api.ts — add a wrapper there` | A component calls `fetch(` with a URL that does not start with `api.` | Add a function to `lib/api.ts` and call that |
| `bundles <file>: robot data must come from the backend (rule 2)` | A new `.json` import | Read the data from the backend instead |
| `workaround <id> is not listed in docs/backend_coupling.md` | A new tag with no entry | Add the id to that file |
| `frontend/node_modules missing: run 'make install'` | `make lint` runs `check-deps` first | `make install` |

## Tests

The lint itself has no test. Its proof is the run above. The unit tests are on [the tests page](tests.md); the targets that call this script are on [the build page](build-deploy.md).

!!! code "Where in the code"
    - `scripts/lint.mjs`: the whole lint (rules at lines 39-96, ESLint at 98-105).
    - `Makefile:39-40`: the `lint` target (`check-deps`, then `node scripts/lint.mjs`).
    - `frontend/lib/generated/openapi.json`: the OpenAPI copy the paths are checked against.
    - `docs/backend_coupling.md`: the list of workarounds and bundled files.
