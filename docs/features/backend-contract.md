# Backend contract (endpoints the dashboard calls)

<!-- Moved verbatim from CLAUDE.md (lines 34-59) on 2026-10-30; links rebased to docs/features/. -->

The dashboard hits these `robot_agent` endpoints (full list in the agent's
[api/](../../../robot_agent/robot_agent/api/) routers). The Fleet tab's `robot_fleet` endpoints are in
[fleet.md](fleet.md) (client `frontend/lib/fleet.ts`):

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
| `GET/POST/PUT/DELETE /buttons[/groups][/<id>]`, `POST /buttons/groups/reorder` | the shortcut buttons and their groups ([shortcut-buttons](shortcut-buttons.md)) |
| `GET  /tts?text=…&lang=…` | the sentence as `audio/mpeg` (gTTS on the backend, needs its internet); the screen recording plays the robot's voice through its own audio graph with it ([screen-recording](screen-recording.md)) |
| `GET  /teleop` | `{functions: [{name, label, available, state?, age_s?}]}`: the robot's teleop functions and their last state; `[]` when none (teleop strip) |
| `POST /teleop/{name}/enable` | `{on, confirm}`: switch a function on (needs `confirm: true`, a running function, no run in flight) or off |
| `POST /teleop/{name}/speed` | `{scale}` 0..1: fraction of the function's top speed |
| `GET  /recorder` | the raw-episode recorder: `{available, state?, dir, teleop, fields}`; 404 when the robot has none ([recorder](recorder.md)) |
| `POST /recorder/prompt` | `{fields}` -> `{prompt}`: a random sentence from the robot's templates |
| `POST /recorder/start`, `/recorder/stop` | `{prompt, meta?}` starts remote control and the recording; `{label: success\|failure\|discard}` stops and saves |
| `GET  /recordings`, `GET /recordings/{day}/{ep}`, `GET .../frame?cam&t` | the raw episodes: rows with numbers and warnings, one episode with its curves, the camera frame nearest to `t` ([data-tab](data-tab.md)) |
| `PUT\|DELETE /recordings/{day}/{ep}/edit`, `POST /recordings/export` | the edit list (trim, label, exclude, note; saved beside the raw folder) and the export manifest |
| `GET|POST /poses`, `PUT|DELETE /poses/{id}`, `PUT /poses/speed`, `POST /poses/defaults`, `POST /poses/{id}/run` | the editable "Go to" poses (name + plan), the one speed for all, restore the robot package's starting poses, run one ([teleop](teleop.md)) |
| `PUT  /robot/languages` | body `{languages}`: switch the site's languages (a non-empty subset of `supported`; 400 otherwise); answers like the GET |
| `GET  /robot/languages` | `{robot, language, languages, supported, declared}`: the default language, the languages this site has on, every language the manifest lists (`supported`; `[]` and `declared: false` when it names none); the language picker and its default (below) |
| `GET  /planner/prompt?command=…&planner=…` | the Direct planner's prompt for a command, read-only ([planner-prompt](planner-prompt.md)) |
