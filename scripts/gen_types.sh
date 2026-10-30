#!/usr/bin/env bash
# Regenerate the robot_agent API description the frontend is checked against.
#
#   1. frontend/lib/generated/openapi.json  — always (python + fastapi, offline,
#      no robot boot; see scripts/dump_openapi.py). `make lint` checks every
#      endpoint in frontend/lib/api.ts against it.
#   2. frontend/lib/generated/openapi.d.ts — only when openapi-typescript is
#      installed in frontend/node_modules (it is not today; install it with
#      `npm i -D openapi-typescript` in frontend/ on a machine with network).
#      No npx download is attempted.
#
# Env: ROBOT_AGENT_DIR (default ../robot_agent next to this repo), PYTHON.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RA="${ROBOT_AGENT_DIR:-$ROOT/../robot_agent}"
PY="${PYTHON:-python3}"
OUT="$ROOT/frontend/lib/generated"
mkdir -p "$OUT"

if [ ! -d "$RA/robot_agent/api" ]; then
  echo "robot_agent not found at $RA (set ROBOT_AGENT_DIR)" >&2; exit 1
fi
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$RA${PYTHONPATH:+:$PYTHONPATH}" "$PY" "$ROOT/scripts/dump_openapi.py" "$OUT/openapi.json"

BIN="$ROOT/frontend/node_modules/.bin/openapi-typescript"
if [ -x "$BIN" ]; then
  "$BIN" "$OUT/openapi.json" -o "$OUT/openapi.d.ts"
else
  echo "openapi-typescript not installed in frontend/node_modules: skipped openapi.d.ts" >&2
  echo "  (most responses are untyped anyway: robot_agent routes declare no response_model)" >&2
fi
