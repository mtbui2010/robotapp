---
sources:
  - frontend/lib/api.ts
  - frontend/lib/tabPref.ts
  - frontend/lib/planner.ts
  - frontend/lib/recordAudio.ts
  - frontend/lib/recordNote.ts
  - frontend/lib/recorder.ts
  - frontend/lib/useScreenRecorder.ts
  - frontend/lib/buttonGroups.ts
  - frontend/components/AgentPanel.tsx
  - frontend/components/ButtonPanel.tsx
  - frontend/components/CameraFeed.tsx
  - frontend/components/RecorderBar.tsx
  - frontend/app/page.tsx
verified_at: 4a810a3717ab
---

# Browser storage

!!! abstract "In this page"
    Every key the dashboard keeps in `localStorage`, `sessionStorage` and IndexedDB, its value, its default and the file that owns it, plus the three window events. Found by searching `app/`, `components/` and `lib/` at commit `4a810a3717ab`, then reading each use. The dashboard keeps no robot data in the browser: robot data lives on the backend (see [Backend coupling](backend-coupling.md)).

All writes are wrapped in `try`/`catch`: with no storage (private mode, blocked) the dashboard still works and forgets its choices. Every read happens after mount, because the page is a [static export](glossary.md#static-export) and has no `window` while it is built.

## Per-tab keys

`localStorage` is shared by all tabs of a browser. Four keys are therefore kept per tab in `sessionStorage` and copied to `localStorage` only as the default of a tab opened later. The rule is in `lib/tabPref.ts`:

| Function | What it does |
|---|---|
| `readTabPref(key, legacyKey?)` | this tab's `sessionStorage` value, else `localStorage`, else the legacy key in `localStorage` |
| `pinTabPref(key, value)` | if this tab has no value yet, store the one it started with, so a reload does not take another tab's later choice |
| `writeTabPref(key, value)` | write both: this tab, and the default for the next new tab |

The robot choice works the same way in `lib/api.ts:55-77` (it does not use `tabPref.ts`). This is why two tabs can drive two robots; see [the two-tabs guide](../guides/two-tabs.md).

| Key | Value | Default | Owner |
|---|---|---|---|
| `robotapp_active_robot` | name of the robot this tab talks to (also in `localStorage`: the default of a new tab) | none; the first robot added becomes active | `lib/api.ts:22`, `55-77` |
| `robotapp_planner` | `sage`, `grace` or `direct` | `sage` | `lib/planner.ts:5-8`, `17-19` |
| `robotapp_plan_only` | `1` plan only, `0` the robot moves | `1` | `lib/planner.ts:10-14` |
| `robotapp_lang` | a language code of the robot's list | the robot's own default language; legacy key `robotapp_qa_lang` is read as a fallback | `app/page.tsx:720-726` |

## `localStorage` keys

| Key | Value | Default | Owner |
|---|---|---|---|
| `robotapp_robots` | JSON `[{name, url}, ...]`, the robot list | `[]` | `lib/api.ts:21`, `25-49` |
| `agent_url` | legacy single URL; read once when `robotapp_robots` is empty: it becomes a robot named `default` and the active robot. It is not deleted. | none | `lib/api.ts:23`, `35-42` |
| `robotapp_cells` | JSON array of 4 strings, the text of the Structured plan cells | `["","","",""]` | `components/AgentPanel.tsx:9`, `145-148` |
| `robotapp_log_data` | `1` or `0`: save run data | on (anything except `0`) | `AgentPanel.tsx:10`, `185`; `app/page.tsx:777` |
| `robotapp_log_target` | `frontend` or `backend` | `frontend` | `AgentPanel.tsx:11`, `186-187`; `app/page.tsx:778` |
| `robotapp_log_all` | `1` every run, `0` failed runs only | `0` | `AgentPanel.tsx:12`, `188`; `app/page.tsx:779` |
| `robotapp_repeat_mode` | `once`, `n` or `forever` | `once` | `AgentPanel.tsx:13`, `189-190` |
| `robotapp_repeat_n` | integer of 1 or more | `2` | `AgentPanel.tsx:14`, `191-192` |
| `robotapp_repeat_continue_on_error` | `1` or `0` | `0` | `AgentPanel.tsx:15`, `193` |
| `robotapp_presets_structured` | JSON `[{name, text}]`, saved Structured presets | `[]` | `AgentPanel.tsx:16`, `20-26` |
| `robotapp_button_group` | id of the open shortcut-button group; `-` means none open | the first group with buttons | `ButtonPanel.tsx:6`, `99-106`; `lib/buttonGroups.ts:8`, `25-28` |
| `robotapp_buttons` | legacy: buttons used to live here; pushed once to the backend when the backend has none, then deleted | none | `ButtonPanel.tsx:10`, `29`, `77` |
| `robotapp_buttons_migrated` | `1` set before the one-time push; removed again if the push fails, so the next load retries | none | `ButtonPanel.tsx:11`, `63-80` |
| `cameraTabOrder` | JSON array of camera ids, the drag-and-drop order of the camera tabs (the only key without the `robotapp_` prefix) | `[]` | `components/CameraFeed.tsx:17`, `66-87` |
| `robotapp_webcam_device` | the chosen webcam device id | none | `CameraFeed.tsx:18`, `119-122`, `259` |
| `robotapp_data_tools` | `1` shows Remote control and Record | `0` (hidden) | `app/page.tsx:78-79` |
| `robotapp_rec_rows` | JSON `{rows, inits, before, active}`: the prompt fields of 2 rows, the Go-to pose of each, and the active row | 2 empty rows | `components/RecorderBar.tsx:7`; `lib/recorder.ts:68-88` |
| `robotapp_rec_fields` | legacy: the fields of one row, read when `robotapp_rec_rows` is empty | none | `RecorderBar.tsx:7` |
| `robotapp_record_tab_audio` | `1` or `0`: record the tab's sound in a screen recording | `1` | `lib/recordAudio.ts:21`, `35` |
| `robotapp_record_mic` | `1` or `0`: add the microphone | `0` | `lib/recordAudio.ts:22`, `35` |
| `robotapp_record_audio_source_v2` | `system`, `direct` or `tab` | `system` on Windows and ChromeOS, else `direct` | `lib/recordAudio.ts:23-36` |

Keys are plain strings: a typo creates a new key, there is no central list in the code.

## IndexedDB

| Database | Store | Key | Value | Owner |
|---|---|---|---|---|
| `robotapp` (version 1) | `fs` | `kcareDir` | a folder handle (`FileSystemDirectoryHandle`) for screen recordings | `lib/useScreenRecorder.ts:15-45` |

The code only reads this handle, and only uses it if the browser still reports permission `granted`. It never opens a folder picker: the handle can exist only if an earlier build of the dashboard stored it (comment at `useScreenRecorder.ts:36-37`). With no handle, recordings go to the browser's Downloads folder.

## Window events

These events stay inside one tab. They are not storage events: another tab does not hear them.

| Event | Type, detail | Sent by | Heard by |
|---|---|---|---|
| `robotapp:robot-changed` (`ROBOT_CHANGED_EVENT`) | `Event` | `setActiveRobot` (`lib/api.ts:70-77`) | `usePoses`, `useRobotLanguages`, `useRecorder`, `useTeleop`: each reloads what it read from the old robot |
| `robotapp-planner` (`PLANNER_EVENT`) | `CustomEvent`, detail is the planner | `app/page.tsx:743` | `components/PlannerPromptPanel.tsx:24-25` |
| `robotapp:record-audio-note` (`NOTE_EVENT`) | `CustomEvent`, detail is a message | `lib/recordNote.ts:7` | `components/RecordAudioToggles.tsx:28-29` |

Note the two spellings: `robotapp:` with a colon, and `robotapp-planner` with a hyphen.

## Failure modes

| What you see | Why | What to do |
|---|---|---|
| The dashboard forgets all choices on reload | storage is blocked or cleared | allow site data for the page |
| The first robot list is empty after an upgrade | `robotapp_robots` is missing | `agent_url`, if present, is converted once; otherwise add a robot in the Devices panel |
| A new tab starts with the planner another tab chose last | the default of a new tab is the last `localStorage` write | set it again in the new tab; that tab keeps it (it does not change other tabs) |
| Clearing site data does not remove the folder handle | IndexedDB is a separate store | clear it in the browser's site settings |
