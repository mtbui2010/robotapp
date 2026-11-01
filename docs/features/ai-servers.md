# AI servers: vlms / visions / voices, with fallback (2026-10-16)

<!-- Moved verbatim from CLAUDE.md (lines 666-711) on 2026-10-30; links rebased to docs/features/. -->

When the 3090 is full a server fails (Whisper OOM) or slips to the CPU (Ollama puts part of the model in RAM). The
AI connections are now three types, each one **role** served by an **ordered list of servers**
([robot_agent/connect/pool.py](../../../robot_agent/robot_agent/connect/pool.py)):

| type | id (kept, so skills did not change) | servers |
|---|---|---|
| `vlms` | `vlm` — qa, find verify, and the planner when active | `provider` ollama / openai / gemini / anthropic, `url` (Ollama), `model`, `num_ctx` |
| `visions` | `visionserve` — find / find_grasp / products | `url` |
| `voices` | `whisper` — reply / ask / qa (`dm.stt_client()`) | `url`, `model` (a smaller Whisper on the same server needs less GPU), `api_key_env` (`WHISPER_API_KEY`, for a server behind a public tunnel) |

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
  ([components/ServerListEditor.tsx](../../frontend/components/ServerListEditor.tsx)) edits the servers: provider,
  url, model, num_ctx, slow after, on/off, ▲▼ to reorder, ×, + server, the cloud key.
- `pool.tidy_connections(items)` (pure) merges a site's AI connections into one per kind (vlm / visionserve /
  whisper, servers deduplicated, the existing id's servers first). Preview script:
  `kaair_real_capture/server_pool_20261016/tidy_preview.py <site>…`. Test against the real servers (a dead
  first server, a cloud server without a key → the dev PC answers; nothing moves):
  `kaair_real_capture/server_pool_20261016/test_pool.py`.
- Installing a backup Whisper server (speaches on the A6000, optional Cloudflare tunnel) and adding it to the
  Voices list: [WHISPER_SERVER.md](../../WHISPER_SERVER.md).
