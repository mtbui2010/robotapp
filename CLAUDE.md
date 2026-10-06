# robotapp — Claude notes

Next.js 14 dashboard (App Router, TailwindCSS, static export → Cloudflare
Pages) that talks to a `robot_agent`-based backend over HTTP.

This package is the **UI mode** of the three-mode robot stack:

| Mode | Lives in | Talks to |
|---|---|---|
| **UI / HTTP** | this repo (`robotapp/frontend/`) | `robot_agent` FastAPI over HTTP |
| **CLI** | each robot pkg (`kcare_robot/__main__.py`, …) | bootstraps in-process |
| **Python API** | each robot pkg (`kcare_robot.skills.*`) | bootstraps in-process |

The dashboard is **not** required to operate the robot — it is an
optional multi-user interactive layer.

## Layout

```
robotapp/
├── frontend/                        # Next.js 14 app (App Router)
│   ├── app/                         # routes
│   ├── components/                  # React components (DevicePanel, ExecutionPanel, …)
│   ├── lib/                         # API client wrappers
│   ├── package.json                 # next 14, react 18, tailwind, wrangler
│   ├── next.config.js
│   ├── out/                         # static export (deploy artifact)
│   └── ...
├── Makefile                         # run-frontend / build-frontend / deploy / deploy-status
├── README.md
└── test                             # transient note file (not a test suite)
```

## Backend contract

The dashboard hits these `robot_agent` endpoints (full list in the agent's
[api/](../robot_agent/robot_agent/api/) routers):

| Endpoint | Used for |
|---|---|
| `GET  /skills`          | populate the skill picker |
| `POST /skill/<name>`    | run a skill (body = params) |
| `POST /skills/reload`   | refresh registry after edits |
| `GET  /devices`         | list configured devices |
| `POST /devices`         | add a device |
| `GET  /diagnostics/boot`| boot-error inspection |
| `GET  /camera/<id>`     | MJPEG / WebRTC stream |
| `GET/POST/PUT/DELETE /config/locations[...]` | per-site config profiles (see below) |
| `GET  /agent/world`     | read the persistent symbolic world state (see below) |
| `PUT  /agent/world`     | partial-update the world state (only sent fields) |
| `POST /agent/listen/<id>` | transcript for an HRI skill's `listen` event (see below) |
| `POST /agent/cancel`    | stop the robot — cancel everything in flight (see below) |
| `GET  /guides` · `GET /guides/<name>` | list / read versioned planner guides |
| `POST /guides` · `PUT /guides/<name>` · `DELETE /guides/<name>` · `POST /guides/<name>/activate` | create / edit / delete / select the active guide |

### Location config profiles

A robot backend stores one config folder per deployment site (its own
`connections.json` + global configs). The `DevicePanel` exposes a **Location**
picker (next to the Robot picker) to choose / add / rename / delete sites and
hot-switch between them. Wrappers live in [frontend/lib/api.ts](frontend/lib/api.ts)
(`listLocations`, `activateLocation`, `createLocation`, `renameLocation`,
`deleteLocation`); switching triggers a backend device reconnect, so the UI
refreshes the connections list right after. Sites are a **per-robot backend**
concept (distinct from the multi-robot URL registry kept in `localStorage`).

### Location names and aliases (ENV)

Each `ENV` entry (Global Configs) is keyed by its canonical name and may list
other names for the same spot:

```json
"dressroom@main room": { "aliases": ["옷장", "tủ áo"], "loc": {...}, ... }
```

A place named by an alias is spoken back as typed (`tủ áo에 내려 놓을게요`).
The older `label` field stays for the key itself — etri uses it for Korean names
of English keys, and `move` sends it as the POI name when an entry has no `loc` —
but the dashboard no longer edits it outside the JSON / generic field view.

`move::옷장`, `move::tu ao`, `move::옷장@main room` and `move::dressroom` all
reach it. The resolver is [robot_agent/env_names.py](../robot_agent/robot_agent/env_names.py)
(`resolve_env_name`); kcare's `get_env_specs` / `env_key` go through it, so every
skill that takes a location accepts aliases. Order: exact key → exact alias →
`@` segment of a key or alias (the old matching) → key or alias ignoring
diacritics, only if unique. Names are compared after NFC, lower-casing and
whitespace collapsing. `cup@옷장` still matches nothing; callers strip the
object part and retry, as before.

- **Ambiguous names** (`table` with `table@kitchen` + `table@living room`)
  take the first in ENV order and log a warning, as before;
  `MOBILE_CONFIGS['strict_loc'] = true` makes the skill fail instead.
- **Saving** ENV (`PUT /skill-configs/ENV`, `ConfigManager.update`) is refused
  with a 400 when an alias is another location's key or alias, is empty, or is
  `home` / `base` (move's own shortcuts). `api.updateSkillConfig` now throws on
  a non-2xx with the backend's `detail`; it used to report success regardless.
  Non-object legacy entries (etri's `"default_loc@main room": "table"`) are left alone.
- Skills work with the **canonical key** once resolved: `move` resolves before
  its `home` / `base` substring shortcuts, and `open_drawer` / `close_drawer`
  record the key in `world.opened`. `arrived` was already sensor-derived (key).
- In the `EnvPanel` Fields view, ENV gets a **Location aliases** block
  ([frontend/components/EnvNamesEditor.tsx](frontend/components/EnvNamesEditor.tsx)),
  collapsed by default (header shows the alias count, or `⚠ N clashes`). Open,
  it lists each key with its alias chips below it (Enter or `,` to add, × or
  Backspace to remove) — stacked, since the sidebar is narrow. It runs the same
  clash check as the backend and marks the offending chip red. `aliases` is
  hidden from the generic field list below it.
- A guide may contain `LOCATIONS_HERE`; `resolve_guide` replaces it with one
  line per location (`- dressroom@main room (also: 옷장, tủ áo)`) from the live
  ENV. Guides without the marker are unchanged.

### Plan skills (a skill defined as a plan)

Skill panel → **+ Add** → type **Plan** defines a skill as a sequence of other
skills, stored in `skills.json` as `type: 'plan'` and run by
`SkillRegistry.execute` ([core/plan_skill.py](../robot_agent/robot_agent/core/plan_skill.py)),
so the Agent panel, `POST /skill/<name>`, the CLI, the planners and other plan
skills can all call it:

```
move::$loc=counter2@kitchen$      # $name=default$ — a parameter with a default
lift::1
fine_move::$inputs$               # $inputs$ — what follows pick_top::
movej::give
```

`pick_top::cup`, `pick_top::inputs='cup', loc='table@kitchen'`. Lines use the
direct-mode syntax (`&&` parallel, `!skill` ignore failure, `~skill` force
failure, `#` comment) and the same argument rules (`parse_inputs`, now shared
with `UnifiedAgent._parse_inputs`). Parameter values are inserted **after**
parsing (as literals in `k=v` form), so commas / quotes in a value cannot break
the line. Each step's result is passed on to the next steps, as in the direct
mode (`find`'s `ins` reaches `pick`).

- **`{name}` — an earlier step's result.** In a plan skill and in the direct
  mode, `{answer}` is replaced by the `answer` an earlier step returned
  (`plan_skill.parse_step_args` / `refs_to_params`, inserted after parsing like
  `$param$`, so commas / quotes in it are safe):
  ```
  ask::inputs="뭐가 드실래요?", options="신라면, 짜파게티, 너구리, 안성탕면"
  fine_move::{answer}                        # or inputs={answer}, fixed_angle=0
  ```
  A name no earlier step returned fails the step (`{choice}: no earlier step
  returned "choice" (have: answer, text)`). Use it for a whole value: inside a
  quoted string it is inserted with quotes. Every earlier result is still also
  merged into the later steps' params as before (the `rz=90` leak).
- **On a failure the plan stops and the robot stays as it is** — no clean-up
  steps (no fold / lift-home: from an unknown pose they can hit furniture, the
  user's call). The result carries `failed_step`, `failed_line` and a
  per-step `plan_steps` report; the Execution panel gets one log line per step.
- Cancel is checked between steps; nesting is capped at 5; each successful
  sub-step goes through `apply_skill_effect`, so Robot State follows the
  `pick` inside `pick_top`.
- Saving is refused (400) for an unknown skill, a name taken by a code skill,
  a plan that calls itself (directly or via another plan skill), or one
  parameter with two defaults; deleting a skill a plan still calls is refused.
  `POST /skills/reload` keeps plan skills. The editor
  ([components/PlanSkillEditor.tsx](frontend/components/PlanSkillEditor.tsx))
  runs the same checks as you type, and has no "run" button — try a saved plan
  skill from the Agent panel.
- **Renaming** (plan skills only): the edit form has a name field;
  `PUT /skills/<name>` with `{name: <new>}` re-keys the skill in place
  (`SkillRegistry.rename`) and rewrites the calls in every other plan skill
  (`plan_skill.rename_calls` — keeps `!` / `~`, `&&`, arguments, comments).
  Shortcut buttons and guides are free text and keep the old name. Refused for
  a code skill, a taken name, an invalid name, or a rename+plan that would loop.
- A guide may contain `PLAN_SKILLS_HERE`; `resolve_guide` fills it with
  `- pick_top::<inputs>  (loc=counter2@kitchen, inputs) — <description>`.

### Skill aliases

A skill may have other names (`라면가져와`, `lấy mì` …): `SkillDef.aliases`,
saved in `skills.json`. `SkillRegistry.resolve` (exact name → exact alias →
either compared with `env_names.normalize`: NFC, case, whitespace) is used by
`execute`, so the Agent panel, `POST /skill/<alias>`, the CLI, plan skills and
the planners all accept an alias. Saving (`POST /skills`, `PUT /skills/<name>`
with `aliases`) is refused (400) for an empty alias, one with a parser
character (`: & ! ~ # $ { } , = ' " ( )`), one listed twice, or one that is
another skill's name or alias (`check_aliases`); a new or renamed skill may not
take another skill's alias as its name. Plans may call a skill by alias
(`validate_plan`, the self-call check and the delete check resolve aliases).
`POST /skills/reload` keeps the aliases of code skills (skills_config has
none). `PLAN_SKILLS_HERE` lines end with `(also: …)`.

In the Skill panel, a collapsed **Skill aliases** block
([components/SkillAliasesEditor.tsx](frontend/components/SkillAliasesEditor.tsx))
lists each skill with its alias chips — the same `AliasInput` as the Location
aliases (exported from `EnvNamesEditor.tsx`); each change is saved at once, a
clash shows red on the chip (same check as the backend) and a refusal under
the skill. Rows show `· alias, …` after the name; the panel search matches
aliases too.

### Robot State (persistent world state)

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
([frontend/components/PlanPanel.tsx](frontend/components/PlanPanel.tsx),
`WorldStateBlock`): editable inputs for `arrived` / `holding` / `found` /
`opened` (csv) / `on` (csv), live-editable at any time (each save is a
`PUT /agent/world`, even mid-run), a "held Nm ago" age hint next to `holding`,
and a read-only "found pose" section (`loc_3d`, `grasp`) with a fresh / ⚠ stale
badge. The value shown comes from the latest agent WebSocket event carrying a
`world` field, falling back to `GET /agent/world` on mount. Both the closed-loop
and the open-loop / direct execution paths emit `world` events over the agent
WebSocket (`/ws/agent`), so the panel updates live each step. Wrappers live in
[frontend/lib/api.ts](frontend/lib/api.ts) (`getWorld`, `setWorld`); the
`WorldState` type and `AgentEvent.world` field are in
[frontend/lib/types.ts](frontend/lib/types.ts).

### HRI voice (dashboard mic)

kcare's `reply` / `ask` skills (`kcare_robot/skills/hri.py`) talk and listen
either on the robot (`source='robot'`: gTTS + robot mic + `vlms` Whisper) or
through this browser (`source='dashboard'`). In dashboard mode the skill emits
agent-WebSocket events: `speak` (always voiced, unlike the gated `say`) and
`listen: {id, lang, max_sec, prompt}`. `page.tsx` queues them in order —
speak to completion, then `recognizeOnce` ([frontend/lib/hriVoice.ts](frontend/lib/hriVoice.ts))
— and posts `{text, error}` to `POST /agent/listen/<id>` (`api.answerListen`).
Only runs started from the Agent panel have this channel; `/skill/<name>` and
the CLI must use `source='robot'`.

**Picking the mic.** Nothing in this frontend ever sends `source`, so it has to
be typed into the plan input — and the plan parser is **not** the CLI parser.
Check `_common` in [hri.py](../kcare_robot/kcare_robot/skills/hri.py) for the
current default before assuming: it was `'robot'`, and is now `'dashboard'`
(which makes CLI / `POST /skill/<name>` callers fail with "needs a run started
from the dashboard's Agent panel", since they have no channel back).

```
reply::inputs='듣고 있어요', source='dashboard'     # browser mic
reply::듣고 있어요                                  # robot mic (the default)
```

`UnifiedAgent._parse_inputs` treats a string with no `=` as the whole `inputs`,
and otherwise runs `eval("dict(<string>)")`, **falling back to `inputs` when that
raises**. So the CLI-looking forms (`reply::듣고 있어요 source=dashboard`,
`reply::source=dashboard`) silently keep the robot mic and make the robot say
the parameter out loud. Quotes are required.

**HRI steps are not narrated.** `Announcer.SILENT_ACTIONS = {'reply', 'ask'}`
([core/planning/announcer.py](../robot_agent/robot_agent/core/planning/announcer.py))
makes `step_start` / `step_success` / `step_fail` return `''` for those skills.
The milestone narrator runs on its own queue, separate from the HRI
speak/listen queue, so without this it talks over the skill's question — and
with the browser mic already open, the browser transcribes that narration as if
the user had said it. An empty `say` is falsy, so the dashboard skips it and
`Announcer.announce` never reaches the robot speaker either.

That alone is not enough: `plan_ready` (and anything else narrated *before* the
HRI step) carries no action, so it still plays — and it is spoken right as the
mic opens. [page.tsx](frontend/app/page.tsx) therefore also gates the narrator
on the HRI queue: `enqueueHri` keeps a `hriPending` counter, `speak(ev.say)`
only runs at `hriPending === 0`, and each HRI job calls `silenceNarration()`
(`speechSynthesis.cancel()`) before speaking, cutting a phrase that started
earlier. This also fixes the reverse damage — `useVoiceOutput.speak` cancels
in-flight speech by design ("newest milestone wins"), which used to truncate the
skill's own question mid-sentence.

### Visual Q&A (`qa` skill + top-bar button)

The top bar's **💬 Q&A** button (with a ko / vi / en picker, remembered in
`localStorage`) starts a run of `qa::source='dashboard', lang='<picked>'` in
direct mode with milestone voice off; pressing it again calls the same `stop()`
as Cancel, whose `POST /agent/cancel` also releases the listen the skill is
blocked on. The skill (`qa` in [kcare_robot/skills/hri.py](../kcare_robot/kcare_robot/skills/hri.py),
next to `ask`; the vision side is in [skills/qa.py](../kcare_robot/kcare_robot/skills/qa.py))
loops, listening as `ask` does — the opening question and each answer are the
`prompt` of the next listen, so the mic opens right after they are spoken:
listen (browser mic) → if the photos are older than `refresh_sec`, say
"잠깐 둘러볼게요" and photograph the head at each tilt in `views`
(`moveh up / straight / down`, ~1.3 s each), then put the head back → ask the
vision model → speak one short sentence. It ends only on a stop word (그만,
종료, dừng, stop …, only on a short utterance) or on cancel — silence just means
listening again (`idle_turns` is no longer used) (no goodbye then — and the head is left where it is, since a
cancelled node refuses to move). The photos are logged as one labelled mosaic
image in the Execution panel.

The model runs in **Ollama on the dev PC** (RTX 3090, `QA_CONFIGS` in
`kcare_robot/configs/tasks.py`: `url`, `model`, `views`, `refresh_sec`, …,
read through the `QA_CONFIGS` proxy in `robot_agent.skill_configs`). Use the
**instruct** tag `qwen3-vl:8b-instruct`: the plain `qwen3-vl:8b` tag is
thinking-only (`think:false` is ignored), took 1–10 s on real photos and twice
spent the whole token budget reasoning, answering nothing. Instruct answers in
~2.3 s, ~0.2 s for follow-ups on the same photos (Ollama reuses the cached
image prefix). On real closet photos it gets colours and "is there a …?"
right, gives vague "where" answers ("on the white shelf"), and **cannot count
shelf levels** across the three overlapping tilts (answered 2 for levels 4
and 5) — the 8B model's spatial reasoning, not the prompt.

**Camera.** `qa::cam='head'` (default — a photo at each head tilt in `views`)
or `cam='arm'` (one photo from `QA_CONFIGS['arm_camera']`, default `arm_rgb`;
the head does not move, the prompt calls it "arm camera (on the gripper)").
The top bar has a 📷 Head / 🦾 Arm picker next to Voice / Text (remembered in
`localStorage`); the Q&A button adds `cam='arm'` only for the arm. A place's
`qa` block (left / right shelf, …) still applies with the arm camera, but its
left / right are written for the head's view.

**Products (라면 …) and one-shot mode (2026-10-06).** The VLMs cannot name
packs: on the arm-camera shelf photo both 8B and 32B answered "무슨 라면 있어?"
with colours, and with example names in the prompt repeated an example that was
not there (진라면). A question naming a catalogue product or containing 라면 /
noodle / mì now runs the product recogniser on the photos once
(`_products.inventory`: detector + SigLIP vs `configs/products` refs; a pack is
named only when sure, else unnamed):
- names a catalogue product (신라면 있어? / 짜파게티 어디?) → answered from the
  inventory, no model ("신라면은 왼쪽에 있어요." / "…보이지 않아요." + unnamed count);
- names a noodle not in the catalogue (진라면) → "진라면은 확인할 수 없어요." +
  the inventory list — never yes / no;
- general (무슨 라면 / 몇 개) → the VLM, given the verified names as facts; an
  answer naming any other noodle is replaced by the inventory list.
`qa::products=False` turns it off. Sides are left / middle / right of the photo.
Test photo: 신라면, 짜파게티 (left), 너구리 (right) named; 안성탕면 left unnamed
(margin 0.018 < 0.03 — add a ref from this view).

`qa::once=True` answers one question and ends (no goodbye; silence re-asked
`retries` times like `ask`, then `ended: 'no answer'`, isdone False); the result
carries `answer`. Top bar: 🔁 Interactive / 1️⃣ Once picker (localStorage).

**Mic permission.** Chrome only shows the permission prompt during a user
gesture, and the skill opens the mic seconds after the click, so a first use
failed with `not-allowed`. `run()` now calls `primeMic()`
([lib/hriVoice.ts](frontend/lib/hriVoice.ts), a throw-away `getUserMedia`)
inside the click for any plan naming `qa` / `ask` / `reply` (not on the robot
mic or typed), and says in the Q&A card when the mic is unavailable — on plain
http the mic is never allowed (https or localhost only). If recognition still
reports `not-allowed`, `qa` (only — `ask` / `reply` still fail) switches the
run to typed input. When the recogniser hears nothing, the browser posts a
`note` with the listen answer (`mic opened, no sound, no speech, 8.0 s
(no-speech)`) and `listen_dashboard` logs it as `dashboard mic: nothing
recognised — …` in the Execution panel; `no-speech` / `aborted` used to be
dropped silently.

**Whisper for the dashboard mic (2026-10-06).** Google's recogniser (Chrome's
Web Speech API, also its own demo page) missed Korean questions like 와인잔이 /
머그컵 선반 어디에 있어? (`speech detected, 0 result events`). Now the browser
only **records** (`recordPhrase` in [lib/hriVoice.ts](frontend/lib/hriVoice.ts):
MediaRecorder + a WebAudio level VAD, nothing sent when nobody spoke — Whisper
invents "감사합니다." for silence) and posts the audio to
`POST /agent/listen/<id>/audio` (`api.answerListenAudio`); the backend
transcribes it with the **`stt` connection** (Connections panel type
"Speech-to-text (Whisper)": `url`, `model`; `robot_agent/connect/stt`,
OpenAI-compatible `/v1/audio/transcriptions`) and returns the text. The listen
event says which: `capture: 'whisper' | 'browser'`. The robot mic
(`source='robot'`) uses the same connection (`speech_to_text` falls back to the
old `vlms` TCP server only without one). Server: `speaches` container on the dev
PC 3090 (`docker run … --restart unless-stopped -p 8000:8000
ghcr.io/speaches-ai/speaches:latest-cuda`, model
`deepdml/faster-whisper-large-v3-turbo-ct2`, ~2.4 GB VRAM, 0.2–0.3 s per phrase;
all three Korean test phrases right).

Global Config **`HRI_CONFIGS`** (kcare `configs/tasks.py`): `source`
(`dashboard` | `robot` — default mic for reply / ask / qa; a call's `source=`
wins), `dashboard_stt` (`whisper` | `browser`), `stt` (connection id, '' =
first), `stt_hint` (`{lang: words}` — Whisper's prompt). The Q&A button no
longer sends `source` in voice mode, so `HRI_CONFIGS.source` picks the mic.

**Voice or text input.** Next to the language picker, a 🎤 Voice / ⌨ Text
picker (remembered in `localStorage`) adds `input='voice'|'text'` to the run.
Text mode reuses the HRI listen channel: `listen_dashboard(mode='text')` puts
`mode` in the `listen` event, and `page.tsx` then waits for a line typed in the
**Q&A card** ([components/QaChat.tsx](frontend/components/QaChat.tsx)) instead of
opening the mic, posting it to the same `POST /agent/listen/<id>`. The card shows
the conversation in both modes (robot lines from `speak` / prompts, user lines
from the recognizer or the typed text). `qa` waits for a typed question until
it comes or the run is cancelled (`hri.QA_TEXT_WAIT_SEC`); `ask` / `reply` keep
the 300 s `hri.TEXT_WAIT_SEC`. `input` is parsed in
`hri._common`, so `reply` / `ask` accept it too; it needs `source='dashboard'`.
Stop, `done` or `error` resolve a pending typed answer with nothing posted.

**Where-questions per place.** An ENV entry may carry a `qa` block (`views`,
`scene`, `frame: robot|person`, `places: {id: {desc, ko, en, vi}}`). `qa` uses
the block of the ENV location nearest the base (`loc_radius`, 1 m) or of
`qa::loc='옷방'`: it photographs only that block's `views`, the model returns
JSON (`items: [{what, place}]`, `place` restricted to the ids by a JSON-schema
`enum`), and the spoken answer is built from the phrases — "행거 왼쪽과 행거
가운데에 있어요", "앞에 있어요" — so wording is fixed and cannot name a place
that is not configured. Only questions containing a where-word
(어디 / đâu / where) get the place answer; the rest stay free-form. No extra
motion. Configured on kcare_bucheon: `counter2@kitchen` (left / right shelf,
dish rack), `dressroom` (rail left / middle / right, corner shelf top / middle
/ bottom, drawers), `table@kitchen` (user's front / left / right). On the
captured photos: 18/22 — dressroom 8/8; wrong: the blue cup next to the
cabinet divider (always "left"), and person-relative left/front at the table.
Per-shelf counting (2nd / 3rd shelf) failed, hence the coarse top / middle /
bottom tied to the up / straight / down photos.

**Model server (2026-09-30).** `QA_CONFIGS` now points at the 4×A6000 Ollama
server (`https://ollama.aistations.org`, `qwen3-vl:32b-instruct`), leaving the
dev PC's 3090 to visionserve. `num_ctx` (8192) is sent with every request:
without it the server loaded the 32B with its 262k default context, 94 GB over
several GPUs at 16 tok/s. `qa` reuses one HTTP session (a TLS handshake to the
Cloudflare hostname costs 0.3–1.3 s). Same 22 questions, server models:
32b-instruct 19/22, 2.4 s median; 8b-instruct 18/22, 2.0 s; 30b-a3b-instruct
16/22 (swaps left/right at the cabinet), 1.9 s. Local 8b on the 3090: 18/22,
0.5 s. About 1 s of each answer is the network — a LAN address would cut it.

### Cancel / Stop

Closing the agent WebSocket never reached the robot: the plan runs in a backend
thread (`UnifiedAgent.run`), so the skill in flight finished and every remaining
step still executed. Stopping is now explicit — `POST /agent/cancel`
(`api.cancelRun`), sent by the Agent panel's **Stop** and by the always-live
**Cancel** button in the top bar, and also triggered backend-side when the agent
WebSocket disconnects mid-run (reload, closed tab, dropped network).

The backend side is [robot_agent/core/run_control.py](../robot_agent/robot_agent/core/run_control.py)
plus `CustomNode.cancel_all()`
([connect/ros/node.py](../robot_agent/robot_agent/connect/ros/node.py)), which:

- cancels every in-flight **action goal** in two steps: `cancel_goal_async()` on
  the handles this process holds, then a **CANCEL_ALL** on the action's own
  `<conn_name>/_action/cancel_goal` service (zero uuid + zero stamp — the Python
  form of the `ros2 service call ... action_msgs/srv/CancelGoal` command), which
  also stops goals this process never held: sent by another client, or left
  running across a backend restart. The kcare servers (`arm_moveJ/T/L`,
  `lift_move`, `head_move`, `navigate_to_pose`) accept both and stop the motion;
  a cancelled goal's Result is reported as a failure instead of being decoded as
  a success. Agents are cancelled in parallel, so one unreachable action cannot
  hold up the rest;
- drops the **service** calls being waited on, so the skill unwinds at once;
- sets a node-wide flag, so an action / service agent **refuses to send** while
  cancelled — a skill mid-sequence cannot start a fresh motion;
- releases any HRI skill blocked on the dashboard microphone.

The flag is process-wide (one robot per process), so Cancel also stops a skill
started from the CLI or a second client. It is cleared by `begin_run()` at every
entry point (`/ws/agent`, `POST /skill/<name>`, `POST /agent/<name>/send`), so a
cancel never leaks into the next command. A cancelled run ends with
`done{status:'aborted'}`; the closed loop stops instead of replanning.

**Per-connection `cancel_func`.** A ROS *action* connection can define its own
cancel, edited in the `DevicePanel` add/edit form next to `encode_func` /
`decode_func` and stored in `connections.json` the same way (templates in
[frontend/lib/ros_templates.json](frontend/lib/ros_templates.json) carry a
sample):

```python
def cancel_func(node, agent):        # return True if a stop was sent
    return agent.cancel_all_goals()  # what the default does
```

Creating a ROS *action* connection (add form or quick-connect from a ROS scan)
prefills the box with that sample, so a new action starts from a working stop
rather than a blank editor; editing an existing connection leaves whatever it
already has. kcare's `mobile_move` (`/navigate_to_pose`) carries it filled in.

It **replaces** the default for that connection, so cancel the goal handles
yourself if you still want that
(`for h in list(agent._goal_handles): h.cancel_goal_async()`). Leaving the box
empty is also fine — the backend default is exactly what the sample spells out.

**Limitation — mobile services.** `mobile/shift_pose`, `mobile/rotate` and
`mobile/absolute_rotate` are ROS *services*, which have no cancel protocol.
Cancelling stops the client waiting, but `slamtec_bridge.py` keeps publishing
`/cmd_vel` for the whole duration of a shift, and its only stop command
(`/slamware_ros_sdk_server_node/cancel_action`) lives in the slamware ROS
domain, which `robot_agent` cannot reach. Making the base stop on cancel needs a
stop service on the robot side (`keti_assist_ai_robot_ros2`); once it exists,
register it with `node.add_cancel_hook(...)` — no change needed here.

### Camera streaming (multiple viewers)

`/ws/camera/<connect_id>` runs **one worker thread per camera**, shared by every
browser watching it ([robot_agent/api/camera.py](../robot_agent/robot_agent/api/camera.py)).
Each websocket used to start its own thread keyed by `connect_id`, so a second
browser tore down the first one's stream and `CameraCell`'s 1.5 s auto-reconnect
tore it back — two dashboards on one robot spent their time restarting each
other's streams (and 3 s per round joining threads), which is what made
*everything* on the robot feel slow, not just the video.

The worker now:

- encodes a frame **once per distinct depth setting** and sends the same JSON to
  every subscriber sharing it. Settings (`depth_mode`, `depth_range`) stay
  per-client, so one browser's one-shot raw-depth save does not push raw frames
  at the others;
- **skips encoding when no new frame arrived** — `TopicAgent.rev_seq`
  ([connect/ros/node.py](../robot_agent/robot_agent/connect/ros/node.py)) is
  bumped per message received. A viewer that just joined still gets the frame
  the worker is holding, rather than a blank panel on a stalled camera;
- **drops frames** for a client whose previous send has not completed, instead
  of queueing sends into the event loop shared with `/ws/agent` and all HTTP;
- lingers 15 s after the last viewer leaves, so a page reload or a grid ↔ tab
  switch reuses the worker instead of rebuilding it.

CPU no longer scales with the number of dashboards.

`GET /connects/status` is cached the same way: the `DevicePanel` polls it every
10 s *per browser* and a probe actively pings every device (a 1 s TCP connect for
an unreachable webrtc camera), so `DeviceManager.get_status()` now serves a
result cached for 5 s — one probe for all dashboards. The cache is dropped
whenever the device set changes (add / remove / location switch), a probe that
straddles such a change is discarded rather than cached, and a second caller
arriving mid-probe is served the previous result instead of queueing behind it.
`?fresh=1` forces a re-probe.

One cost from the same investigation is still **not** addressed: `kcare_robot`'s
`make run` passes `--reload` to uvicorn, which watches the whole (sshfs-mounted)
tree.

### Planner guide versions

The LLM **guide** (the prompt that turns a task into a plan) is now versioned and
editable. The backend stores versions in `common_dir/guides.json` (seeded on first
run from the robot's `configs/guide*.py` modules); the **active** version is what
the planner uses, falling back to the modules when the store is empty. Each version
is `{ name, guide, format }` — `format` is `null` for a freeform guide
(`llm.chat_guide`) or a JSON schema for a structured one (`llm.chat`). The
`GuideEditorPanel` ([frontend/components/GuideEditorPanel.tsx](frontend/components/GuideEditorPanel.tsx),
in sidebar 1) is an expandable block to select / edit / add / delete versions and
set the active one; wrappers (`listGuides`/`createGuide`/`updateGuide`/`deleteGuide`/
`activateGuide`) and the `GuideVersion` type live in
[frontend/lib/api.ts](frontend/lib/api.ts) / [frontend/lib/types.ts](frontend/lib/types.ts).
(Distinct from `GuidePanel.tsx`, which is the connection-config help modal.)

`POST /skill/<name>` is the same path the CLI mode (`<pkg> <name>::<inputs>`)
ultimately resolves through `SkillRegistry.execute()`. Two clients (UI +
CLI) calling the same robot simultaneously is **unsafe** — document this
in any operator-facing UI.

## Dev / deploy

```bash
make install            # npm install in frontend/
make run-frontend       # next dev on :3007
make build-frontend     # static export to frontend/out/
CLOUDFLARE_API_TOKEN=… make deploy
make deploy-status
```

Cloudflare Pages project: `robotapp`. Custom domain:
`robot.aistations.org`. Account ID is pinned in [Makefile](Makefile).

## Related

- [robot_agent](../robot_agent) — backend FastAPI runtime. New endpoints
  added there must be reflected in `frontend/lib/`.
- [kcare_robot](../kcare_robot) — reference robot backend used in
  development. Boots on port 8001.
- [robot_template](../robot_template) — generator for new robot
  backends. Every new project is dashboard-compatible by default
  (same `robot_agent` API).
