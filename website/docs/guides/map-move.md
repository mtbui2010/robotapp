# Move the robot from the Map tab

!!! abstract "In this page"
    How to send the robot to a spot or a saved place from the Map tab, which config the tab needs, when it refuses a click, and what the arrival message means. Checked in code at 4a810a3717ab, not run against a robot.

The Map tab shows the active site's map. A click on a free spot runs the site's goal skill. The tab does nothing on its own: everything it does comes from the site's `MAP` config ([map config](../reference/map-config.md)). A [config group](../reference/glossary.md#config-group) is a named JSON object kept on the backend.

!!! warning "A map click can move the robot, and the tab has no two-clients warning"
    Set `confirm_goal` in the `MAP` config on a real robot: it asks before every motion. The tab shows no "two clients" note. Use one client per robot, and keep the Stop button of the tab in reach ([Stop](stop.md)).

## What the tab needs

| need | what happens without it |
|---|---|
| a `MAP` config with `image` or `layers.occupancy` | `This site has no MAP config.`, with the Update map box |
| `MAP.pose` (the agent to read and the paths of x, y, yaw) | the tab is view only: `View only: add "pose" and "goal" to the MAP config to move the robot from the map.` |
| `MAP.goal` (a skill and params with `{x}`, `{y}`, `{rz}`) | the same view-only message |

You can edit the keys with the `⚙ Settings` button.

## Steps

1. Connect and pick the site ([Connect](connect.md)). Open the Map tab.
2. Wait for the robot dot. The tab reads the pose from the `pose` agent every `period_s` seconds (default 0.5).
3. Click a free (not blocked) spot. The status line reads `moving to (x, y)…`.
4. If `confirm_goal` is set, answer the dialog `Move the robot to (x, y)?`.
5. The tab runs the goal skill (`POST /skill/{name}`) and keeps the robot's current heading.
6. When the skill reports done, the tab reads the pose again and compares it with the goal. Within 0.3 m the status reads `arrived`. If the config has `lift`, the lift runs next.
7. A click on a green place dot runs the skill `move` with that place's name. The arrow keys turn the robot by `step_deg` (default 15 degrees) while the map has focus.
8. `Save as place` stores the current pose as a place; it asks a name and a surface height.

## What the operator sees

| status line | meaning |
|---|---|
| `moving to (x, y)…` | the goal skill is running |
| `arrived` | the robot is within 0.3 m of the goal |
| `stopped N m short of the goal (no path?)` | the robot package reported done but the pose is more than 0.3 m away; no lift runs. A [backend workaround](../reference/glossary.md#backend-workaround) (`map-arrive-check`) in the dashboard |
| `move failed: <msg>` | the goal skill returned `isdone: false` |
| `(x, y) is blocked for the base — pick a free (green) spot.` | the click is on an occupancy value at or above the inflated value (128 by default) |
| `A plan is running — stop it first.` | a run is active: no map motion |
| `stop sent` | you pressed Stop on the tab |

## Common problems

| symptom | cause | what to do |
|---|---|---|
| the tab is view only | no `pose` or no `goal` in `MAP` | add them in `⚙ Settings` |
| no robot dot | `pose` unset, the agent is not up, or x and y are not numbers | check the pose agent; the poll keeps trying |
| a place click does the wrong thing | the place click always runs the skill `move` with `inputs` | name your skill `move` |
| a change to places or origin vanished | `Save as place`, origin edits and the simulator write a whole config group | one dashboard at a time; press `reload` before you edit |
| only one edit at a time | origin edit, keep area and the simulator block each other | finish the other edit first |

More: [map module](../modules/map.md) (config keys, objects layer, simulator bar), [map config](../reference/map-config.md), [configs](../modules/configs.md).

Checked in code at 4a810a3717ab, not run against a robot.
