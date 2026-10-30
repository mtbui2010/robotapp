SHELL := /bin/bash
ROOT  := $(shell pwd)
ROBOT_AGENT_DIR ?= $(ROOT)/../robot_agent
PYTHON          ?= python3

# Cloudflare Pages project
CF_PROJECT      := robotapp
CF_ACCOUNT_ID   := 1efcf45616f03bd51d275417c690a3e5
CF_DOMAIN       := robot.aistations.org

.PHONY: run-frontend install-frontend install terminate build-frontend deploy deploy-status \
        lint typecheck smoke ci gen-types check-deps

run-frontend:
	cd $(ROOT)/frontend && npm run dev -- -p 3007

install-frontend:
	cd $(ROOT)/frontend && npm install

install: install-frontend

terminate:
	-fuser -k 3007/tcp 2>/dev/null || true
	@echo "Terminated frontend (3007)"

build-frontend:
	cd $(ROOT)/frontend && npm run build

# ── CI: lint + typecheck + smoke (no backend, no network, no dev server) ─────
# Needs frontend/node_modules (`make install`; a symlink to another checkout's
# node_modules works too).
FE_BIN := $(ROOT)/frontend/node_modules/.bin

check-deps:
	@test -x $(FE_BIN)/tsc || { echo "frontend/node_modules missing: run 'make install' (or symlink one)"; exit 1; }

# Repo rules (scripts/lint.mjs: endpoints in OpenAPI, HTTP only in lib/api.ts,
# no new bundled robot data, workaround tags inventoried) + ESLint when installed.
lint: check-deps
	node $(ROOT)/scripts/lint.mjs

typecheck: check-deps
	cd $(ROOT)/frontend && $(FE_BIN)/tsc --noEmit -p .

# Static export must build and produce the page (runs without a robot).
smoke: check-deps
	cd $(ROOT)/frontend && NEXT_TELEMETRY_DISABLED=1 $(FE_BIN)/next build
	@grep -q '<html' $(ROOT)/frontend/out/index.html && echo "smoke: out/index.html ok"

ci: lint typecheck smoke

# Refresh frontend/lib/generated/openapi.json (+ openapi.d.ts when
# openapi-typescript is installed) from a robot_agent checkout.
#   make gen-types ROBOT_AGENT_DIR=../robot_agent PYTHON=python3
gen-types:
	ROBOT_AGENT_DIR=$(ROBOT_AGENT_DIR) PYTHON=$(PYTHON) $(ROOT)/scripts/gen_types.sh

# Deploy static export to Cloudflare Pages.
# Requires CLOUDFLARE_API_TOKEN in env (and optionally CLOUDFLARE_ACCOUNT_ID).
# Usage:
#   export CLOUDFLARE_API_TOKEN=<token>
#   make deploy
deploy:
	@if [ -z "$$CLOUDFLARE_API_TOKEN" ]; then \
		echo "ERROR: CLOUDFLARE_API_TOKEN not set."; \
		echo "  export CLOUDFLARE_API_TOKEN=<your_token>"; \
		echo "  Token needs: Account → Cloudflare Pages: Edit"; \
		exit 1; \
	fi
	@export CLOUDFLARE_ACCOUNT_ID=$${CLOUDFLARE_ACCOUNT_ID:-$(CF_ACCOUNT_ID)} && \
	 cd $(ROOT)/frontend && \
	 npm run build && \
	 npx wrangler pages deploy out --project-name=$(CF_PROJECT) --branch=main

# Show deploy status (custom domain + SSL).
deploy-status:
	@if [ -z "$$CLOUDFLARE_API_TOKEN" ]; then \
		echo "ERROR: CLOUDFLARE_API_TOKEN not set."; exit 1; \
	fi
	@curl -s "https://api.cloudflare.com/client/v4/accounts/$(CF_ACCOUNT_ID)/pages/projects/$(CF_PROJECT)/domains/$(CF_DOMAIN)" \
		-H "Authorization: Bearer $$CLOUDFLARE_API_TOKEN" \
		| python3 -c "import sys,json; r=json.load(sys.stdin).get('result',{}); print(f\"domain : {r.get('name')}\"); print(f\"status : {r.get('status')}\"); print(f\"ssl    : {r.get('validation_data',{}).get('status')} ({r.get('certificate_authority')})\")"
