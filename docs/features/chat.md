# Chat (2026-11-12)

The top-bar **💬 Chat** button (second column, next to Cancel and the KO / EN picker) opens ONE chat card
([components/ChatPanel.tsx](../../frontend/components/ChatPanel.tsx)): a general two-way conversation with task
planning. It replaces the Unstructured prompt of the Agent panel (command box, "from mic", "Auto-run after voice",
command presets) and the old Q&A button, which started a `qa` run. `qa` is now an ordinary skill: add it as a step
in the Structured editor if you want the visual Q&A ([visual-qa.md](visual-qa.md)). The Structured mode (step
editor, plan presets, repeat, log options) is unchanged.

## States

| State | Meaning | Typed box | A message is |
|---|---|---|---|
| idle | no run | enabled | a NEW RUN of that text: unstructured command, `run(text, direct=false, lang, planner, planOnly, …)` on `/ws/agent` |
| waiting | the robot asked: a `listen` event is pending (text, whisper or browser mic) | enabled (voice mode too) | the ANSWER: `POST /agent/listen/<id>` (`api.answerListen`); it also ends the capture in progress (recording, recogniser, typed wait) |
| running | executing, nothing asked | disabled, hint "robot is working…" | not accepted |
| stopping | Stop pressed, waiting for the backend | disabled | not accepted; see [Stop and Reset](#stop-and-reset) |

A one-line status under the log says which: "idle: type or say a task", "working…", "waiting for your answer
(speak or type)". `chatState(running, listenPending)` in [lib/chatMic.ts](../../frontend/lib/chatMic.ts).
**The card opens only when you click 💬 Chat** (or you send from it) and is used only for runs started from the chat.
A Structured run (e.g. a plan with `ask::` / `qa::`, or any step that speaks or listens) never opens it. When such a
run waits for a typed answer (text-mode `listen`) and the card is closed, the Chat button turns amber, pulses and
shows "●" ("the robot is waiting for your answer"); click it to answer. Voice / Whisper listens of Structured runs
work as before.

**Header.** Planner (SAGE + assist by default | SAGE plain loop | Direct; the same `robotapp_planner` key, so the
Planner prompt panel follows), language KO / EN (the page's ONE language setting, `robotapp_lang`, shared with the control bar's picker and the
Structured runs; a fresh browser profile starts in **KO**, a stored choice is kept), the **plan
only** switch (`robotapp_plan_only`, default ON; amber when on, red "will move" when off: with it off the next
command moves the robot), **■ Stop** (`api.cancelRun`, same path as Cancel) and **?**, whose tooltip, like the
footnote, says that two clients driving one robot is unsafe and that Cancel stops both (rule 7). Planner, language
and plan-only change only while idle.

**Log.** Bubbles: your messages (right), the robot's `speak` lines, listen prompts and clarify questions (left),
and the `say` lines of each step (small grey italics), all shown with 🔊 voice off too (`addQaLine` in `page.tsx`;
identical consecutive robot lines are shown once). A grey line closes each run (✓ done / ✓ planned / ✗ failed).
`clear` empties it; × hides the card (the run goes on).

## Voice: one mic owner, half duplex

The 🎤 button is a **hands-free** toggle (off by default; the click asks for the mic with echo cancellation and
noise suppression on, `primeMic`). Rules ([lib/chatMic.ts](../../frontend/lib/chatMic.ts), loop in
[lib/useHandsFree.ts](../../frontend/lib/useHandsFree.ts)):

- Hands-free listens for a new command only while **idle**, the robot is **not speaking** (`speechSynthesis`
  speaking / pending, the HRI queue `hriPending`, plus an estimate for a line the robot's own speaker says) and
  `GUARD_MS` = 1 s has passed since it stopped. It is a loop of one-shot `recognizeOnce` calls; the continuous
  recogniser of the old "from mic" is gone. It aborts the recognition the moment that stops being true.
- During a run, and while the robot waits for an answer, the run's own capture in `page.tsx`'s `listen` handler
  (typed / whisper `recordPhrase` / `recognizeOnce`) is the only mic user. Nothing is ever written into the input
  box from the mic, and a hands-free transcript that arrives after the state changed is dropped.
- **Echo guard:** a transcript that is very similar (character-bigram Dice ≥ 0.6, or a piece of one) to a line the
  robot said in the last 10 s is dropped (hands-free and the browser-recogniser answer). It is cheap, not perfect.
- A typed answer while the mic is recording ends the recording (`stopRecording` / `abortRecognition`) and the
  typed text stands.

Limits: the recogniser is the browser's (Chrome needs the network; Korean worked poorly with it, see
[whisper](hri-voice.md)); a robot speaker the dashboard cannot see ends only by estimate; use headphones or a
quiet room for real runs. Not tested with a real mic and speakers (see the CHANGELOG line).

## Language per tab
The language belongs to the tab (the picker lists the robot's languages from its manifest, `GET /robot/languages`; a tab whose choice the robot does not talk in, e.g. after switching robot, falls back to the robot's default `language`): it is kept in `sessionStorage` and survives a reload of that tab; `localStorage` holds only the
last choice made in any tab, used by a tab that has none yet (a new tab). Picking EN in one tab no longer changes another tab.
The planner and "plan only" work the same way. A tab that has not chosen yet **pins** what it started with (`pinTabPref`), so a reload
never picks up another tab's choice (un-checking "plan only" in one tab cannot make another tab's robot move after a reload).

## Plan panel (left column, "Task plan & execution")

The **Plan progress** list ([components/PlanList.tsx](../../frontend/components/PlanList.tsx), reducer
[lib/planView.ts](../../frontend/lib/planView.ts), tested on recorded event files) follows the whole run, like the
right-hand panel of the demo videos:

- `plan` lists the steps (○ pending); `step_start` marks one **▶ running**; `step_done` ticks it ✓ (greyed) or ✗
  with its reason. The understood goals (`understand`), the asked question (`clarify`, "? asked …") and the goal
  checks and verdict (`done`: ✓ Succeeded / ✓ Planned / ✗ Failed + message) are shown too.
- `replan` replaces the not-yet-run part with the new plan and puts a note ("↻ replanned" + the event's reason,
  full text in the tooltip) between the history and the new steps; done and failed steps stay above, in order.
- `recover` (search_leg, second_look, retry, relook, asked, phantom) splices steps in place. The backend reuses
  `index` after a splice, so rows are matched by order, never by index: after a `recover`, steps that start and are
  not in the list are rows marked "↳" (spliced, with a "↳ recovery" note) and do not consume the list, until the
  step that failed starts again ("↻", its retry).
- Stop or a closed socket without a `done` closes the view as "■ Stopped" (running → ✗, the rest –).
- A new run starts a new list (the chat log keeps the conversation).
- A Structured run (legacy events) sends the plan as text lines (`say::inputs='hi'`) but `step_start` as a Python list
  (`[['say', "inputs='hi'"]]`); the labels never match, so a started step takes the next pending line **by order** (and keeps the
  plan line as its label). Without this every step added a second row (a 4-line plan showed "4/8 done").

The separate "Plan" text block is removed. There is ONE list of steps, **Plan progress**, and the old Execution panel is now
the **Log** panel (order in the column: Robot State, Plan progress, planner steps / GRACE trace, Log):

- **Plan progress** shows each step the way the Log used to: status mark (⟳ spinner for the running step, ✓, ✗, ○ pending,
  – skipped), `Step i/N: <label>` (SAGE: `MoveTo counter@kitchen`; Structured: the plan line), the duration `(2.2s)` and the
  failure reason in red. No logs and no result JSON. Limited height with mouse scroll; a **now** line shows the step being
  run and the list scrolls to it by itself.
- **Durations.** `page.tsx` stamps every event it receives with `_rx` (client time, ms; the backend never sends it and the
  recorded fixtures do not have it). `planView` copies it to `startedAt` (step_start) and `endedAt` (step_done, or the run's
  end / Stop for the running row); a duration is shown only when both are known.
- A task in Plan progress is at most 2 lines (longer: "…"); a ⤢ button appears on a clipped row to read it whole (⤡ collapses),
  the tooltip and the Log hold the full text. The expand button does not select the step; a click on the row does.
- **Log — step i of N** shows only the LOG (msg / result lines, expand / copy; empty `{}` lines hidden) of ONE step, without the
  step's own title (Plan progress has it) — kept below: the detail (logs, result JSON, expand / copy) of ONE step: the step being run, else the last one;
  it follows the run (the step that starts next replaces it). Clicking a Plan progress row shows that step instead, with a
  "↺ current" link to go back; the next step that starts goes back to following the current one. Limited height with mouse
  scroll, and the Done badge.
- Robot State and the GRACE trace are unchanged; the Log steps also work for SAGE events (`index` / `action` / `object`
  instead of `step` / `total` / `task`).

## Stop and Reset

State machine: [lib/chatRun.ts](../../frontend/lib/chatRun.ts) (`runReduce`, tested in `make unit`); `page.tsx` feeds it.

| State | Typed box | Stop | Meaning |
|---|---|---|---|
| idle | on | off (on while `alive`, see below) | no run |
| running | off | on | executing |
| waiting | on | on | the robot asked |
| stopping | off | "■ Stopping…" | cancel sent; waiting for the backend `done` / `error`, or the socket closing |

Events: start, listen, answered, stop, cancel-ack, done, ws-close, timeout, reset. `done` ends stopping. A socket close ends it too
(the backend cancels on disconnect). Stopping for `STOP_TIMEOUT_MS` = 5 s sets `stuck`: the status row shows **Force reset**.
`alive` means "a run may still be going on the backend": set at start, cleared only by `done`, a confirmed stop or a reset. A
socket that drops mid-run leaves the chat idle but `alive`: the status says "connection to the run lost", Stop stays enabled (it
sends cancel; with no socket the acknowledged cancel ends it) and a new task can still be typed.

- **■ Stop** (also the Cancel buttons and the Agent panel's Stop): sends `POST /agent/cancel`, ends every capture at once (typed wait,
  mic recording, recogniser, speech, on-screen choice), ignores late `speak` / `listen` events of that run, and WAITS for the backend's
  `done`. The socket stays open to see it. Pressed again while stuck, it is a Force reset.
- **reset** (header, next to clear; also Force reset): always works, whatever the backend does. Sends cancel (best effort), detaches and
  closes the run's socket, drops the pending listen (`textAskRef`, listen id), aborts recording / recognition, cancels speech, starts a
  new HRI epoch (queued speak / listen jobs of the old run are dropped, the pending counter is zeroed), clears the plan view and
  events, and sets the chat idle with the input enabled. The log is kept (a grey "■ reset" line is added; `clear` is separate).
  The 🎤 toggle keeps the user's setting; the hands-free loop reads the live state, so it listens again at once for a new command.
- Speech recognition errors are visible: when the audio answer POST fails (server unreachable, HTTP 5xx such as the speech server
  out of GPU memory) the chat shows "⚠ speech recognition failed (HTTP 500: …): type your answer" and keeps the question open for a
  typed answer (`api.answerListenAudio` returns `{text, error?, gone?}`; before, any failure was read as "no speech" and the
  question was closed on this side while the backend kept waiting up to its timeout: the chat said "working…" with the input
  disabled, which looked like a hung run). A browser mic that cannot be used shows "⚠ microphone not available (…)".
- Fixed on the way: a socket error / close with a repeat controller active left `running` true forever (only Stop got out), a
  newer `listen` now supersedes a typed wait that nobody can answer any more, and the old socket's close event can no longer end a
  new run.

Tests: `make unit` (state machine, `answerListenAudio`); Playwright with the fake mic against kcare_sim (symbolic mode): Stop
while asked, Stop while executing, Stop twice, cancel that never answers (stopping, then Force reset, then a new command works),
socket closed mid-run, audio answer 500, Reset with hands-free ON. Not tested: a real backend stuck in an LLM call, a real mic.

## Typed answers when the chat mic is off

For a run **started from the chat**, `answerBy` ([lib/chatMic.ts](../../frontend/lib/chatMic.ts)) decides how a `listen` is
answered: with the 🎤 toggle OFF always by typing, even when the backend asks in voice / whisper mode. `page.tsx`'s `listen`
handler then does not record and does not post an empty answer; it waits for the typed text (the same path as
`mode: 'text'`, `api.answerListen` with the text) with no timeout of its own, the backend decides when to give up. The input
shows "type your answer". With the mic ON the backend's mode is kept (record / recognise) and a typed answer still wins and
ends the recording. A Structured run keeps the backend's mode. (Before this, a voice-mode backend made the page record at
once; with no mic input an empty answer was posted and the robot said "didn't hear you", and the typed text counted only in
the second round.)

## Tests

Browser check (Playwright, not in CI): a fresh profile starts in KO, the chat select and the control bar stay in
step, a Structured `ask::` run leaves the card closed and pulses the button.

`make unit` ([scripts/test_lib.mjs](../../scripts/test_lib.mjs), part of `make ci`): planView replayed at every
prefix of 7 recorded runs (+ durations / `seq` with `_rx`) ([scripts/fixtures/events](../../scripts/fixtures/events): replan + search legs, failures,
retry / relook / asked, second look) and chatMic (no listening while running / speaking / waiting, guard time, echo
guard, `answerBy`).

## Detect (language `auto`, 2026-11-14)
The picker (`components/LanguagePicker.tsx`, in the control bar and the chat header) always offers **Detect** first, however many languages the
manifest names (none: then it is the only option). Detect is the default of a tab that has not chosen; picking KO (or any language) makes
that the default for the next tab (`robotapp_lang`, see above). The run is sent with `lang: 'auto'`: the robot starts in its default
language and, per turn, goes on in the language the user was heard in (backend: robot_agent `lang 'auto'`, hri `_adopt_language`; only among
the robot's languages, only when the phrase is long enough to be sure; qa / ask / reply, not the emergency exchange, not typed chat).
The picker shows `Detect · EN` once a language was heard (`step_log` `data.lang_detected`). Until then, and for the browser's own
voice and mic, Detect means the robot's default language, then the language heard (`speechLanguage`).

**Add / delete languages.** The popover lists Detect and the robot's languages: × deletes one from the list, the box adds a code (2-3
letters: `ko`, `en`, `ja`…), "Reset to the robot's list" undoes both. The edits are per robot name and live in this browser
(`robotapp_lang_edits:<robot>`); they change what the picker offers, not what the robot can speak (a language the skills have no phrases
for is never taken from detection).
