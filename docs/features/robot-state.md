# Robot State (persistent world state)

<!-- Moved verbatim from CLAUDE.md (lines 295-335) on 2026-10-30; links rebased to docs/features/. -->

A robot backend keeps a persistent symbolic **world state** — what the robot
believes about itself across plan runs — surfaced and editable in the dashboard.
`GET /agent/world` returns the world dict; `PUT /agent/world` applies a partial
update (only the fields sent), persists it, and returns the updated dict.

World dict shape:
`{ arrived, found, holding, opened:[], on:[], holding_since, found_pose, found_pose_stale, holding_pose }`

- `arrived` — nearest configured location the robot is at; the only
  **sensor-derived** field (reconciled from localization).
- `found` / `holding` — object most recently found / currently grasped. These
  are **beliefs**: there is no gripper sensor, so they reflect what the planner
  thinks, not a measurement.
- `opened` / `on` — sets of open containers / on appliances (beliefs). `on` has
  no corresponding kcare skill, so it stays empty in practice.
- `holding_since` — epoch seconds the grasp belief was set.
- `found_pose` — geometric memory of the found object
  `{loc_3d, pose_3d, side_pose?, grasppose?, ts, robot_pose:[x,y,rz]}`, in the
  base frame at detection time. **Display-only.**
- `found_pose_stale` — `true` once the base has moved away (>0.25 m) from the
  detection spot; the pose must not be trusted for grasping then.
- `holding_pose` — the grasp actually used to pick the held object
  `{grasppose:[dx,dy,dz,angle,width], ts, robot_pose:[x,y,rz]}` (`pick` returns it).
  A record of how/where it was grasped. **Display-only.**

The `PlanPanel` renders a **Robot State** block above the Plan block
([frontend/components/PlanPanel.tsx](../../frontend/components/PlanPanel.tsx),
`WorldStateBlock`): editable inputs for `arrived` / `holding` / `found` /
`opened` (csv) / `on` (csv), live-editable at any time (each save is a
`PUT /agent/world`, even mid-run), a "held Nm ago" age hint next to `holding`,
and a read-only "found pose" section (`loc_3d`, `grasp`) with a fresh / ⚠ stale
badge. The value shown comes from the latest agent WebSocket event carrying a
`world` field, falling back to `GET /agent/world` on mount. Both the closed-loop
and the open-loop / direct execution paths emit `world` events over the agent
WebSocket (`/ws/agent`), so the panel updates live each step. Wrappers live in
[frontend/lib/api.ts](../../frontend/lib/api.ts) (`getWorld`, `setWorld`); the
`WorldState` type and `AgentEvent.world` field are in
[frontend/lib/types.ts](../../frontend/lib/types.ts).
