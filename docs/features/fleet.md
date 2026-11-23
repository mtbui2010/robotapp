# Fleet tab: several robots through the fleet manager (2026-11-21)

The Fleet view (since 2026-11-23 it has no tab button: it opens when a fleet is chosen in the robot / fleet drop-down). It talks to the **robot_fleet** manager
([SPEC section 6](../../../robot_fleet/docs/SPEC.md)), not to a robot: the manager decides which robot does which
goal and when; each robot plans and recovers its own goal. Component
[FleetPanel.tsx](../../frontend/components/FleetPanel.tsx); client [lib/fleet.ts](../../frontend/lib/fleet.ts) (the
only file that calls the fleet API, rule 1); types [lib/fleet_types.ts](../../frontend/lib/fleet_types.ts)
(hand-written from the SPEC until `make gen-types` reads the fleet OpenAPI); pure helpers
[lib/fleetView.ts](../../frontend/lib/fleetView.ts) (tests: `scripts/test_fleet.mjs`).

- **Manager URL**: per browser tab, like the robot picker (sessionStorage; the last one chosen seeds a new tab;
  key `robotapp_fleet_url`). Default `http://localhost:8100`. **Use** saves it; ↻ reads again.
- **Stop all** (big red button, always at the top of the tab, sticky): `POST /fleet/stop`. No confirmation. One
  line per robot: ✓ only when the robot's cancel worked AND cancelled something; a failed cancel, an empty cancel,
  a robot warning or errors are a ⚠ warning in words, never a green tick. An answer with no robot, or a manager
  that cannot be reached, is a warning that says to use each robot's own Stop. The plan is stopped for good (a new
  request is a new plan). The text under the button repeats rule 7: Stop all cancels every robot, whoever started
  its run; two clients driving one robot is unsafe.
- **Robots**: id, URL, `REAL` / `sim` badge (a robot is real unless the manager says `real: false`), state
  (idle / busy / lost, coloured) and active goal (`GET /fleet/robots`).
- **Lost robot banner** (one per robot in state `lost`): says the robot does not answer, that its running goal
  failed and is never given to another robot, and that a place it held stays locked. **Release <place>** buttons
  (when the manager lists the robot's `locks`; not in the SPEC) and a free place-name box call
  `POST /fleet/locks/{resource}/release` after an inline "Check first that the robot is not there: a goal
  waiting for it may then start on another robot. Yes / No".
- **Request box, plan view, questions, Approve (2026-11-23)**: the tab no longer has its own request box, plan
  selector or plan panel with Approve and the operator-name box. They moved to the chat, see
  [Requests, approval and questions are in the chat](#requests-approval-and-questions-are-in-the-chat-2026-11-23).
- **Live updates**: `WS /ws/fleet`; an event re-reads the plan it names (`GET /fleet/plans/{id}`) and the robots
  when it names a robot. The socket reconnects (1, 2, 4, 8, then every 10 s); while it is down the tab reads
  every 5 s (GET only) and says "live updates off".
- **Reading never starts anything** (rule 6): opening the tab, the WebSocket, the 5 s reads and ↻ are `GET` only.
  The POSTs from the dashboard are request, answer, approve, reject (all from the chat), Stop all (Cancel) and Release,
  each on a person's action.

## Requests, approval and questions are in the chat (2026-11-23)

While a fleet is chosen and the Fleet view is open, the CHAT card talks to the fleet
([chat.md](chat.md#chat-in-the-fleet-view-2026-11-23), word lists in [lib/fleetChat.ts](../../frontend/lib/fleetChat.ts)):

- A typed message is a request: `POST /fleet/requests`. A robot's question is answered by typing in the chat:
  `POST /fleet/plans/{id}/answer`.
- When the plan is `awaiting_approval`, "yes" starts it (`POST .../approve`, by the operator name kept in the tab
  preference, else "chat") and "no" drops it (`POST .../reject`; a changed request is a new request). Only a
  message made entirely of yes-words counts as yes; anything else gets a hint and sends nothing, so a wrong word
  never moves a real robot (rule 8: nothing moves before the person says yes).
- Cancel (both buttons) stays the fleet's Stop all. Reading the tab (GET and `/ws/fleet`) never starts a plan.
- Not verified in a browser or against real robots.

## Robot / fleet selector and fleet editor (2026-11-21)

The robot drop-down at the top of the sidebar ([DevicePanel.tsx](../../frontend/components/DevicePanel.tsx)) lists the
registry robots (group **Robots**, as before) and the fleets (group **Fleets**). Choosing a robot is the old behaviour (and
leaves any fleet); choosing a fleet makes it this tab's fleet and opens the Fleet tab on that fleet's manager URL
(`fleet.getFleetUrl()` = the selected fleet's URL; the **Use** box of the tab edits that fleet's URL). `👥` adds a fleet;
`✎` / `🗑` act on the selected robot, or on the selected fleet (deleting a fleet is local only; its robots stay in the
list and the manager is left alone).

- **Storage** ([lib/fleetRegistry.ts](../../frontend/lib/fleetRegistry.ts), no HTTP): `localStorage` `robotapp_fleets` =
  `[{name, url, members: [{name, real}]}]` (members are registry robot names); the selected fleet is per tab
  (`robotapp_active_fleet`, same pattern as the active robot: sessionStorage, the last choice seeds a new tab).
- **Editor** ([FleetEditor.tsx](../../frontend/components/FleetEditor.tsx)): name, manager URL, a checkbox per registry
  robot and, for each ticked one, a required **real / simulated** choice. There is no default: Save stays disabled
  (the reason is shown) until every member is chosen, and the name must be unique. It only edits; nothing moves (rule 6).
- **Sync on Save** (`fleet.syncFleet`, [lib/fleet.ts](../../frontend/lib/fleet.ts)): `GET {url}/fleet/config`, then
  `PUT /fleet/robots/{id}` `{url, real}` for every member (the URL is the registry robot's) and `DELETE
  /fleet/robots/{id}` for each robot the manager has that is not a member. The manager's error text (for example the 409
  while a goal runs on the robot) is shown in the editor and under the selector; when the config cannot be read, the fleet
  stays saved and the line says `not synced: ...`.
- **Registry changes**: deleting a robot that a fleet uses asks first, naming the fleets, and removes it from their
  members; renaming a robot renames it in the fleets. Neither calls the manager: open the fleet and Save to sync it.
- Pure logic (options, validation, diff, drop / rename): [lib/fleetEdit.ts](../../frontend/lib/fleetEdit.ts); tests in
  `scripts/test_fleet.mjs` (selector, draft validation, diff, registry, sync on a fake fetch, unreachable manager).
  Contract with the manager (being built; not in SPEC section 6 yet): `GET /fleet/config` returns
  `{robots: [{id, url, real}], places, exclusive, policy}`; `PUT /fleet/robots/{id}` body `{url, real, places?}`.

## Camera grid (2026-11-21)

Under the lost-robot banners, above the robots table: one tile per fleet robot
([FleetCameras.tsx](../../frontend/components/FleetCameras.tsx), [FleetCamTile.tsx](../../frontend/components/FleetCamTile.tsx)).
Title = robot id + `REAL` / `sim` badge; a drop-down lists that robot's cameras (default: a camera whose id or name contains "overview", which views the robot from outside, else `head_rgb`, else its first; the choice is kept per
robot id in the tab preference `robotapp_fleet_cams`, forgotten if the robot no longer has that camera).

- **Layout (2026-11-23)**: no row of its own. Reload, `live` and "Robots per row" (1 to 6, default 2, a tab preference `robotapp_fleet_cols`) are drawn on the page's tab row (`toolbarSlot`, like the Cameras tab's camera chips); there is no manager address box (the manager of a fleet is set in the fleet editor; the buttons' tooltips name it). There is no Fleet tab button: next to the tabs (Cameras, Map, Data) a small drop-down (`data-testid="fleet-switch"`, in every tab, in place of the old robot chip) lists the fleets and the robots. Picking a fleet opens the Fleet view on that fleet's manager (a fleet chosen in the sidebar selector does the same); picking a robot leaves the fleet (from the Fleet view it opens that robot's Cameras tab). With a fleet chosen but another tab open, the drop-down shows the fleet as its placeholder and picking it returns to the Fleet view. **Cancel is Stop all** while this tab is open: the tab puts its stop in `stopRef`, both Cancel buttons call it, and the result lines appear at the top of the tab (a failed Stop all says to stop each robot with its own Stop). The tiles use the full width, `cols` to a row; under each camera: the robot's state, its active goal and its URL (the table of robots is gone). The old Stop all text is the Cancel tooltip.
- **Each robot's own URL**, not the tab's active robot: `api.listClientsAt(url)` (`GET /connects`, entries with `is_camera`)
  and `api.cameraWsAt(url, id)` (`WS /ws/camera/{id}`, then `{depth_mode: 'colored'}` like CameraCell). They are in
  `lib/api.ts` (no new HTTP file); `listClients` / `cameraWs` call the same code with the active robot's URL (unit-tested).
- **One stream per robot**, closed when the camera is changed, the robot leaves the list or the tab goes away.
- **A cancelled read is not a failure** (2026-11-23): the tile's own cleanup aborts a read it no longer needs (React's double effect in development, a rebuilt tile); that abort and that answer are ignored (`live` flag in `FleetCamTile.tsx`). Only the 5 s timeout and a real failure of the current read say "Cannot reach".
- **No endless spinner**: a camera list not read in 5 s or failing = "Cannot reach the robot at <url>."; no camera = "This
  robot has no camera."; no frame in 8 s = "No image from this camera." (or the robot's own error).
- Reading cameras and streaming never start a run (rule 6). A robot's own tab is unchanged.
- Pure logic (options, default, tile state, remembered choices): [lib/fleetCams.ts](../../frontend/lib/fleetCams.ts); tests in
  `scripts/test_fleet.mjs`. Not verified in a browser or against real robots.

## Runs started by the fleet, in the robot's own tab (2026-11-21)

When the fleet manager (or any other client) starts a run on a robot, that robot's own tab draws it like its own runs: the
plan rows, the step logs and the step image (`log_image` of `step_log`) in the camera view. The tab subscribes, read-only, to
the robot's `WS /ws/events` ([fleet_seams](../../../ra_merge/docs/fleet_seams.md); `api.eventsWs()` / `api.eventsWsAt(url)` in
`lib/api.ts`). Hook [lib/useForeignRun.ts](../../frontend/lib/useForeignRun.ts); pure logic (what to show, own run id, retry delay)
[lib/foreignRun.ts](../../frontend/lib/foreignRun.ts); the step rows come from `reduceSteps` in
[lib/planSteps.ts](../../frontend/lib/planSteps.ts), which the tab's own run uses too (one reducer, same rendering).

- **No double drawing**: every event of this tab's own `/ws/agent` socket carries `run_id`; those ids are remembered, and
  events of them on `/ws/events` are ignored. While this tab has its own run in flight nothing from `/ws/events` is drawn.
- **Badge** above the plan: "Run started by the fleet / another client", the `run_id`, running / ended
  ([ForeignRunBadge.tsx](../../frontend/components/ForeignRunBadge.tsx)). **Cancel** is unchanged (`POST /agent/cancel`).
- **Quiet**: a robot without `/ws/events` (404 / refuses) changes nothing and logs nothing; reconnect after 5, 10, 20, 40 s,
  then every 60 s; a good `events_open` resets the delay. Closing the tab (or changing robot) closes the socket.
- **Rule 6**: the socket sends nothing and never starts a run. Not drawn: voice, listen / speak, recording and dataset logging
  (those belong to the client that started the run). Events before the connect are not replayed (`GET /runs/{id}?events=true`
  could); only the newest 1000 events are kept.
- **Step images need no option**: a skill puts `log_image` in its `log_data({...})` call and the robot sends it in `step_log` on
  every run (`unified_agent._make_log_fn`). The run option `log_data` (first `/ws/agent` message, boolean) only turns on the
  vision dataset capture (rgb / depth / results, `step_log.dataset`); with `log_mode: "frontend"` that capture is streamed too.
  So the image shows only if the skill that ran logs one.
- Tests: `scripts/test_fleet.mjs`. Not verified in a browser or on a robot.

Backend: `GET /fleet/robots`, `GET /fleet/plans` (**not in the SPEC yet**: without it the tab shows the plans it
submitted or saw on the WebSocket), `GET /fleet/plans/{id}`, `POST /fleet/requests`, `POST .../approve`,
`POST .../reject`, `POST .../answer`, `POST /fleet/stop` (a list of `CancelResult`, bare or as `{results}`),
`POST /fleet/locks/{resource}/release`, `WS /ws/fleet`. The manager must allow the dashboard's origin (CORS).

Not verified: no browser run (the selector and editor were only type-checked, built and unit-tested) and no fleet manager (its API was not written on 2026-11-21); tested with unit tests
on made-up plans and a fake fetch / WebSocket only.
