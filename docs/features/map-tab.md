# Map tab (click to move)

<!-- Moved verbatim from CLAUDE.md (lines 816-896) on 2026-10-30; links rebased to docs/features/. -->

The main area has two tabs, **Cameras** and **Map**
([frontend/components/MapPanel.tsx](../../frontend/components/MapPanel.tsx)). The Map tab is generic: it reads
the active site's `MAP` skill-config group (`GET /skill-configs/MAP`, type `MapConfig` in
[frontend/lib/types.ts](../../frontend/lib/types.ts)); a site without one just says so.

| `MAP` key | what |
|---|---|
| `image` | `{connection, frame}` — a camera connection whose picture is the map (sim: `sim_topdown`, rendered orthographic) |
| `layers.occupancy` / `layers.height` | site files (`map/occupancy.png` 0/128/255 = free / too close for the base / obstacle; `map/heightmap.png` uint8 cm) with their frames |
| `surfaces` | rectangles `{name, centre, size:[depth, width], yaw_deg, height}` — what to lift to |
| `places: "ENV"` | draw ENV entries; clicking one runs `move::<name>` |
| `pose` | `{agent, x, y, orientation}` paths into `GET /agent/<agent>/get` |
| `goal` / `rotate` / `lift` | skill + templated params (`{x}` `{y}` `{rz}` · `{deg}` · `{h}`) |
| `confirm_goal` | ask before every motion (set it for real robots) |

Frames follow ROS `map.yaml`: `origin` = world (x, y) of the image's bottom-left corner, `resolution`
m/px, row 0 = top. Behaviour:

- **click a free spot** → `goal` (kcare: `moveb` with x, y only = keep the heading). Clicks on blocked
  cells (occupancy ≥ inflated) are refused; after the call the panel compares the pose with the goal,
  because kcare reports `moveb` done even when navigation gave up.
- **← / →** → `rotate` ±`step_deg` (kcare: **`turn`** — relative; kcare's `rotate` goes to an ABSOLUTE
  heading). Presses during a turn are summed into the next call.
- **auto lift** after a goal: the nearest surface within `reach_m` → `lift::height + clearance`
  (kcare's own rule, `get_lift_height`); a typed height overrides it.
- **hover** → `x y z` (surface height, else height-map "top of obstacle", else floor), distance to the
  robot, reachable / blocked.
- **Save as place** → current pose + height as a new ENV entry (`default_mode: front`,
  `source: "map"`; kcare-sim's `make_kcare_sim_location.py` keeps such entries when it regenerates ENV).
- **origin** (`MAP.origin {x, y, yaw_deg}`, map frame): drawn as red x / green y axes with a 1 m grid,
  tick numbers, a 1 m scale bar and an arc from the origin's x axis to the robot's heading. Hover, the
  robot readout and angles are shown in this frame; goals, ENV and the robot stay in the robot's map frame.
  **✥ Edit origin**: drag the dot to move, the red arrow tip to rotate (← → 5°, Shift 1°), or type x / y /
  yaw; **Apply…** asks what happens to the ENV places: *Leave places where they are* (recommended,
  first: same spots in the house, only the shown coordinates change) or *Move places together with the
  axes* (only when the map itself moved, e.g. after re-mapping; hovering it previews where every place
  would go, and the popup names the place that moves farthest). **↶ Undo origin change** restores the
  previous origin (and ENV, if it was moved). Map-snapshot
  and kcare-sim's `make_kcare_sim_location.py` keep `origin` when they rewrite `MAP`.

The pose is polled with `GET /agent/<name>/get`, never `POST /skill/mobile_pose`: every `POST /skill`
calls `begin_run()`, which would clear a Stop / Cancel in progress. The sim's `MAP` group is written by
kcare-sim (`make_kcare_sim_location.py`, frames from `house_scene.map_frame`).

**Real robots: a SLAM map connection + "⟳ Update map" (2026-10-08).** A ROS topic connection of
`nav_msgs/msg/OccupancyGrid` (kcare_bucheon: `slam_map` → `/map`, the Slamtec map bridged to domain
12; its decode_func returns `{grid, info}`) is the map source; another robot only changes the topic.
The Map tab's **⟳ Update map** (connection picker = every connection whose `data_interface` is an
OccupancyGrid; also shown when the site has no MAP yet) calls `POST /map/snapshot`
([robot_agent/api/map.py](../../../robot_agent/robot_agent/api/map.py)), which writes the site files
`map/map.png` (free white / unknown grey / occupied black, row 0 = top) and `map/occupancy.png`
(0 free / 128 within `inflate_m` = 0.3 m of an obstacle / 255 occupied or unknown), moves the old
pair to `map/history/`, and sets `MAP.image = {file, frame}`, `MAP.layers.occupancy` and
`MAP.source` — other MAP keys are kept. `MAP.image.file` is drawn under everything (else the
occupancy layer, as before). Without `pose` / `goal` the map is **view-only** (clicks explain why).
kcare_bucheon: 267×422 cells at 5 cm, origin (−3.8, −14.85); pose / goal / places not set yet.
**Tidying a SLAM map (2026-10-22).** clobot_bucheon's Slamtec map (.101, 508×404 at 5 cm) has lidar dots
outside the house (through windows), and marks everything it never saw as **free** (319 unknown cells of
205 k) — clicks outside the house were accepted. **✂ Keep area** (Map tab, when `MAP.source` exists) loads
the robot's whole map (`POST /map/snapshot {preview: true}`: a PNG data URL, nothing saved), you click the
corners of the house (Backspace = last one off), **Apply** saves with `keep: [[x, y], …]` (map frame):
outside is unknown (blocked), both images are cropped to the polygon + 0.3 m (frame origin moved to match).
Every snapshot also drops obstacle blobs < `speck_cells` (4) cells with no other obstacle within 0.5 m
(chair legs come in groups and stay). Both are saved in `MAP.source` and applied again by every later
**Update map**; **whole map** (`keep: []`) removes the area. Only the dashboard's picture and click check
change — the robot still plans on its own map (for that: virtual walls in RoboStudio). On the .101 map:
10 specks removed; the noise outside comes in clusters, so the keep area is what clears it.
Offline check: `kaair_real_capture/map_tidy_20261022/test_tidy.py`.


**Sim bar: reset / scenes / object + furniture catalog (sim only, 2026-10-08).** Shown when
`MAP.sim = {agent}` is set (kcare-sim: `sim_command`, a ROS-service connection to the bridge's
`/sim/command`, `sim_msgs/SimCommand` = JSON string in / out), in
[frontend/components/mapSim.tsx](../../frontend/components/mapSim.tsx) (`useSimEditor`, wired into
`MapPanel`'s mouse / key handlers and SVG). Every command is `POST /agent/<agent>/send {cmd, …}`:

| UI | cmd | what |
|---|---|---|
| ↺ objects / ↺ + drawers / ↺ everything | `reset {what: objects\|scene\|all}` | back to the loaded scene's poses; *everything* also puts the robot at its start and clears the world-state beliefs |
| scene ▾ + Load | `load {name}` (base house = `apply {scene:{}}`) | rebuild + hot reload, ~7 s; the robot stays where it is |
| Save as… | `save {name}` | `config/scenes/<name>.yaml`: the scene's furniture changes + every object (untouched ones keep `surface`/`offset`, hand-moved ones their live `at` + `quat`) |
| Delete | `delete {name}` | the YAML only; the house as it is stays |
| ✎ objects: drag | `move_object {body, x, y, yaw_deg?}` | **instant**, no rebuild: dropped upright on whatever is under it (refused on the robot) |
| ✎ objects / ✎ furniture: + add, Del, drag / ← → (furniture) | collected in a draft → **Apply changes** = `apply {scene}` | one rebuild of `house.xml`, the occupancy / height maps and kcare's ENV + MAP (returned and PUT by the panel) |

The furniture catalog (desk, dining / coffee / side table, stool, chest, pedestal, shell / wood / office
chair, wire / storage shelf) and the object list (every downloaded YCB model) come from `state`. Things
on a piece of furniture follow it when it moves; a removed piece takes its ENV surface with it. Gotchas
fixed while testing: the SVG `<image>` started a native image drag on mousedown, which swallowed every
following mousemove / mouseup (now `preventDefault`); the edit row has a fixed height so selecting
something cannot shift the map under the mouse; ← → / Del never turn the robot while a mode is on.
