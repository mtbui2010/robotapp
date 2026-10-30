# robotapp rules (full text)

The short form is in [../CLAUDE.md](../CLAUDE.md); the numbers match.

## 1. Only call endpoints that are in robot_agent's OpenAPI

And only from `frontend/lib/api.ts` (a `fetch` / `WebSocket` elsewhere takes its
URL from an `api.` helper). Types for backend data are generated from OpenAPI /
the event schema (`make gen-types`), not written by hand; until the backend
declares response models, keep hand-written types in `frontend/lib/types.ts` and
list them in [backend_coupling.md](backend_coupling.md). A new endpoint in
robot_agent is reflected in `frontend/lib/` and in
`frontend/lib/generated/openapi.json` (`make gen-types`).

Why: the dashboard must work with every robot_agent-based backend; one client
module and generated types keep it in step with the API.

## 2. Do not bundle robot data

Skill names, config-group maps, ENV / locations, capabilities: get them from the
backend. The two existing bundles (`lib/skill_configs.json`,
`lib/ros_templates.json`) are on an allowlist in `scripts/lint.mjs`; do not add
to it.

Why: bundled data is right for one robot only and goes stale.

## 3. Do not compensate for backend bugs in the UI

Report the bug in the backend repo and fix it there, then delete the UI code.
Existing workarounds are tagged `BACKEND-WORKAROUND(<id>)` and listed in
[backend_coupling.md](backend_coupling.md); a new tag without an entry there
fails `make lint`.

Why: the CLI and Python API users do not get the UI's fix.

## 4. CI: `make ci` passes before a commit

`make ci` = `make lint typecheck smoke`. It needs `frontend/node_modules` and
nothing else: no backend, no network, no dev server. See [commands.md](commands.md).

## 5. Docs

A feature change updates its `docs/features/<feature>.md`
([features/README.md](features/README.md)) and adds one dated line to
[CHANGELOG.md](CHANGELOG.md). CLAUDE.md stays short: rules and links only; details
(layout, commands, deploy) go in `docs/*.md`.

## 6. Never start a run as a side effect of reading

Every `POST /skill/<name>` (and `POST /agent/<name>/send`) calls `begin_run()`,
which clears a Stop / Cancel in progress. Read device state with
`GET /agent/<name>/get` (the Map tab's pose), never by running a skill such as
`mobile_pose`.

Why: a poll that runs a skill silently undoes the operator's Stop.

## 7. Two clients driving one robot is unsafe

`POST /skill/<name>` is the same path the CLI (`<pkg> <name>::<inputs>`) resolves
through `SkillRegistry.execute()`; Cancel is process-wide and stops both. Say so
in any operator-facing UI that can move the robot.

## 8. Ask before motion on real robots

Map clicks and similar one-click motion go through the `confirm_goal` check
(`MAP.confirm_goal`).

## 9. Commit messages say what changed and why

No bare `YYYYMMDD -`.
