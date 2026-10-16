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

### Location config profiles

A robot backend stores one config folder per deployment site (its own
`connections.json` + global configs). The `DevicePanel` exposes a **Location**
picker (next to the Robot picker) to choose / add / rename / delete sites and
hot-switch between them. Wrappers live in [frontend/lib/api.ts](frontend/lib/api.ts)
(`listLocations`, `activateLocation`, `createLocation`, `renameLocation`,
`deleteLocation`); switching triggers a backend device reconnect, so the UI
refreshes the connections list right after. Sites are a **per-robot backend**
concept (distinct from the multi-robot URL registry kept in `localStorage`).

**Several machines on one configs folder (2026-10-08).** The configs folder is
shared (`/remote_dir`, sshfs on the robots) by every machine running the same
robot package, so nothing one machine saves may undo another's:

| What | Where | How |
|---|---|---|
| active site | `common/active_location.<host>` | per machine (2026-10-07: one shared marker made two machines flip kcare_bucheon ↔ clobot_bucheon); boot reads `$ROBOT_LOCATION` → own marker → old shared `active_location` (`state.read_active_location`) |
| Robot State (world belief) | `common/world_state.<host>.json` | per machine (was one shared `world_state.json`: robot B inherited A's `holding`) |
| logs (`<pkg>.log`, ros, llm) | `data/logs/<host>/` | per machine (`runtime._resolve_layout`) |
| task runs, grace memory | `common/task_runs/<host>/`, `common/grace_memory.<host>.jsonl` | per machine (`planning/loop.py`) |
| skills (+ aliases, plan skills), buttons, guides | `common/skills.json`, `buttons.json`, `guides.json` | **shared, saved as merges** |
| connections, Global Configs | `locations/<site>/connections.json`, `skill_configs_override.json` | per site; **saved as merges** when two machines are on one site |
| SwitchBot last state | `locations/<site>/switchbot_state.json` | per site (was `data/`), re-read + atomic write |
| presence | `common/hosts/<host>.json` | heartbeat every 20 s (server mode) |

`<host>` is `state.host_id()`: `$ROBOT_AGENT_HOST`, else the hostname.

**Merged saves** ([core/shared_json.py](../robot_agent/robot_agent/core/shared_json.py)).
Every manager used to rewrite its whole file from memory, so a save on robot B
dropped the plan skill robot A had added since B loaded. Now a save re-reads the
file and applies only what this process changed since its last read (per item:
a skill / button by id / guide version / connection / Global Config group;
added, edited, removed, reordered), writes it atomically (own tmp file +
rename, previous version as `.bak` — the file never disappears), and adopts
the result. Reads (`GET /skills`, `/buttons`, `/guides`, `cm.get`, `sr.resolve`)
reload the file when another machine changed it (one check per 1–2 s). An item
both machines changed keeps the later save. A connection another machine added
is carried along but not connected here until a restart / site switch.
`flock` only serialises processes of one machine; across machines the window
is the few ms between re-read and rename.

**sshfs caveat (measured on the robot).** After the dev PC rewrote a file, a
plain `stat` on the robot kept the old size / mtime for ~19 s, and the first
`open` + `read` returned the new content cut to the OLD size (`{"a": 1,`). An
`open` refreshes the cache: `shared_json.read_fresh` re-reads while the size
read differs from the size after, `stat_fresh` opens before `stat`. Use
`read_fresh` for any shared file another machine may rewrite.

**Presence** ([robot_agent/presence.py](../robot_agent/robot_agent/presence.py)).
`GET /config/locations` returns `host` and `others: [{host, location, age_sec,
clash?}]` (records ≤ 60 s old). The Location picker shows `— also on <host>`
per site and an amber warning when another machine is on the active site
(they share its connections and Global Configs: give each robot its own
location); renaming / deleting a site another live machine is on is refused
(400). Two machines with the **same host id** (cloned Jetson images are all
`m-ax-jetpack`) would share every per-machine file: when the presence record
is rewritten by another kernel `boot_id` after this process started, the
picker shows a red warning — set `ROBOT_AGENT_HOST` on one of them.

ROS is not shared between robots: the apps container's Fast DDS profile
(`/workspace/fastdds_profile.xml`) uses SHM + UDP on 127.0.0.1 only.

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

### Spoken names in plans: `said->real` (2026-10-08)

A plan can give a skill name or **any** parameter value two names: what the
robot says, and what it runs. Skill and location aliases are kept as they are;
this is an addition (proposal: [PROPOSAL-spoken-names.md](PROPOSAL-spoken-names.md)).

```
이동->move::식탁 앞->table_top                       # runs move::table_top, narrates "식탁 앞 이동을 진행합니다"
pick_top::inputs='컵->cup', loc='식탁->table@kitchen'
ask::inputs='어디로 갈까요?', options="식탁 앞->table_top, 옷방->dressroom"
이동->move::{answer}                                 # gets '식탁 앞->table_top' from ask
```

- Helpers in [robot_agent/spoken.py](../robot_agent/robot_agent/spoken.py)
  (`split_spoken`, `split_value`, `split_params`, `split_skill`, `said_of`,
  `real_step`). No arrow = one name, as before. More than one `->`, nothing
  after it, or `->>` fails the step.
- **`SkillRegistry.execute`** splits the skill name and every parameter of a
  code skill (internal / external) and installs the said sides for the call;
  a skill reads them with `robot_agent.skills.spoken(key, value)` (`'skill'` for
  its own name). Pass the value the skill holds: the said name is returned only
  while it still belongs to that value, so `move` → `lift(inputs='home')` does
  not read the outer step's name. **Plan skills get their params unsplit**, so
  the step inside (`move::$loc$`) still has both names. `skill_entry` (Python
  API) splits too. `options` and `others` are never split there (`ask` needs the pairs:
  `->`, or the older `=`; kcare `find` / `pick` take each `others` item's real side, so ask's options can be
  copied as they are).
- Real side type: `inputs` stays text (`lift::0.5` has always been `'0.5'`);
  other keys go through `ast.literal_eval` (`fixed_angle='정면->0'` → `0`).
  `>>` values split per segment (`컵->cup>>식탁->table` → `cup>>table`).
- A `k=v` value with `->` **must be quoted**; unquoted, `parse_inputs` now
  refuses the line instead of silently running it all as `inputs`.
- `{name}` used as a whole value goes in as `<name>_text->value` when the result
  has a different `<name>_text` (ask's `answer_text`), so the next skill says
  what the user chose.
- Who uses the said side: the narrator (direct mode `_verb_obj`, closed loop
  `ClosedLoop._say` from `step['say']`, set by `llm_direct._parse_steps`);
  kcare `announce_placing`, `pick`'s `announce_picking`, `select_response`.
  The Robot State update gets the real names (`real_step`). The Plan panel
  shows `->` as `→`; `PlanSkillEditor` checks the real skill name.
- Free text containing `->` (`announce::A->B`) is split too — accepted.
- Korean step phrases pick 을/를 from the verb (`announcer._eul`), which also
  fixed the old "이동를".
- CLI: quote the whole thing (`>` is a shell redirect):
  `kcare_robot '이동->move::식탁 앞->table@kitchen'`.

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

**Languages (2026-10-13): Korean and English only.** Vietnamese was dropped from
the skills (hri `LANGS = ('ko', 'en')`; `lang='vi'` is refused) and the UI. The
dashboard has ONE language picker, KO / EN in the Agent panel
(`page.tsx` `lang`, `localStorage` `robotapp_lang`), used by Agent runs and by
the Q&A button; it is locked while a Q&A conversation runs. robot_agent's own
narrator (`announcer.py`) and TTS helpers still know `vi` — framework, not skills.

**Where on the shelves — from depth, nothing per place (2026-10-13).** At shelf2
the answers rambled or named the wrong side: `sink` and `shelf2@kitchen` share a
spot, `get_closest_loc` returned sink (no `qa` block) and the question was
answered free-form; `_place_config` now prefers the nearest entry with a block.
Then the 8B model, asked to name the place itself, was not stable (the red
tumbler filed under 머그컵; shelf levels one too high; a prompt change moved the
wine glass to the wrong column). Place boxes drawn on a photo fixed that but
broke at 20 cm off the spot and needed drawing per place, so they were dropped.
Now (`_ask_shelves` in `kcare_robot/skills/hri.py`):

- every head photo keeps its depth frame and the camera pose in the base frame
  (`_capture_geo`: 16 pixels through the `get3d` service while the head is at
  that tilt, Kabsch fit — 0.08 s, same xyz as `get3d` for every pixel);
- the VLM boxes the asked objects (each with its own kind, so a tumbler is not
  a mug), the shelf unit, and once per set of photos every object
  (`_inventory_boxes` — mug rims looked like a board and a cup's side like a
  divider when only the asked thing was boxed);
- inside the unit: horizontal surfaces spanning ≥ 35 % of its width = boards,
  sideways-facing surfaces ≥ 60 % of the shelves' height away from its sides =
  dividers; an object's level = the interval its lower half is in, its column =
  dividers to its left → "밑에서 두 번째 칸 오른쪽에 있어요" (2026-10-16: levels always counted from the
  bottom; was "오른쪽 선반 가운데 칸"; same 5 + 1 captures: 24 / 24 right).
- If the bottom of the unit is out of view, levels are counted from the top
  ("위에서 두 번째 칸").

Used for where-questions at a place with no `qa` block or with
`'shelves': True` (shelf2: `{'views': ['up'], 'shelves': True}`); no shelf found
→ the place layout / free answer as before. Tests on 5 real captures at shelf2
(head tilt 10–25°): 45 / 45 right (와인잔 → 오른쪽 가운데, 머그컵 → 왼쪽 아래, 텀블러
→ 오른쪽 아래). Boards found at 1.61 / 1.85 / 2.12 / 2.35 m, camera at 1.47 m.
Live check (the real `qa` with typed questions, real head motion / depth /
get3d — `kaair_real_capture/qa_shelf2_20261013/test_qa_live.py`) found two
things the offline bench had hidden: the conversation **history** made the
model answer "머그컵 어디?" with the wine glasses of the previous question (no
history is sent for shelf answers now), and the unit box drifting 1–2 % cut
off the bottom board (the box is grown 5 % each side). After: 15 / 15 over 3
conversations. Not tested yet: the robot really off its spot, other shelf units.

**Which objects, and when to ask again (2026-10-13, from live logs).** The
model's `asked` flag was not reliable (asked for 머그컵 it flagged the red cup it
had itself called "tumbler"), so it now names `asked_kind` and the code picks
the items whose kind has every word of it (`_asked_items`: "mug" → mug, travel
mug; not tumbler). When Whisper lost the object word ("선반 어디에 있어?") the
model asked for "shelf", nothing matched, and all four occupied cells were
read out; a question naming no object (`_no_object`: empty / shelf / cabinet /
thing …) is now answered "무엇을 찾으시는지 잘 못 들었어요. 다시 말씀해 주세요."
A cut edge needs the unit's back wall beyond the last board (shelf2: x 1.33 m
above a cut-off top level vs the frame at 1.03 m) — the model's box reached
the photo's top for a unit that did not go on.

**qa leaves a trail (2026-10-13).** hri's `log_data` also writes each message
to `data/logs/<host>/kcare_robot.log` (`kcare_robot.hri`: user / robot lines,
`qa: shelves — …`, `qa: answer by …`, why depth was missing), and every
look-around is saved in `data/logs/<host>/qa/<time>/` (`<view>.jpg`,
`<view>_geo.npz`: depth, K, R, t; last 60 kept) for offline replays. The
Execution panel itself stores nothing. (The logger is `robot_agent.skill.hri`:
only the `robot_agent` tree has the file handler.)

**The VLM switched to 32b @ aistations "after a UI refresh" (2026-10-13).** It
was a backend restart: `DeviceManager.load_saved` connects the saved devices
one by one, unreachable hosts (`vlms`, `task_planner` on 192.168.1.11) hold the
rest up for ~20 s, and a `qa` started in that window found no `vlm` connection
and fell back to `QA_CONFIGS` (kcare `tasks.py`: 32b @ ollama.aistations.org).
`DeviceManager.saved_connect(cid)` now returns a connection as saved, and qa
uses it while it is not connected yet; the log line says which
(`qa: VLM … from connection 'vlm' (saved, not connected yet)`).

The top bar's **💬 Q&A** button starts a run of `qa::lang='<lang>'` in
direct mode with milestone voice off; pressing it again calls the same `stop()`
as Cancel, whose `POST /agent/cancel` also releases the listen the skill is
blocked on. The skill (`qa` in [kcare_robot/skills/hri.py](../kcare_robot/kcare_robot/skills/hri.py),
next to `ask`, with its vision helpers in the same file — `skills/qa.py` was folded in on 2026-10-13)
loops, listening as `ask` does — the opening question and each answer are the
`prompt` of the next listen, so the mic opens right after they are spoken:
listen (browser mic) → for every question (`reuse_photos`, default off, answers from the last photos while younger than `refresh_sec`; `memory`, default off, sends the earlier turns to the model — both since 2026-10-13), say
"잠깐 둘러볼게요" and photograph the head at each tilt in `views`
(`moveh up / straight / down`, ~1.3 s each), then put the head back → ask the
vision model → speak one short sentence. It ends on a stop word (그만,
종료, stop …, only on a short utterance), on cancel (no goodbye then — and the head is left where it is, since a
cancelled node refuses to move), or on a long silence (2026-10-15): after `QA_CONFIGS.idle_ask_sec` (60 s) with
nobody speaking the robot asks "더 궁금하신 게 있으세요? 대답이 없으시면 잠시 후 대화를 마칠게요."; 아니요 / 없어요
ends it, 네 → "네, 말씀하세요.", a question is answered, and `idle_end_sec` (30 s) more of silence ends it ("대답이
없으셔서 대화를 마칠게요."). 0 = listen forever; not for typed input or `once`.
**⏹ End Q&A** (2026-10-15): while a `qa` runs (it emits `qa_state: {active}`; also inside a plan), a grey button
next to Cancel and in the Q&A card calls `POST /agent/qa/end` (`api.endQa`). `run_control.request_end_dialog`
sets a flag and answers the pending dashboard listen with nothing (`utils.end_pending_listens`; the robot mic's
`record_phrase` stops too); qa ends as on a stop word — an answer already worked out is still said, then
"대화를 마칠게요." — returns `isdone: True, ended: 'operator'`, and the plan goes on (Cancel aborts the run). Only qa
registers (`dialog_begin` / `dialog_end`): not `ask` / `reply`, not the emergency exchange; 409 when none runs. The photos are logged as one labelled mosaic
image in the Execution panel.

The model runs in **Ollama on the dev PC** (RTX 3090, `QA_CONFIGS` in
`kcare_robot/configs/tasks.py`: `url`, `model`, `views`, …,
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
**At shelf1 (2026-10-13, arm camera).** "라면 있어" was answered in Chinese
("架子上放着짜파게티、신라면和안성탕면。") and without the pack the recogniser could not name: the
model rephrasing the verified names was the weak step, not the recognition. A list question
(무슨 / 어떤 / 뭐 / 있어 … — `_LIST_QUESTION`) is now answered straight from the inventory
(`_product_list`: "왼쪽에 신라면과 짜파게티, 오른쪽에 너구리와 안성탕면이 있어요."); other product
questions still go to the model, and any ko / en answer with Chinese characters or kana is asked
again once at temperature 0, then dropped (`_wrong_script`). Also: `qa` said "at shelf2" at
shelf1 — the nearest entry WITH a qa block won within loc_radius (shelf2 0.55 m away); a block
now only wins among entries on the same spot (`QA_SAME_SPOT` 0.1 m: sink / shelf2, shelf1 /
counter). Test (`kaair_real_capture/qa_ramen_shelf1_20261013/test_ramen.py`, real arm camera,
detector, SigLIP, VLM; nothing moves): 12 / 12 right over 3 phrasings.
Test photo: 신라면, 짜파게티 (left), 너구리 (right) named; 안성탕면 left unnamed
(margin 0.018 < 0.03 — add a ref from this view).

**Lights in qa (2026-10-13).** "세탁실 불 켜져 있어?" (a light noun + 켜져 / 꺼졌 / 상태 …, no
줘 / 놔 / turn) is answered from the `light_state` skill (`_light_state_answer` in hri.py), not
taken as a command as before: "세탁실 불은 켜져 있어요. 꺼 드릴까요?". The next turn's "응" /
"꺼줘" (no 불 needed) runs `turn_light` on that light; "아니" leaves it. A light not heard now
is told with its age ("11분 전에는 … 켜져 있었어요"), never as the present state. Lights are
named by the switchbot connection's `aliases` (kcare_bucheon: laundry room = 세탁실 / 세탁방 /
빨래방); the first Korean alias is the spoken name. No place named ("불 켜져 있어?", "불 꺼줘")
→ only the connection marked `default` (the laundry room) — never every light; the warehouse
light is left out of qa unless named by its id.
First live try: Whisper heard "시대에 불 켜져 있어" (fine: default light) and then "택시, 고죠" for
the yes, which went to the camera answer. Now (1) qa's Whisper hint has the light phrases
(`_light_hint`) and, right after "꺼 드릴까요?", only "네, 꺼 주세요. 아니요, 그대로 두세요."
(`_offer_hint`); (2) the answer is read by `_offer_reply` (yes / no / on / off, mixed signals or
the hint echoed back = unclear) and an unclear one is asked again ("잘 못 들었어요. 세탁실 불을
끌까요? 네 또는 아니요로 말씀해 주세요.", `OFFER_RETRIES` 2, then "그대로 둘게요") — never acted
on, never sent to the camera; a new question (어디 / 뭐 / 몇 …) is answered as usual; (3) every
qa recording is kept in `data/logs/<host>/qa_audio/` (`<time>.webm` from the dashboard, `.wav`
from the robot mic, last 300) with `index.jsonl` {file, text, hint} for offline replays —
`listen_dashboard(audio_out=[])` hands the recording back.

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

**🔥 Warm up (2026-10-16).** Whisper unloads after 300 s unused, Ollama after `keep_alive`, visionserve loads a
model on its first call — and on 2026-10-15 Whisper could not load again (GPU full) and `ask` failed. The
DevicePanel's **🔥 Warm up** (next to Ping All; operator-clicked, nothing runs by itself) calls kcare's
`warmup_servers` skill (`skills/warmup.py`, also usable as a plan step; not narrated). It warms **every server of
every AI connection at the same time**: Whisper (0.5 s of silence), Ollama (an empty `/api/generate` with
`keep_alive`), visionserve (the models kcare calls: FIND_CONFIGS detectors, `siglip-image`); a cloud API only has
its key and model checked. Per kind: **red** when every server of the kind failed, **green** when the main (first)
server of every connection of the kind works, **amber** when a main server failed but another works (calls fall
back). The line reads `Voices ✓ (1/1) · VLMs fallback (2/3): vlm #2 …: unreachable · Visions ✓ (2/2)`;
`isdone` is False only on red.

Global Config **`HRI_CONFIGS`** (kcare `configs/tasks.py`): `source`
(`dashboard` | `robot` — default mic for reply / ask / qa; a call's `source=`
wins), `dashboard_stt` (`whisper` | `browser`), `stt` (connection id, '' =
first), `stt_hint` (`{lang: words}` — Whisper's prompt). The Q&A button no
longer sends `source` in voice mode, so `HRI_CONFIGS.source` picks the mic.

**Earcons (2026-10-14).** A blind user cannot see that the mic is open, so every voice listen (`ask`, `reply`,
`qa`, both mics) is framed by two short tones: two rising notes (600 → 900 Hz) right before the mic opens ("your
turn") and two falling ones once a phrase was taken ("got it"; none when nobody spoke). The "your turn" tone is
played to the end + 0.1 s before recording starts, so neither the robot's VAD nor `recordPhrase`'s noise-floor
calibration hears it. Robot side: `robot_agent.utils.earcon` / `play_earcon` (44.1 kHz — kcare-3's speaker refuses
16 kHz, which also breaks `play_audio` at its 16 kHz default), called in hri `_hear`. Dashboard: the `listen`
event carries `earcon` (volume, 0 = off) and `page.tsx` plays `playEarcon` ([lib/hriVoice.ts](frontend/lib/hriVoice.ts),
WebAudio, same notes); typed input gets none. `HRI_CONFIGS.earcon` (on) / `earcon_volume` (0.3); `ask::…, earcon=False`
per call. `ask` (2026-10-16): `read_options` defaults to False — only the question is asked; the chosen option is said ("짜파게티, 알겠습니다"), the user's own words are not (`confirm=True` repeats them when there are no options, `confirm=False` says nothing); the first time it does not understand (no answer / no match) the options pop up as buttons on the dashboard that started the run and the robot waits for a click — it does not say it did not hear or ask again (`screen_choice`, default on; `choose` / `choose_close` events, forwarded by `_make_log_fn`; a click posts `POST /agent/listen/<id> {text: option}` and the choice is said as if spoken; no click in `screen_wait_sec` (30) → the ask fails); without a dashboard or with `screen_choice=False` it asks again by voice as before; the options ("… 중에서 골라 주세요") are read with `read_options=True`, and always after an answer that matched none.

**Speech rate (2026-10-15).** `HRI_CONFIGS.speech_rate` (default **1.3**, clamped 0.5–2.0; Global Configs → HRI_CONFIGS
shows it as a slider 0.5–2.0 with a ▶ button that says a sample line at that rate, before saving) sets how fast the browser speaks. kcare's
hri skills (`reply` / `ask` / `qa` / `announce`, emergency) call `robot_agent.utils.set_speech_rate` (per thread)
in `_common` / `_set_rate`; a call's `rate=` wins (`announce::inputs='…', rate=0.8`). `say_to_user` puts it in
the `speak` event as `speak_rate`, `listen_dashboard` in the `listen` event as `rate`; `page.tsx` passes it to
`speakAndWait(text, lang, rate)`. The milestone narrator (`useVoiceOutput`, `rate` option) has no such field: the
page reads `GET /skill-configs/HRI_CONFIGS` on mount and at every run. `speakAndWait`'s safety cap (Chrome can
lose `end`) and `say_to_user`'s wait are divided by the rate when it is below 1, or a slow line would open the mic
while still being said. The robot speaker (gTTS) ignores the rate.

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

### AI servers: vlms / visions / voices, with fallback (2026-10-16)

When the 3090 is full a server fails (Whisper OOM) or slips to the CPU (Ollama puts part of the model in RAM). The
AI connections are now three types, each one **role** served by an **ordered list of servers**
([robot_agent/connect/pool.py](../robot_agent/robot_agent/connect/pool.py)):

| type | id (kept, so skills did not change) | servers |
|---|---|---|
| `vlms` | `vlm` — qa, find verify, and the planner when active | `provider` ollama / openai / gemini / anthropic, `url` (Ollama), `model`, `num_ctx` |
| `visions` | `visionserve` — find / find_grasp / products | `url` |
| `voices` | `whisper` — reply / ask / qa (`dm.stt_client()`) | `url`, `model` (a smaller Whisper on the same server needs less GPU) |

Each server also has `enabled`, `slow_sec`, `timeout`; the connection `cooldown_sec` (60).

- A call goes to the first usable server. Failing (no connection — 3 s connect limit, a TCP check first for
  visionserve —, timeout, HTTP error, out of memory, no API key) or **on the CPU** (Ollama: `/api/ps` shows
  `size_vram < size` after an answer slower than `slow_sec`; Whisper / visionserve: two calls in a row slower
  than `slow_sec` — the first call of a model loads it) puts the server aside for `cooldown_sec`; then it is tried
  first again, so the main server takes over again once it works. All set aside → still tried in order. Only
  whole requests are sent again (inference, never motion). Every switch is a log line
  (`vlm: #1 … unreachable → #2 … (2.9 s)`).
- `vlms` speaks four APIs with one Ollama-shaped body (`VlmPool.chat`: messages with base64 `images`, `format`,
  `options.temperature / num_predict`). Cloud: OpenAI chat completions, Gemini `generateContent` (flash models
  with thinking off), Anthropic messages; a JSON `format` becomes "answer with JSON only, matching …" plus
  their JSON mode. Keys come from the site's `.env` (`OPENAI_API_KEY`, `GOOGLE_API_KEY` / `GEMINI_API_KEY`,
  `ANTHROPIC_API_KEY`; typed in the server row, saved with `POST /agent/api-key`), never `connections.json`.
  A cloud server receives the robot's photos.
- Callers: hri `_post_chat` (qa, `find::verify`) sends through the pool when the `vlm` connection is a `vlms`;
  `dm.get_client('vlm' | 'llm')` is an LLMobj on the pool (translate, llm_direct, assist loop);
  `active_llm_config()` returns `{name: 'pool', connection}` + the first usable Ollama server's url / model
  (GRACE talks to Ollama itself); `get_client('visionserve')` / `stt_client()` are proxies whose methods go
  through the pool. The older `llm` / `visionserve` / `stt` types still work (one server, no fallback) and are
  listed under the same headings; they can be edited but not added.
- `GET /connects/servers` → `{id: {level: ok | warn | error | unknown, using, servers: [{label, status: ok |
  slow | down | off | unknown, error, last_sec, cooldown}]}}` (state only; `GET /connects/status` probes:
  Ollama `/api/version` + `/api/ps`, visionserve `health()`, Whisper `/health`; cloud servers are not probed).
- DevicePanel: Connections are headed **VLMs / Visions / Voices** first; a pool row's dot is its level (green /
  amber / red / grey) with one line per server under it (dot, `← in use`, `slow / CPU`, `skip Ns`). The form
  ([components/ServerListEditor.tsx](frontend/components/ServerListEditor.tsx)) edits the servers: provider,
  url, model, num_ctx, slow after, on/off, ▲▼ to reorder, ×, + server, the cloud key.
- `pool.tidy_connections(items)` (pure) merges a site's AI connections into one per kind (vlm / visionserve /
  whisper, servers deduplicated, the existing id's servers first). Preview script:
  `kaair_real_capture/server_pool_20261016/tidy_preview.py <site>…`. Test against the real servers (a dead
  first server, a cloud server without a key → the dev PC answers; nothing moves):
  `kaair_real_capture/server_pool_20261016/test_pool.py`.

### Cancel / Stop

Closing the agent WebSocket never reached the robot: the plan runs in a backend
thread (`UnifiedAgent.run`), so the skill in flight finished and every remaining
step still executed. Stopping is now explicit — `POST /agent/cancel`
(`api.cancelRun`), sent by the Agent panel's **Stop** and by the always-live
**Cancel** button (right end of the Cameras / Map tab row), and also triggered backend-side when the agent
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

### Map tab (click to move)

The main area has two tabs, **Cameras** and **Map**
([frontend/components/MapPanel.tsx](frontend/components/MapPanel.tsx)). The Map tab is generic: it reads
the active site's `MAP` skill-config group (`GET /skill-configs/MAP`, type `MapConfig` in
[frontend/lib/types.ts](frontend/lib/types.ts)); a site without one just says so.

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
([robot_agent/api/map.py](../robot_agent/robot_agent/api/map.py)), which writes the site files
`map/map.png` (free white / unknown grey / occupied black, row 0 = top) and `map/occupancy.png`
(0 free / 128 within `inflate_m` = 0.3 m of an obstacle / 255 occupied or unknown), moves the old
pair to `map/history/`, and sets `MAP.image = {file, frame}`, `MAP.layers.occupancy` and
`MAP.source` — other MAP keys are kept. `MAP.image.file` is drawn under everything (else the
occupancy layer, as before). Without `pose` / `goal` the map is **view-only** (clicks explain why).
kcare_bucheon: 267×422 cells at 5 cm, origin (−3.8, −14.85); pose / goal / places not set yet.

**Sim bar: reset / scenes / object + furniture catalog (sim only, 2026-10-08).** Shown when
`MAP.sim = {agent}` is set (kcare-sim: `sim_command`, a ROS-service connection to the bridge's
`/sim/command`, `sim_msgs/SimCommand` = JSON string in / out), in
[frontend/components/mapSim.tsx](frontend/components/mapSim.tsx) (`useSimEditor`, wired into
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

### SAGE planner + assist layer (2026-10-09)

**SAGE** is the paper's planner ("SAGE: Symbolic Action-Gating and Editing", code identifier GRACE:
`pyplanner.GRACEPlanner`, GRACE-Fixed settings). Agent panel → **SAGE + assist** (`planner: 'sage'` on
`/ws/agent`, or `ROBOT_AGENT_PLANNER=sage`) runs [core/planning/assist_loop.py](../robot_agent/robot_agent/core/planning/assist_loop.py)
(`AssistLoop`) around it; **SAGE (plain loop)** (`'grace'`) is the original `ClosedLoop`. Every plan and every
change of plan comes from SAGE — the assist layer never adds, drops or reorders steps:

1. **Understand** (one LLM JSON call on the translated *and* the original words): goals
   `{type: on|in|open|close, object, from, to}`, or `unsafe` / `infeasible` → `done{status:'refused'}`.
   Places are grounded on the live ENV without the LLM; a place word naming several places (`shelf`), a key the
   user never said (`test table` for 식탁 → "table"), or `me` without a place → a question through the `ask`
   skill; answers are read back. Object memory is *not* in the prompt (a 7B model refused / asked about every
   object it did not list).
2. **Plan**: SAGE `generate_plan`; the checker `_check` simulates the plan as written and reports violations
   (not a listed place, Pick without Find, Open with a full hand, goals not reached, the task repeated after
   the goals are done …). Critical findings go to **SAGE's own sub-goal Editing** (`GRACEPlanner._refine` on
   the offending sub-goal block, `_sage_edit`, `edit_rounds` 3); a block the earlier blocks already achieved is
   asked for no steps. Offline (`kcare-sim/scripts/bench_plan.py`, 13 tasks, qwen3-vl:8b): valid plans 5/13 as
   generated → 9–10/13 after SAGE's edits (`replan`-based editing did not help: it keeps the future sub-goals).
3. **Guard each step** (table below). Anything that needs another plan — object not here, robot at the wrong
   place, a precondition, Place failed, plan ended short of the goals — goes to SAGE's suffix repair
   (`replan`, E / R / S reason, `max_replans` 6). The run ends as soon as the goals hold.
4. **Done** only when the goals hold in the belief state.

**Per-step recovery (2026-10-09, tested with injected faults — `kcare-sim/scripts/task_runner.py --faults`,
bridge `/sim/command {cmd: fault, set: {nav_fail | nav_offset | no_grasp | slip | drop_on_move}}`):**

| Step | Fault | Caught by | Policy |
|---|---|---|---|
| ask (STT) | silence | empty answer | ask again once ("Sorry, I didn't hear you") |
| | garbled ("shell in the rest room") / other language | grounding finds no place | ask again; ENV `aliases` (화장실 선반) ground directly |
| | misheard but valid ("kitchen" for "restroom") | — | **read-back** after any answer: "I will … Is that right?"; "no, …" corrects (latest answer wins) |
| command | misheard ("beach bottle") | — | `options.confirm_task` reads every task back (voice users) |
| MoveTo | nav gives up / stops off the spot — kcare `move` still says done | base > `arrive_tol` 0.3 m from the ENV loc | retry once → ask "is something in the way? say yes" → retry → stop |
| Find | object moved / absent | not found | SAGE replans where to look (searched places in its observation) → after 3 misses "where is it?" → stop |
| | false detection (absent object "found" 48/82 at min_conf 0) | `find_min_conf` 0.55 | detections below are not seen; VLM crop check (`find_verify`) not worth it in sim |
| | seen > 1 m away | find's pose_3d | Find counts as failed ("seen near X, out of reach") → SAGE replan |
| Pick | misses / slips while lifting | `grasp_succeed` again after the arm folds | re-Find + Pick once (not when > 0.78 m sideways) → ask to move it to the edge (an answer naming a place sends the robot there) |
| | failed but something is in the gripper | `grasp_succeed` | stop: "please take it from me" |
| carry | dropped on the way | `grasp_succeed` before Place | stop, say where (no floor pick) |
| Place | check says "still in the gripper" | second `grasp_succeed` | empty → success; still held → replan once → stop |
| | rolls off after the release | **not caught** (place = gripper empty, by decision) | known gap |
| any | skill bug (`unexpected keyword …`) / same failure twice | message | stop, no replan |

A location-bound step (Place / PutIn / Open / Close) with the robot elsewhere is a precondition failure → SAGE
replan. Questions and failure messages are spoken in the run's `lang` (LLM-translated). Per-run overrides:
`/ws/agent {…, options: {confirm_task, confirm_answers, find_min_conf, find_verify, arrive_tol, …}}`
(`ASSIST_OPTIONS`). Ollama keeps one model resident on the shared A6000s: alternating qwen2.5:7b (planner) and
qwen3-vl (QA / verify), or a different `num_ctx`, reloads it (~20–30 s per call instead of 0.3 s).

kcare: `placeat`, `placep`, `approach`, `approach_close(f)` and the card skills that used them (`pick_card`,
`collect_card`, `return_card`, `pick_no_sound`) are removed (`approach.py`, `_approach_helpers.py` deleted);
`grace_namemap` Place / PutIn → `place`. `find::verify=True` asks the QA VLM about each detection's crop.
Sim results (16 NL tasks, `kcare-sim/scripts/task_runner.py`, truth-graded): SAGE 9 / 8 / 6 of 16 over three
runs, GRACE 2 / 16 (39 replans). Remaining failures are skill-level: pick reach / IK, place IK on far spots, and
`find` accepting any detection (`min_conf` 0: 35 / 60 finds of absent objects "found").

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
