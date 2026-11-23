# Changelog

History of the dashboard and of the backend behaviour it depends on. Until 2026-10-30 this history lived inline
in `CLAUDE.md`, mixed with the specs. The full text of each entry is still in the feature doc it belongs to
(`docs/features/`, moved verbatim); this file is the dated index. New entries go at the top: date, feature, one
line, link. Undated features (Cancel / Stop, camera streaming, Robot State, plan skills, skill and location
aliases, planner guides) predate the dated notes; see their docs.

## 2026-11-24

- **Per-robot session follow-ups.** Hands-free `speaking` depends on the shown session only; with no registered robot the session takes the default agent url (idle Cancel no longer posts to the dashboard); microphone ownership is a unit-tested pure function; the e2e saves three screenshots and prints the drop-down marks. Doc [sessions](features/sessions.md).
- **One session per robot in a tab (per-robot session).** A run keeps going while another robot is picked; the drop-down marks running robots; Cancel / Stop / Reset act on the shown robot's own URL (`api.cancelRunAt`); a running robot takes no second command from this tab. Store in `lib/robotSessions.ts`, end-to-end proof `scripts/e2e_sessions.py` on two sim robots. Registry follow-up: removing a robot cancels its run, a rename keeps the session (a run closure holds an immutable id, so the renamed run still ends its own session and a reused old name is a new robot), an edited url applies after the run; the browser recogniser owns the one mic like the Whisper path. Doc [sessions](features/sessions.md).

## 2026-11-23

- **Chat: docked under the camera grid in the Fleet view; the floating card's log is half as high.** The docked card covers no camera; other views keep the floating card with a `h-32` log (was `h-64`). `components/ChatPanel.tsx` (`docked`), `app/page.tsx`, doc [chat](features/chat.md).
- **Fleet: a tile's default camera is one that views the robot from outside.** A camera whose id or name contains "overview" is chosen first (the sim robots' `sim_overview`), else `head_rgb`, else the robot's first camera; a remembered choice still wins. `lib/fleetCams.ts` (`pickCamera`), test in `scripts/test_fleet.mjs`, doc [fleet](features/fleet.md).
- **Fleet: the chat is the fleet's one voice; the Fleet view loses its request box and plan panel.** With a fleet chosen and the Fleet view open, a typed message in the CHAT card is a request to the fleet manager (`POST /fleet/requests`). The chat shows the manager's `say` events (what it understood, the plan read-back with which robot does what and which robots are REAL, progress, results, the robots' questions). A robot's question is answered by typing (`POST /fleet/plans/{id}/answer`). When the plan awaits approval, "yes" starts it (`POST .../approve`) and "no" drops it (`POST .../reject`); only a message made entirely of yes-words counts, anything else gets a hint and sends nothing (rule 8). Word lists (en, ko, vi) are data in `lib/fleetChat.ts`. Choosing a fleet opens the chat card. Cancel stays Stop all. Not verified in a browser or against real robots. [fleet](features/fleet.md), [chat](features/chat.md)

- **No Fleet tab button; one robot / fleet drop-down in every tab.** The 👥 tab button is gone (the tab strip is Cameras, Map, Data). The robot chip is a drop-down in every tab, listing the fleets and the robots: picking a fleet opens the Fleet view on that fleet's manager, picking a robot leaves the fleet (from the Fleet view it opens that robot's Cameras tab). With a fleet chosen but Cameras / Map / Data open, the drop-down shows the fleet as a placeholder, and picking the fleet again returns to the Fleet view. The robot's ⚠ site-mismatch badge stays next to it. [fleet](features/fleet.md)

- **Fleet tab: no manager address on the row; a robot / fleet drop-down at the fleet name.** The "Fleet manager" label, its address box and Use are gone from the tab row (the manager of a fleet is set in the fleet editor, ✎ in the robot / fleet selector; the reload button and `live` tooltips still name it). The fleet name chip is now a small drop-down listing the fleets and the robots: a fleet keeps the Fleet tab (starting over on its manager), a robot leaves the fleet and opens that robot's Cameras tab (DevicePanel's switch is called through `switchRef`). [fleet](features/fleet.md)

- **Fleet tab: one header row, the fleet name, and Cancel is the fleet's Stop all.** The Fleet manager controls (address, Use, reload, live) and "Robots per row" now sit on the tab row itself (the slot the Cameras tab uses for its camera chips), so the tabs, the fleet and the manager are one line; while the Fleet tab is open the robot chip shows the tab's fleet name (`👥 fleet_kcare`); the separate Stop all button is gone: the page's Cancel buttons stop every robot of the fleet while the Fleet tab is open (tooltip: the old Stop all text, with rule 7's warning) and the result lines of the stop still appear in the tab. [fleet](features/fleet.md)

- **Fleet tab layout: Stop all and the manager on one row, robots per row, the robot's data under its camera.** Stop all now sits in front of the Fleet manager row (the long explanation moved into the button's tooltip, so rule 7's warning is still one hover away); a "Robots per row" choice (1 to 6, default 2, kept per tab) sets how many camera tiles share a row, and the grid uses the full width; the table of robots is gone: each tile shows the robot's state, its active goal and its URL under the camera. [fleet](features/fleet.md)

- **Fleet tab camera tile: a cancelled read is not a failure.** The tile aborted its own `GET /connects` when its effect was cleaned up (React runs effects twice in development, and a tile is rebuilt when the robot list changes) and the `catch` then marked the robot "Cannot reach the robot" although the robot answered (DevTools showed `connects (canceled)` after 12 ms). The tile now ignores the answer and the abort of a cleaned-up effect; the 5 s timeout still counts as a failure. [fleet](features/fleet.md)

- **Robot picker: no Connect button; the panels follow the robot at once.** Picking another robot connects to it by itself (as before), the panel connects when it opens, and while the active robot does not answer it tries again every 5 s. The camera, map and data panels are rebuilt for the new robot when it is picked (`useRobotEpoch`, a `key` on them), so the camera sockets and the map no longer stay on the old robot until F5; the old robot's cameras are dropped at once. Editing the active robot's name or URL does the same ([camera streaming](features/camera-streaming.md#switching-robots)).

## 2026-11-21

- **Robot tab shows runs started by others:** the robot's own tab now also draws the run events (steps, step images) of a run the fleet manager or another client started on that robot, from the robot's read-only `WS /ws/events` (new `api.eventsWs` / `eventsWsAt`; sends nothing, never starts a run), with the same rows as its own runs (`reduceSteps` is shared) and a badge "Run started by the fleet / another client" with the run id. A run this tab started is not drawn twice (deduped by `run_id`); Cancel is unchanged. A robot without `/ws/events` stays silent (retry every 5 s growing to 60 s). Unit-tested; not run in a browser or on a robot ([fleet](features/fleet.md)).
- **Fleet tab cameras:** one camera tile per fleet robot (id, real / sim badge, a drop-down of that robot's cameras; default its first, the choice is remembered per robot id). Each tile reads `GET /connects` and opens `WS /ws/camera/{id}` on the robot's OWN url (from the manager's robot list) through new base-URL variants `api.listClientsAt` / `api.cameraWsAt`; the old calls are unchanged. One stream per robot, closed with the tile; an unreachable robot or one without a camera says so after 5 s. A robot's own tab is untouched; not run in a browser ([fleet](features/fleet.md)).
- **Robot / fleet selector:** the robot drop-down at the top of the sidebar has a second group, **Fleets**; choosing one opens the Fleet tab on that fleet's manager (per tab). `👥` adds a fleet; `✎` / `🗑` edit / delete the selected robot or fleet. A fleet = name, manager URL, member robots from the robot list and a required real / simulated choice for each (no default); Save keeps it in this browser (`robotapp_fleets`) and syncs the manager (`GET /fleet/config`, `PUT` / `DELETE /fleet/robots/{id}`; the manager's error text such as a 409 is shown, an unreachable manager = "not synced"). Removing a robot that a fleet uses warns and takes it out of the fleet ([fleet](features/fleet.md)). The manager endpoints were not built yet: tested on a fake fetch only.
- **Fleet tab (👥):** several robots through the robot_fleet manager (default `http://localhost:8100`, per tab): robots (real / sim, idle / busy / lost), a request box, the plan grouped by robot with what each goal waits for, the robot's questions with an answer box, Approve (the only thing that starts motion; names the real robots and asks first), a red Stop all that shows each robot's result (a failed or empty cancel is a warning), a lost-robot banner with lock release, live updates from `/ws/fleet`. Rule 1 now allows robot_fleet's OpenAPI through `frontend/lib/fleet.ts` (lint `HTTP_ALLOWED`); not run in a browser, the manager's API does not exist yet ([fleet](features/fleet.md)).

## 2026-11-20

- **Plan panel:** the planner trace is titled "SAGE planning trace" (was "GRACE planning trace"); the comments and the docs say SAGE too. Why: the planner was renamed to SAGE in embodiplan and robot_agent. The plain-loop option still sends `planner: 'grace'`, which robot_agent keeps as a deprecated alias of `sage_plain`; changing the value waits until the robot runs a robot_agent that knows `sage_plain`.

## 2026-11-18

- **Data tab:** the prompt of an episode can be edited in the table (double-click / ✎); saved in the edit list, used by the list and the export, raw files untouched. robot_agent: `prompt` in `PUT /recordings/<day>/<ep>/edit`, `recorded_prompt` in the rows; Auto-clean no longer drops a mode or prompt you set ([data-tab](features/data-tab.md)).
- vlaserve `stop.py`: the stop decision moved into the python client (`ChunkExecutor(stop=...)`: default, built-ins, or your own function that returns a reason; `stats.stop_reason`). The skills use it instead of their own `finish` setting (`VLA_CONFIGS.<group>['stop']`); default waits 5 s of stillness (a 3 s wait would stop 24-42 of 56 training demos before their end) ([vla-stack](features/vla-stack.md)).
- `vla_stack` and `pi0.5_act` **move the arm by default** (execute True; `execute=False` = dry run) and take the task as the text after `::` (`pi0.5_act::open the middle drawer`, options after a comma: `..., execute=False`) instead of `prompt=`.
- New skill `pi0.5_act` (kcare_robot): the multi-task pi0.5 policy on a required prompt (stack / open / close drawer), several start poses, dry run by default; `vla_stack` and `pi0.5_act` share one loop (`run_skill`) and the robot-side settings ([vla-stack](features/vla-stack.md)). `skill_configs.json` is back in its aligned format (it was reformatted and the new key put at the top level by mistake).
- **Record bar:** a `Go to…` drop-down before each row picks the pose the arm goes to before that row's recording starts (the move is not recorded; a failed move records nothing) ([recorder](features/recorder.md)). The row checkbox is first in each row; `rec first` (per row, off by default) starts the recording before the move so the move is part of the episode.
- **Record bar:** two rows of fields with a checkbox each (Record uses the checked row; no retyping between open and close drawer); the prompt box is gone, ✨ shows a sample sentence under its row; one blue Record button for both rows; the Record button, clock and icon are blue, not red ([recorder](features/recorder.md))
- **Sidebar pickers:** the robot, location and connections rows are compact: `＋` / `✎` / `🗑` icon buttons (the meaning is in the tooltip), `Ping` and `Scan` instead of `Ping All` / `Scan ROS`; nothing wraps in the 288 px column.
- **Log panel / buttons:** the Log shows the step before the shown one under it (newest first); the `＋` cell of a button group stays visible while the add form is open ([chat](features/chat.md), [shortcut-buttons](features/shortcut-buttons.md)).
- **Data tab:** the episode table is ~5 rows high with a scroll, and chips filter it by what was filled when recording (`stack cups`, `open drawer`, `close drawer`) ([data-tab](features/data-tab.md)).
- **Record prompts:** *Generate* has more wordings for opening and closing a drawer (`open the drawer`, `shut this drawer`, `pull open the top drawer for me` ...); the kcare templates are in `RECORDER['prompts']` ([recorder](features/recorder.md)). Also for `align` (shoes) and `wipe` (spill / table, with a towel).
- **Screen recording:** a quick-button click (Arm / Head / ... tabs) no longer starts the *rec screen* recording even when its box is ticked; only a run from the Agent panel does ([screen-recording](features/screen-recording.md)).
- `vla_stack`: default model `kcare-stack-4999` (stacked the cups on the robot; 1000 did not grasp), `seconds` 25 as a cap, and the run ends early when the cup was grasped, released and the arm stands still (`VLA_CONFIGS.stack.finish`) ([vla-stack](features/vla-stack.md)).
- New skill `vla_stack` (kcare_robot): stacks cups with the pi0.5 policy served by vlaserve; dry run by default, not tested on the robot. [features/vla-stack.md](features/vla-stack.md)
- `vla_drawer_open` removed (skill, `VLA_CONFIGS` form, sim connection) in kcare_robot; policies will be served by a single vlaserve container with per-model manifests. [features/drawer-skills.md](features/drawer-skills.md)

## 2026-11-17

- The data folder is configured as a relative path (`../vla_data`, from the repo root): the same on every machine ([recorder](features/recorder.md)).
- Record: with no prompt, or a generated one that no longer matches the fields, Record generates a new prompt first; a prompt typed by hand is kept ([recorder](features/recorder.md)).
- Record panel: saving runs in the background (`⏳ saving…`), Record is available again at once. Data tab: the mode is a drop-down in the table (saved at once); Export has `cut idle ends` (on): an episode with no saved trim is cut to its suggested range ([recorder](features/recorder.md), [data-tab](features/data-tab.md)).
- Data tab: a `mode` select per episode (the operator's setting wins), the head image shows the dashed square the export keeps for that mode, and Export has a `square crop` checkbox ([data-tab](features/data-tab.md)).
- Data tab: a `mode` column (left | front | right) from the recorded `robot_mode` ([data-tab](features/data-tab.md)).
- Record panel: the dice is a sparkles **Generate** icon; pressing it again always gives a different sentence (the shown one is sent as `avoid`) ([recorder](features/recorder.md)).
- Data tab: a 🗑 button per episode (asks, then MOVES it to `<data>/trash`: never deleted for good) ([data-tab](features/data-tab.md)).

## 2026-11-16

- The remote control strip and the Record row are hidden by default; a `⏺` button next to the tabs shows them (kept in this browser); they stay visible while a recording runs or the arm is driven ([teleop](features/teleop.md)).
- Go to editor: a small popover under the drop-down (no extra row) listing only the pose names; a pose's steps show when it is edited; the speed for all poses is a gauge icon + % ([teleop](features/teleop.md)).
- Go to: the poses are the operator's own (`/poses`): add / edit / delete all of them in `✎ Edit poses…` (name + plan of steps like a button's), one speed for every pose (slow by default); the Data tab no longer cuts a Go to move (blue on the chart, an ℹ note) ([teleop](features/teleop.md)).
- Data tab: a 🧹 Auto-clean all button and a 🧹 cut button per row (the suggested trim; a Go to pose made during a recording is cut), the Go to move shown red on the chart, Export has a default name `vla_<date>`.
- Data tab (🗂️, only with a recorder): the raw episodes with numbers and warnings, frame / chart viewer, a non-destructive edit list (trim the ends, label, exclude), and Export (a manifest + the command for the LeRobot export) ([data-tab](features/data-tab.md)).
- Record panel under the teleop strip: prompt fields, 🎲 a random sentence from the robot's templates, ● Record (remote control + recording), ✔ Success / ✘ Failure / 🗑 Discard ([recorder](features/recorder.md)).
- Teleop strip: the pose drop-down is `Go to…` and 2/3 as wide; after a pose is reached remote control is switched on again by itself (when it was running; a failed move leaves it off) ([teleop](features/teleop.md)).
- Teleop strip: no more "A person is next to the robot?" question for On or Go to pose (the operator decided: remote control always has a person next to the robot); the strip sends `confirm: true` itself ([teleop](features/teleop.md)).
- Teleop strip: a `Go to pose…` drop-down (the poses come from `GET /teleop` `poses`, read by the backend from the robot's config, e.g. `ARM_CONFIGS` `approach_*`); asks before moving, runs `POST /skill/<skill>` ([teleop](features/teleop.md)).
- Teleop strip: a mode chip `twist rolls` when the node lets the knob twist roll the hand while rotation is off ([teleop](features/teleop.md)).
- Teleop strip: a new mode chip `heading frame` (the node's frame `hybrid`, [teleop](features/teleop.md)).
- Teleop strip: the three speed buttons are one drop-down (25 / 50 / 100%), and the `▶ On` / `■ Off` button shows the input device's battery (`🔋 78%`, `⚡` charging, amber at 20 % or less) when the node reports `battery` in its state; nothing is shown otherwise (robot_teleop does not publish it yet). `components/TeleopBar.tsx`, `lib/teleop.ts` `batteryInfo`, [features/teleop.md](features/teleop.md).

## 2026-11-14

- Teleop strip: the battery is its own chip beside the speed (not inside the On button) and the speed drop-down has a gauge (speedometer) icon.
- Teleop strip: the On / Off button carries the input device's battery now that the node reports it (`battery`, `battery_age_s`; the tooltip says when it was reported). Needs `make battery` on the robot.
- Teleop strip: no text labels (icon + chips), the state pill is gone (the On button becomes `● driving`), the gripper is a read-only switch icon, the speed drop-down says only `50%`. `lib/teleop.ts` `driveLabel`.
- Teleop strip on ONE row: no `Arm` / `Gripper` group boxes or repeated words, `device ok` hidden (only a problem is shown), speed drop-down and the On / Off button (with the device battery when reported) at the right. `components/TeleopBar.tsx`.
- Teleop strip: blue mode chips (base / tool frame, line lock, straight, rotation) from the new keys of the teleop state. `lib/teleop.ts` `modeChips`.
- Teleoperation strip above the cameras: state, input-device and gripper chips, speed 25 / 50 / 100%, `▶ On` (asks first: a person next to the robot) and `■ Off` for each teleop function the robot lists (`GET /teleop`); nothing is drawn when it lists none. `components/TeleopBar.tsx`, `lib/teleop.ts`, `lib/useTeleop.ts`, docs/features/teleop.md. Needs robot_agent 72ac182 + kcare_robot 7949f1e + the robot_teleop node on the robot.

## 2026-11-13 (later)

- Language picker: **Detect** (`lang: 'auto'`) is always first and the default, whatever the number of languages in the manifest (the only option when it names none); an explicit pick (e.g. KO) is the default of the next tab; the picker's popover switches the manifest's languages on / off for the site (saved on the robot: `PUT /robot/languages`; a language the manifest lacks cannot be added); `Detect · EN` shows the language heard. `components/LanguagePicker.tsx`, `lib/robotLanguages.ts`, `lib/useRobotLanguages.ts`, `supported` + `declared` in `GET /robot/languages`. Needs robot_agent (site languages) + kcare_robot (restart the backend). docs/features/chat.md.
- Plan progress no longer repeats the running step in a blue "NOW …" box above the list (it is the highlighted row of the list; the list still
  scrolls to it). `components/PlanList.tsx`.
- The robot / site badges: when the site is named like the robot (any case: "Kcare_bucheon" / "kcare_bucheon") one badge `🤖 Kcare_bucheon` is
  shown (118 px, was about 330 px); when the names **differ** the site is not written out, a `⚠` after the robot badge warns instead (its tooltip
  names both: a tab driving a site that is not the robot's own is easy to miss). The badge tooltip always has `robot @ site`, URL, host.
  `lib/targetBadge.ts`, unit-tested.
- `Cameras | Map` is a two-icon switch (📷 / 🗺️, `role=tablist`, tooltips and aria-labels keep the names): 68 px, was about 125 px. The
  camera views menu icon is 👁 so it is not confused with the switch. [features/camera-streaming.md](features/camera-streaming.md)
- The hint line under the plan cells ("Run → cell 1 (blue border) · click a cell to select · Ctrl+Enter = run active") is gone; the same
  text is the Run button's tooltip.
- The 🔊 sound button of the capture row is just `⋯` (23 px; was `🔊 system 🎤 ● ▾`): the popover is unchanged, a small dot on it shows
  green / amber once a recording or the audio test has reported, and the tooltip says what is set.
- The "Presets" label and the "— saved —" box are one control: a 72 px select that reads *Presets* when nothing is chosen (the
  chosen preset's name otherwise; the list and the tooltip show full names). Was a label + a 123 px select.
- Deleting a button group asks first, in a warning box under the group bar that lists the buttons and says they move to Other
  (a page box, not `window.confirm`). [features/shortcut-buttons.md](features/shortcut-buttons.md)
- Shortcut buttons in **groups**: a row of group chips (Head, Mobile, Lift, Arm, Get ready, ＋) with the open group's tray under it, one tray at a
  time; create / rename / delete / reorder groups (deleting one moves its buttons to Other), a button's group in its form, drag a
  button onto a chip to move it. Backend: `/buttons/groups` endpoints and a `group` on buttons (robot_agent), kcare's buttons grouped.
  [features/shortcut-buttons.md](features/shortcut-buttons.md)
- The two plan input cells are 40 px high (was 60 px: 2 lines of text instead of 3); a longer plan scrolls, ⤢ opens the whole cell.
- One row instead of two in both toolbars. Agent panel: *Presets* (select + a `⋯` menu with Save as / Rename / Delete / Export /
  Import / Guide), `log ▾` (where, which runs), rec screen, 🔊, ⏺, `×N` (repeat), voice and Run share one line (the Guide dialog is
  opened from the menu, `GuidePanel` is controllable). Cameras: ONE drop list `📷 3/5 ▾` (a view per row: radio in Tab, checkbox in Grid, drag to reorder, webcam / observe at the bottom) next to
  Tab | Grid on the `Cameras | Map` row before **Cancel**, about 140 px instead of 500.
  New `components/PopoverButton.tsx` (fixed popover: closes on outside click / Escape / scroll / resize).
  [features/camera-streaming.md](features/camera-streaming.md)
- Two toolbar rows are one line each: the capture row (labels `log` / `rec screen`, the sound options folded into one 🔊 button
  with a popover and a status dot, the manual record button icon-only) and the camera row (in Grid layout every view is a chip that
  shows / hides it instead of a checkbox + label; `observe (webcam)` is `webcam`, its device picker narrower).
  [features/screen-recording.md](features/screen-recording.md), [features/camera-streaming.md](features/camera-streaming.md)
- Screen recording keeps the robot's voice: what the user hears is always the browser's voice. New default source **system**
  (Windows / ChromeOS: the file has that same voice); **direct** still works everywhere but the file gets the backend's
  voice of the lines, played into the recording only. 🎤 taps the listen stream in every source. [features/screen-recording.md](features/screen-recording.md)
- Screen recording sound: new **direct** source (the default). The app puts the robot's lines (backend `GET /tts`, gTTS), the
  beeps and the microphone into the recording itself, so it works on every OS and browser; the tab source missed the
  browser's Korean voice. [features/screen-recording.md](features/screen-recording.md)
- Screen recording (direct): the robot's voice keeps its pitch at `speech_rate` (a media element with `preservesPitch`; the buffer
  source made it distorted), and 🎤 records your answers by tapping the listen stream instead of a second microphone.
  [features/screen-recording.md](features/screen-recording.md)

## 2026-11-13

- The language picker (control bar and chat) and its default come from the robot's manifest (`GET /robot/languages`,
  [features/backend-contract.md](features/backend-contract.md)): `language` is the default, `languages` the options; a tab's
  choice is kept when the robot talks in it, else the default. Before: KO / EN fixed in the UI, default KO. The speech
  tag of a language is the code itself (`ja` -> `ja`). Logic and tests: `lib/robotLanguages.ts`, `make unit`.
  [features/chat.md](features/chat.md)

## 2026-11-12

- Screen recordings have sound: the tab's audio (default) and, if ticked, the microphone, mixed into one track; an
  **audio test** says whether the robot's spoken lines (`speechSynthesis`) reach the recording.
  [features/screen-recording.md](features/screen-recording.md)
- [Map tab](features/map-tab.md): object action templates leave out entries whose placeholders were not filled (click-move no longer sends `place: "{place}"`); the place select shows only if `move` uses `{place}`.
- Chat: the 404 note on a late audio answer comes from `noteForListenReply` (tested); stop label and action are tested as a pair.
- [Map tab](features/map-tab.md): objects layer. `MAP.objects` (declared by the backend) makes the Map tab draw labelled object markers, polled
  read-only; Move / Remove / Add appear only for the actions the backend declares. Logic in `lib/mapObjects.ts`.
- [Map tab](features/map-tab.md): an objects action may be a device-agent command (`{agent, send}`); before, a backend without a skill for it (symbolic sim) showed no Move / Add.
- [Cancel / Stop](features/cancel-stop.md): every Stop / Cancel button (chat Stop, Agent panel Stop, control-bar Cancel, tab-row Cancel) runs the one
  `stop()` flow (`stopAction` / `stopLabel` in `chatRun.ts`): stopping, then Force reset when stuck. A 404 on the audio answer (the listen had timed out) now
  shows a note in the chat.
- [Chat](features/chat.md): the planner and "plan only" are kept per tab like the language (a new tab starts from the last choice; a tab pins what
  it started with, so a reload never takes another tab's choice).
- [Chat](features/chat.md): a spoken answer shows at once as "🎤 …" right after the question and becomes the transcript when the speech server
  returns it (removed when there is none); before, the line appeared only after the robot had already moved on, out of order.
- [Chat](features/chat.md#stop-and-reset): Stop shows "stopping…" until the backend `done` (or the socket closing), then offers **Force reset** after 5 s; a **reset** button
  (header) always returns the chat to idle (cancel, socket, pending listen, capture, speech, HRI queue, plan view); Stop stays available after a
  dropped socket (`alive`); state machine in `lib/chatRun.ts` with unit tests.
- [Chat](features/chat.md#stop-and-reset): a failed speech-recognition answer (HTTP 5xx, unreachable) shows "⚠ speech recognition failed (…): type your answer" and keeps the
  question open for typing (was: read as silence, the chat said "working…" with the input disabled while the backend waited); mic errors are shown too.
- [Cancel / Stop](features/cancel-stop.md): the dashboard's Stop waits for the backend's `done`; a socket error with a repeat controller active no longer leaves the UI
  "running" forever.
- [Chat](features/chat.md): the language is kept per browser tab (sessionStorage, `lib/tabPref.ts`); localStorage only holds the last choice
  as the default of a new tab. Before, picking EN in one tab changed what another tab read on its next (hot) reload, so a Korean session
  turned English by itself.
- [Chat](features/chat.md): the Plan progress list is two thirds as high (192 px, was 288 px), it scrolls.
- [Chat](features/chat.md): the Log panel shows only the log of the step (its `msg` / result lines, newest first), no "Step i/N: …" title
  (that is in Plan progress); empty `{}` log lines are hidden.
- [Chat](features/chat.md): in Plan progress each task shows at most 2 lines (a longer one ends with "…"); a ⤢ button on the row
  (only when the text is clipped) shows it whole, ⤡ collapses it; the full text is also the tooltip and is in the Log.
- [Chat](features/chat.md): the Log panel shows only the log of the step being run (or the last one), "Log — step i of N"; a click on a
  Plan progress row shows that step, "↺ current" goes back.
- [Chat](features/chat.md): Plan progress rows use the look of the old Execution rows again (same box, 0.8 zoom, icon size and
  colours, `Step i/N:` in small grey, task in 14 px mono, duration in 10 px grey); no blue highlight on the running row.
- [Agent panel](features/chat.md): the top bar (RobotApp, v2, "powered by robot_agent") is removed; the 🔊 voice toggle and the Guide button sit
  on the Run row of the Agent panel.
- [Agent panel](features/chat.md): the shortcut buttons are 30 px high (was 44 px, two thirds), two lines of label still fit.
- [Chat](features/chat.md): ONE step list: Plan progress now shows each step like the old Execution did (spinner, `Step i/N: label`,
  duration, failure reason in red) without details; Execution became the **Log** panel (logs, result JSON, copy), and a click on
  a Plan progress row scrolls the Log to that step. Durations come from a client-side `_rx` receive time on the events.
- [Chat](features/chat.md): fix — a chat run with the chat's mic OFF is answered by typing even when the backend asks in voice
  mode (no recording, no empty answer, no "didn't hear you"); mic ON unchanged; Structured runs unchanged (`answerBy`).
- [Agent panel](features/chat.md): the "Structured" title is removed and Run / Stop sits at the end of the log data / record row; the
  step editor has two cells, 60 % / 40 % (the left cell and one right cell; the text of the old third and fourth cells stays stored).
- [Chat](features/chat.md): the top-bar 💬 Q&A button is now 💬 Chat, one card for a two-way conversation with task
  planning (idle: a message is a new SAGE run; the robot asks: a message is the answer, typed also in voice mode;
  planner / language / plan-only / Stop in the header); hands-free mic only while idle and silent, echo guard.
  The button no longer starts `qa` (a Structured step still can). The card opens only from the button, never for a
  Structured run (an amber pulse on the button says the robot waits for a typed answer); language defaults to KO.
- [Chat](features/chat.md): the Unstructured prompt is removed from the Agent panel (command box, "from mic" with its
  always-on recogniser, "Auto-run after voice", command presets); Structured is unchanged.
- [Chat](features/chat.md): Task plan panel shows a plan progress list that follows replans and recoveries (done
  steps kept, notes with the reason, ✓ / ▶ / ✗, stopped); `make unit` replays recorded runs; Execution list works
  for SAGE events.
- [Chat](features/chat.md): the separate Plan text block is removed; Plan progress and Execution have a limited height
  with mouse scroll, and Plan progress shows the step being run (a **now** line, auto-scroll to it).
- [Chat](features/chat.md): fix — a Structured (legacy-event) run showed every step twice ("4/8 done" for a 4-line plan); steps are
  matched to the plan lines by order when the labels differ; new fixture and test from a real run.

## 2026-11-11

- `qa::context='find_drop'` (backend, kcare `hri.py`): where is the dropped fork / spoon, as a clock direction from
  the user's feet, from the arm camera; one answer, then qa ends. [features/visual-qa.md](features/visual-qa.md)

## 2026-11-02

- Planner Guide removed (editor panel, `/guides` calls, `Guide*` types): the Direct planner's prompt is built by
  the backend from the manifest, places and memory. A read-only **Planner prompt** panel (`GET /planner/prompt`)
  shows it for a command. [features/planner-prompt.md](features/planner-prompt.md)

## 2026-10-30

- Robot State: per-field provenance (sensor with age / operator / belief / unknown), unconfirmed containers, and a
  note that edits are beliefs the robot re-checks. [features/robot-state.md](features/robot-state.md)
- Repo rules: `CLAUDE.md` now holds rules only. Specs moved to [docs/features/](features/README.md), history
  indexed here. `make lint`, `make typecheck`, `make smoke`, `make ci` added.
  [backend_coupling.md](backend_coupling.md) lists the robot data the UI bundles, the hand-written types and
  the UI workarounds for backend bugs.

## 2026-10-29 / 2026-10-22 (merged from main)

- Config groups: HOME_LOC, CALIB_PARAMS, KR2EN, EN2KR, LLM_SERVERS deleted; per-skill forms, Map ⚙ Settings, ENV
  locations editor, merge-saves (PATCH). Narration of names as written, `%` quiet steps.
  [features/config-groups.md](features/config-groups.md)
- Drawer skills: one handle for both looks, `vla_drawer_open` through vla-serve.
  [features/drawer-skills.md](features/drawer-skills.md)
- Control bar, voice off = silent browser, emergency buttons, `qa::context='where' / 'light'`, shelf unit box,
  per-tab robot, SLAM map keep area, backup Whisper server ([../WHISPER_SERVER.md](../WHISPER_SERVER.md)).
  [features/visual-qa.md](features/visual-qa.md), [features/map-tab.md](features/map-tab.md),
  [features/ai-servers.md](features/ai-servers.md)

## 2026-10-16

- [AI servers](features/ai-servers.md): connections become three pool types (`vlms` / `visions` / `voices`),
  each an ordered server list with fallback, cooldown and CPU-slip detection; `GET /connects/servers`;
  `ServerListEditor`.
- [Visual Q&A](features/visual-qa.md): Warm up button (`warmup_servers` skill) after Whisper failed to reload
  on a full GPU on 2026-10-15.
- [Visual Q&A](features/visual-qa.md): `ask` no longer reads its options by default; on a first miss the
  options pop up as dashboard buttons (`screen_choice`, `choose` / `choose_close` events).
- [Visual Q&A](features/visual-qa.md): shelf levels always counted from the bottom (24 / 24 right on the
  5 + 1 captures).

## 2026-10-15

- [Visual Q&A](features/visual-qa.md): End Q&A button (`qa_state` event).
- [Visual Q&A](features/visual-qa.md): Q&A ends on a long silence (`idle_ask_sec` 60 s, then `idle_end_sec`).
- [Visual Q&A](features/visual-qa.md): `HRI_CONFIGS.speech_rate` (default 1.3).

## 2026-10-14

- [Visual Q&A](features/visual-qa.md): earcons when the mic opens / closes (`HRI_CONFIGS.earcon`).

## 2026-10-13

- [Visual Q&A](features/visual-qa.md): Korean and English only; one KO / EN picker in the Agent panel.
- [Visual Q&A](features/visual-qa.md): where-on-the-shelves answers from depth, nothing configured per place;
  `_place_config` prefers the nearest ENV entry with a `qa` block.
- [Visual Q&A](features/visual-qa.md): which objects, and when to ask again (from live logs).
- [Visual Q&A](features/visual-qa.md): qa writes each message to the hri log (`log_data`).
- [Visual Q&A](features/visual-qa.md): incident: the VLM switched to 32b @ aistations "after a UI refresh".
- [Visual Q&A](features/visual-qa.md): `skills/qa.py` folded into `hri.py`; `reuse_photos` and `memory`
  options.
- [Visual Q&A](features/visual-qa.md): shelf1 with the arm camera ("라면 있어" answered in Chinese).
- [Visual Q&A](features/visual-qa.md): light questions in qa ("세탁실 불 켜져 있어?").

## 2026-10-09

- [SAGE planner + assist layer](features/sage-assist.md): SAGE + assist in the Agent panel (`AssistLoop`);
  understand / plan / guard / done; kcare `placeat`, `placep`, `approach*` and card skills removed.
- [SAGE planner + assist layer](features/sage-assist.md): per-step recovery table, tested with injected sim
  faults.

## 2026-10-08

- [Location config profiles](features/location-profiles.md): several machines on one configs folder:
  per-machine files, merged saves (`shared_json`), sshfs caveat, presence.
- [Spoken names in plans](features/spoken-names.md): `said->real` in skill names and parameter values.
- [Map tab](features/map-tab.md): SLAM map connection + Update map (`POST /map/snapshot`).
- [Map tab](features/map-tab.md): sim bar (reset, scenes, object and furniture catalog).

## 2026-10-07

- [Location config profiles](features/location-profiles.md): one shared `active_location` marker made two
  machines flip sites; now one marker per host.

## 2026-10-06

- [Visual Q&A](features/visual-qa.md): products (라면 …) and one-shot mode.
- [Visual Q&A](features/visual-qa.md): Whisper for the dashboard mic instead of Chrome's recogniser.

## 2026-09-30

- [Visual Q&A](features/visual-qa.md): `QA_CONFIGS` points at the 4×A6000 Ollama server
  (`qwen3-vl:32b-instruct`), `num_ctx` sent with every request.
