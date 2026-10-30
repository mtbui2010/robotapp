# robotapp

Next.js dashboard (UI mode) for any `robot_agent`-based backend; not required to operate the robot.
Full rules and reasons: [docs/rules.md](docs/rules.md). Docs index: [docs/README.md](docs/README.md).

## Rules

1. Call only endpoints in robot_agent's OpenAPI, only through `frontend/lib/api.ts`; generate types (`make gen-types`).
2. Bundle no robot data; get it from the backend (do not grow the `scripts/lint.mjs` allowlist).
3. Never work around backend bugs in the UI; fix them in the backend (`BACKEND-WORKAROUND(<id>)` needs a [backend_coupling](docs/backend_coupling.md) entry).
4. Run `make ci` before every commit.
5. Update `docs/features/<feature>.md` and add a dated [CHANGELOG](docs/CHANGELOG.md) line with every feature change.
6. Never start a run as a side effect of reading; read state with `GET /agent/<name>/get`.
7. Warn operators that two clients driving one robot is unsafe (Cancel stops both).
8. Ask before motion on real robots (`MAP.confirm_goal`).
9. Write commit messages that say what changed and why.
10. Keep this file short: one-line rules and links; details go in `docs/*.md`.

## Test

`make ci` (lint + typecheck + smoke; needs only `frontend/node_modules`). Details: [docs/commands.md](docs/commands.md).

## Docs

- [docs/architecture.md](docs/architecture.md): layout, related repos
- [docs/commands.md](docs/commands.md): commands and deploy
- [docs/features/README.md](docs/features/README.md): feature specs
- [docs/backend_coupling.md](docs/backend_coupling.md): UI-side backend knowledge to remove
