# Visual Q&A (`qa` skill + top-bar button)

<!-- Moved verbatim from CLAUDE.md (lines 385-665) on 2026-10-30; links rebased to docs/features/. -->

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
blocked on. The skill (`qa` in [kcare_robot/skills/hri.py](../../../kcare_robot/kcare_robot/skills/hri.py),
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
([lib/hriVoice.ts](../../frontend/lib/hriVoice.ts), a throw-away `getUserMedia`)
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
only **records** (`recordPhrase` in [lib/hriVoice.ts](../../frontend/lib/hriVoice.ts):
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
event carries `earcon` (volume, 0 = off) and `page.tsx` plays `playEarcon` ([lib/hriVoice.ts](../../frontend/lib/hriVoice.ts),
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
**Q&A card** ([components/QaChat.tsx](../../frontend/components/QaChat.tsx)) instead of
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
