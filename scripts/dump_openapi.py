"""Write robot_agent's OpenAPI schema to a file without booting a robot.

create_app() bootstraps a robot package (devices, ROS); the schema only needs
the routers, so this mounts the same routers on a bare FastAPI app, in the
order app_factory.create_app includes them. WebSocket routes (/ws/agent,
/ws/camera/<id>) are not part of OpenAPI.

    PYTHONPATH=<robot_agent checkout> python scripts/dump_openapi.py out.json
"""
import importlib
import json
import sys
import warnings

from fastapi import FastAPI

ROUTERS = ['devices', 'skills', 'configs', 'buttons', 'agent', 'camera',
           'diagnostics', 'locations', 'guides', 'map']


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


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'openapi.json')
