# Fleet tab: several robots through the fleet manager (2026-11-21)

A fourth tab (👥) next to Cameras, Map and Data, always shown. It talks to the **robot_fleet** manager
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
- **Request box + Submit**: `POST /fleet/requests {text, lang}` (`lang` = the tab's language; left out when it is
  Detect). The manager has one robot understand the request; nothing moves.
- **Plan view** (the plan just submitted, else the newest; a drop-down when there are several): text, state,
  who approved, warnings, then the goals grouped by robot (goals with no robot yet last): goal id, the goal in its
  own words (`on cup from shelf to table`), state, what it waits for (`starts first` or
  `after g1 (pick cup on a)`), and the outcome code / message.
- **Questions**: when the robot asked the person (`questions`), they are shown with an answer box
  (`POST /fleet/plans/{id}/answer {text}`).
- **Approve** (only while the plan is `awaiting_approval`; needs the operator's name, kept per tab): the ONLY
  control that starts motion (`POST /fleet/plans/{id}/approve {operator}`). When the plan may move a REAL robot
  (one of its robots, or any reachable robot when a goal has no robot yet; an unknown robot counts as real) a
  dialog names them and asks "Approve and start" / "Do not start" (rule 8). The dialog approves the plan it was
  opened for, even when a newer plan arrives meanwhile.
- **Live updates**: `WS /ws/fleet`; an event re-reads the plan it names (`GET /fleet/plans/{id}`) and the robots
  when it names a robot. The socket reconnects (1, 2, 4, 8, then every 10 s); while it is down the tab reads
  every 5 s (GET only) and says "live updates off".
- **Reading never starts anything** (rule 6): opening the tab, the WebSocket, the 5 s reads and ↻ are `GET` only.
  The POSTs are Submit, Approve, Answer, Release and Stop all, each on a click.

Backend: `GET /fleet/robots`, `GET /fleet/plans` (**not in the SPEC yet**: without it the tab shows the plans it
submitted or saw on the WebSocket), `GET /fleet/plans/{id}`, `POST /fleet/requests`, `POST .../approve`,
`POST .../answer`, `POST /fleet/stop` (a list of `CancelResult`, bare or as `{results}`),
`POST /fleet/locks/{resource}/release`, `WS /ws/fleet`. The manager must allow the dashboard's origin (CORS).

Not verified: no browser run and no fleet manager (its API was not written on 2026-11-21); tested with unit tests
on made-up plans and a fake fetch / WebSocket only.
