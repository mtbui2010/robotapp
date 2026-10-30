# robotapp commands

```bash
make install            # npm install in frontend/
make run-frontend       # next dev on :3007
make ci                 # lint + typecheck + smoke (static build); needs only frontend/node_modules
make gen-types ROBOT_AGENT_DIR=../robot_agent PYTHON=python3   # refresh lib/generated/openapi.json
make build-frontend     # static export to frontend/out/
CLOUDFLARE_API_TOKEN=… make deploy
make deploy-status
```

Cloudflare Pages project: `robotapp`. Custom domain: `robot.aistations.org`.
Account ID is pinned in the [Makefile](../Makefile).
