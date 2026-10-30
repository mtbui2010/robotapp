# Changelog

History of the dashboard and of the backend behaviour it depends on. Until 2026-10-30 this history lived inline
in `CLAUDE.md`, mixed with the specs. The full text of each entry is still in the feature doc it belongs to
(`docs/features/`, moved verbatim); this file is the dated index. New entries go at the top: date, feature, one
line, link. Undated features (Cancel / Stop, camera streaming, Robot State, plan skills, skill and location
aliases, planner guides) predate the dated notes; see their docs.

## 2026-10-30

- Robot State: per-field provenance (sensor with age / operator / belief / unknown), unconfirmed containers, and a
  note that edits are beliefs the robot re-checks. [features/robot-state.md](features/robot-state.md)
- Repo rules: `CLAUDE.md` now holds rules only. Specs moved to [docs/features/](features/README.md), history
  indexed here. `make lint`, `make typecheck`, `make smoke`, `make ci` added.
  [backend_coupling.md](backend_coupling.md) lists the robot data the UI bundles, the hand-written types and
  the UI workarounds for backend bugs.

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
