# Location config profiles

<!-- Moved verbatim from CLAUDE.md (lines 60-122) on 2026-10-30; links rebased to docs/features/. -->

A robot backend stores one config folder per deployment site (its own
`connections.json` + global configs). The `DevicePanel` exposes a **Location**
picker (next to the Robot picker) to choose / add / rename / delete sites and
hot-switch between them. Wrappers live in [frontend/lib/api.ts](../../frontend/lib/api.ts)
(`listLocations`, `activateLocation`, `createLocation`, `renameLocation`,
`deleteLocation`); switching triggers a backend device reconnect, so the UI
refreshes the connections list right after. Sites are a **per-robot backend**
concept (distinct from the multi-robot URL registry kept in `localStorage`).

**Several machines on one configs folder (2026-10-08).** The configs folder is
shared (`/remote_dir`, sshfs on the robots) by every machine running the same
robot package, so nothing one machine saves may undo another's:

| What | Where | How |
|---|---|---|
| active site | `common/active_location.<host>` | per machine (2026-10-07: one shared marker made two machines flip kcare_bucheon ↔ clobot_bucheon); boot reads `$ROBOT_LOCATION` → own marker → old shared `active_location` (`state.read_active_location`) |
| Robot State (world belief) | `common/world_state.<host>.json` | per machine (was one shared `world_state.json`: robot B inherited A's `holding`) |
| logs (`<pkg>.log`, ros, llm) | `data/logs/<host>/` | per machine (`runtime._resolve_layout`) |
| task runs, grace memory | `common/task_runs/<host>/`, `common/grace_memory.<host>.jsonl` | per machine (`planning/loop.py`) |
| skills (+ aliases, plan skills), buttons, guides | `common/skills.json`, `buttons.json`, `guides.json` | **shared, saved as merges** |
| connections, Global Configs | `locations/<site>/connections.json`, `skill_configs_override.json` | per site; **saved as merges** when two machines are on one site |
| SwitchBot last state | `locations/<site>/switchbot_state.json` | per site (was `data/`), re-read + atomic write |
| presence | `common/hosts/<host>.json` | heartbeat every 20 s (server mode) |

`<host>` is `state.host_id()`: `$ROBOT_AGENT_HOST`, else the hostname.

**Merged saves** ([core/shared_json.py](../../../robot_agent/robot_agent/core/shared_json.py)).
Every manager used to rewrite its whole file from memory, so a save on robot B
dropped the plan skill robot A had added since B loaded. Now a save re-reads the
file and applies only what this process changed since its last read (per item:
a skill / button by id / guide version / connection / Global Config group;
added, edited, removed, reordered), writes it atomically (own tmp file +
rename, previous version as `.bak` — the file never disappears), and adopts
the result. Reads (`GET /skills`, `/buttons`, `/guides`, `cm.get`, `sr.resolve`)
reload the file when another machine changed it (one check per 1–2 s). An item
both machines changed keeps the later save. A connection another machine added
is carried along but not connected here until a restart / site switch.
`flock` only serialises processes of one machine; across machines the window
is the few ms between re-read and rename.

**sshfs caveat (measured on the robot).** After the dev PC rewrote a file, a
plain `stat` on the robot kept the old size / mtime for ~19 s, and the first
`open` + `read` returned the new content cut to the OLD size (`{"a": 1,`). An
`open` refreshes the cache: `shared_json.read_fresh` re-reads while the size
read differs from the size after, `stat_fresh` opens before `stat`. Use
`read_fresh` for any shared file another machine may rewrite.

**Presence** ([robot_agent/presence.py](../../../robot_agent/robot_agent/presence.py)).
`GET /config/locations` returns `host` and `others: [{host, location, age_sec,
clash?}]` (records ≤ 60 s old). The Location picker shows `— also on <host>`
per site and an amber warning when another machine is on the active site
(they share its connections and Global Configs: give each robot its own
location); renaming / deleting a site another live machine is on is refused
(400). Two machines with the **same host id** (cloned Jetson images are all
`m-ax-jetpack`) would share every per-machine file: when the presence record
is rewritten by another kernel `boot_id` after this process started, the
picker shows a red warning — set `ROBOT_AGENT_HOST` on one of them.

ROS is not shared between robots: the apps container's Fast DDS profile
(`/workspace/fastdds_profile.xml`) uses SHM + UDP on 127.0.0.1 only.
