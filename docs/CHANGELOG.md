# Changelog

History of the dashboard and of the backend behaviour it depends on. Until 2026-10-30 this history lived inline
in `CLAUDE.md`, mixed with the specs. The full text of each entry is still in the feature doc it belongs to
(`docs/features/`, moved verbatim); this file is the dated index. New entries go at the top: date, feature, one
line, link. Undated features (Cancel / Stop, camera streaming, Robot State, plan skills, skill and location
aliases, planner guides) predate the dated notes; see their docs.

## 2026-11-13 (later)

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
