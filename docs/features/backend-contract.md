# Backend contract (endpoints the dashboard calls)

<!-- Moved verbatim from CLAUDE.md (lines 34-59) on 2026-10-30; links rebased to docs/features/. -->

The dashboard hits these `robot_agent` endpoints (full list in the agent's
[api/](../../../robot_agent/robot_agent/api/) routers):

| Endpoint | Used for |
|---|---|
| `GET  /skills`          | populate the skill picker |
| `POST /skill/<name>`    | run a skill (body = params) |
| `POST /skills/reload`   | refresh registry after edits |
| `GET  /devices`         | list configured devices |
| `POST /devices`         | add a device |
| `GET  /connects/servers` | AI-server connections: level + each server's state (fallback, see below) |
| `GET  /diagnostics/boot`| boot-error inspection |
| `GET  /camera/<id>`     | MJPEG / WebRTC stream |
| `GET/POST/PUT/DELETE /config/locations[...]` | per-site config profiles (see below) |
| `GET  /agent/world`     | read the persistent symbolic world state (see below) |
| `PUT  /agent/world`     | partial-update the world state (only sent fields) |
| `POST /agent/listen/<id>` | transcript for an HRI skill's `listen` event (see below) |
| `POST /agent/cancel`    | stop the robot — cancel everything in flight (see below) |
| `GET  /agent/<name>/get` | read a device agent's latest value, read-only (Map tab robot pose) |
| `GET  /config/locations/<site>/files/<path>` | static site files: Map layers (`_active` = active site) |
| `GET  /config/locations` → `host`, `others` | which site the other live machines sharing the configs are on (presence) |
| `GET  /guides` · `GET /guides/<name>` | list / read versioned planner guides |
| `POST /guides` · `PUT /guides/<name>` · `DELETE /guides/<name>` · `POST /guides/<name>/activate` | create / edit / delete / select the active guide |
