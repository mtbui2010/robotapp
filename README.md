# robotapp

Next.js web dashboard for [`robot_agent`](../robot_agent)-based robots
(e.g. [`kcare_robot`](../kcare_robot) or any project generated from
[`robot_template`](../robot_template)).

Talks to the robot **only over HTTP** (the agent's FastAPI on
`http://<host>:8001` by default). The CLI and Python-API modes are
independent — this dashboard is the UI mode.

## Run locally

```bash
make install            # npm install
make run-frontend       # next dev on http://localhost:3007
```

## Deploy

```bash
export CLOUDFLARE_API_TOKEN=<token>
make deploy             # builds and uploads to Cloudflare Pages (robotapp project)
make deploy-status      # check custom domain + SSL
```

Custom domain: <https://robot.aistations.org>.

## Connecting to a robot

In the dashboard's **DevicePanel**, register the robot agent's base URL
(`http://<host>:8001`) and click Connect. The dashboard then routes
skill calls to `POST /skill/<name>`, device calls to `/devices`, etc.

## How this fits with the other packages

```
                ┌──────────────────────────────┐
                │  robotapp  (this — Next.js)  │      browser / Cloudflare Pages
                └──────────────┬───────────────┘
                               │  HTTP
                               ▼
       ┌────────────────────────────────────────────────┐
       │  robot_agent  (FastAPI)  ←─ create_app(...)    │      Python process
       │  uvicorn kcare_robot.main:app   (port 8001)    │      on the robot host
       └────────────┬─────────────────────┬─────────────┘
                    │                     │
                    ▼                     ▼
            ROS2 services         devices (cameras, arm,
            / topics              gripper, TCP detectors)
```

The dashboard is **not** required to operate the robot. The robot
package itself (`kcare_robot`, or any cookiecutter-generated project)
also provides:

- a `kcare_robot` console-script (CLI) — `kcare_robot find::apple`
- a Python API — `from kcare_robot.skills.recognition import find`

Use whichever fits the task; the dashboard is for interactive multi-user
operation.
