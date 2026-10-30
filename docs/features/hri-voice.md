# HRI voice (dashboard mic)

<!-- Moved verbatim from CLAUDE.md (lines 336-384) on 2026-10-30; links rebased to docs/features/. -->

kcare's `reply` / `ask` skills (`kcare_robot/skills/hri.py`) talk and listen
either on the robot (`source='robot'`: gTTS + robot mic + `vlms` Whisper) or
through this browser (`source='dashboard'`). In dashboard mode the skill emits
agent-WebSocket events: `speak` (always voiced, unlike the gated `say`) and
`listen: {id, lang, max_sec, prompt}`. `page.tsx` queues them in order —
speak to completion, then `recognizeOnce` ([frontend/lib/hriVoice.ts](../../frontend/lib/hriVoice.ts))
— and posts `{text, error}` to `POST /agent/listen/<id>` (`api.answerListen`).
Only runs started from the Agent panel have this channel; `/skill/<name>` and
the CLI must use `source='robot'`.

**Picking the mic.** Nothing in this frontend ever sends `source`, so it has to
be typed into the plan input — and the plan parser is **not** the CLI parser.
Check `_common` in [hri.py](../../../kcare_robot/kcare_robot/skills/hri.py) for the
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
([core/planning/announcer.py](../../../robot_agent/robot_agent/core/planning/announcer.py))
makes `step_start` / `step_success` / `step_fail` return `''` for those skills.
The milestone narrator runs on its own queue, separate from the HRI
speak/listen queue, so without this it talks over the skill's question — and
with the browser mic already open, the browser transcribes that narration as if
the user had said it. An empty `say` is falsy, so the dashboard skips it and
`Announcer.announce` never reaches the robot speaker either.

That alone is not enough: `plan_ready` (and anything else narrated *before* the
HRI step) carries no action, so it still plays — and it is spoken right as the
mic opens. [page.tsx](../../frontend/app/page.tsx) therefore also gates the narrator
on the HRI queue: `enqueueHri` keeps a `hriPending` counter, `speak(ev.say)`
only runs at `hriPending === 0`, and each HRI job calls `silenceNarration()`
(`speechSynthesis.cancel()`) before speaking, cutting a phrase that started
earlier. This also fixes the reverse damage — `useVoiceOutput.speak` cancels
in-flight speech by design ("newest milestone wins"), which used to truncate the
skill's own question mid-sentence.
