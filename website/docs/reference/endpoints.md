---
sources:
  - frontend/lib/api.ts
  - frontend/lib/generated/openapi.json
  - frontend/lib/types.ts
  - scripts/lint.mjs
verified_at: 4a810a3717ab
---

# Endpoints

!!! abstract "In this page"
    Every URL that `lib/api.ts` builds at commit `4a810a3717ab`: 77 rows, with the HTTP method, the path, the `api.` function and its line, the panels that call it, whether the committed `openapi.json` types the answer, and what the function does when the reply is not 2xx. The table was produced by a script over the committed text, not copied from older notes.

The dashboard talks to one server, the [robot_agent](glossary.md#robot-agent) of the active robot. All 77 URLs start with `${getAgentUrl()}` (HTTP) or `${getWsBase()}` (WebSocket). Nothing else in the code base should call `fetch` or open a WebSocket: `make lint` (`scripts/lint.mjs`) reports an error if a file other than `lib/api.ts` does, unless the URL comes from an `api.` helper (rule 2).

## The counts

| What | Number | How it was counted |
|---|---|---|
| URLs built in `lib/api.ts` | 77 | the same pattern as `scripts/lint.mjs:51`: `${getAgentUrl()}/...` or `${getWsBase()}/...` |
| of them WebSocket | 2 | `/ws/agent`, `/ws/camera/{clientId}` (OpenAPI does not list WebSocket routes) |
| of them HTTP | 75 | 75 different method and path pairs, no pair is built twice |
| paths in `openapi.json` | 66 | `info.title` is `robot_agent`, `info.version` is `0.1.0`, OpenAPI 3.1.0 |
| operations (path and method) in `openapi.json` | 85 | the 75 HTTP URLs above, plus 10 the dashboard never calls |
| OpenAPI paths the dashboard calls | 56 | every HTTP URL maps to an existing path and method |
| operations whose 200 reply names a schema (`$ref`) | 48 | of the 85: 46 reply with one named schema, `GET /skills` with a list of `SkillInfo`, `GET /skills/status` with a map of `SkillStatus` |
| operations with a generic reply (a dict, no named fields) | 3 | `GET /agent/api-keys`, `GET /agent/llm-config`, `GET /skill-configs` |
| operations with an empty reply schema (`{}`) | 34 | of the 85 |
| operations with a reply schema that is not empty | 51 | 48 + 3 |

Among the 75 HTTP URLs of the dashboard: 40 have a named schema (38 direct, plus the two list and map replies), 3 a generic one, 32 none.

The 10 operations the dashboard does not call are `GET /diagnostics`, `GET /diagnostics/boot`, and the run-control routes `GET /runs`, `GET /runs/{run_id}`, `GET /runs/{run_id}/metrics`, `GET /runs/{run_id}/record`, `POST /runs/{run_id}/cancel`, `/inject`, `/pause` and `/resume`.

!!! note
    Older notes in the repo give other counts (38 paths, "all 50 exist"). They are out of date. The numbers above are those of the committed file. The count of typed replies (47 of 85: the 200 or 201 reply is a named schema or an array of named schemas; other tests give 46, 48 or 51) is the one used in [Generated contract](../modules/generated-contract.md).

## What "typed" means here

The column "OpenAPI answer" reads the `200` response of the operation in `frontend/lib/generated/openapi.json`.

| Value | Meaning |
|---|---|
| a name such as `Ok` | the answer is a named schema; the backend declares its fields |
| `SkillInfo[]`, map of `SkillStatus` | a list or map whose items are a named schema (these two rows are shown as "generic" below) |
| generic | the schema says only "a dict"; no field names |
| none (`{}`) | the backend declares no response model: the answer can be anything |
| WebSocket | not in OpenAPI |

This is a statement about the backend's contract, not about the dashboard. The dashboard's own types are written by hand in `lib/types.ts` and in the `lib/*.ts` helpers: no `openapi.d.ts` exists at this commit, and `make gen-types` only refreshes `openapi.json` (see [Make targets](make-targets.md)). So a "named" schema does not make a call type-checked on the dashboard side. The `lib/api.ts` function return types are written by the dashboard authors.

The lint compares paths only. It does not check the method, and it turns the placeholders `{cid}`, `{connect_id}` and `{path}` into a pattern that also matches a longer path (`scripts/lint.mjs:45-47`). The table here checks the method as well: all 75 method and path pairs exist in `openapi.json`.

## The table

Columns: `Line` is the line of the URL in `lib/api.ts`. "Used by" lists the files outside `lib/api.ts` that call the function as `api.<name>`; names without a folder are `components/`. "On a non-2xx reply" is what the function does:

| Word | Meaning |
|---|---|
| throws | an `Error` with the backend's `detail` text, or `HTTP <status>` |
| returns an empty value | the function swallows the failure and returns `[]`, `{}` or `null` |
| not checked | the status is not read; the body is parsed as JSON and may throw if it is not JSON |

| Method | Path | Function | Line | Used by | OpenAPI answer | On a non-2xx reply |
|---|---|---|---|---|---|---|
| POST | `/map/snapshot` | `mapSnapshot`, `mapPreview` (through `mapPost`) | 164 | `MapPanel` | none (`{}`) | throws |
| GET | `/ros/scan` | `scanRos` | 196 | `DevicePanel` | none (`{}`) | not checked |
| GET | `/connects` | `listClients` | 201 | `DevicePanel` | none (`{}`) | returns `[]` |
| GET | `/connects/status` | `getStatus` | 208 | `DevicePanel` | none (`{}`) | returns `{}` |
| GET | `/connects/servers` | `getServers` | 216 | `DevicePanel` | none (`{}`) | returns `{}` (also on a network error) |
| POST | `/connects` | `addClient` | 223 | `DevicePanel` | none (`{}`) | returns `{id: "", error}` |
| DELETE | `/connects/{id}` | `deleteClient` | 242 | `DevicePanel` | none (`{}`) | not checked |
| PUT | `/connects/{id}` | `updateClient` | 246 | `DevicePanel` | none (`{}`) | returns `{id, error}` |
| POST | `/connects/{id}/set_active` | `setActiveLlm` | 265 | `DevicePanel` | none (`{}`) | not checked |
| GET | `/skills` | `listSkills` | 273 | `DevicePanel`, `SkillPanel`, `EnvLocationsEditor` | `SkillInfo[]` | returns `[]` |
| GET | `/skills/status` | `getSkillsStatus` | 281 | `SkillPanel` | map of `SkillStatus` | returns `{}` (also on a network error) |
| POST | `/skills` | `addSkill` | 288 | `SkillPanel` | `Ok` | throws |
| GET | `/skill-configs/{name}` | `getSkillConfig` | 299 | `app/page`, `EnvPanel`, `MapPanel`, `SkillPanel`, `lib/robotPose` | none (`{}`) | returns `null` (also on a network error) |
| GET | `/skill-configs` | `listSkillConfigNames` | 308 | `EnvPanel` | generic | returns `[]` (also on a network error) |
| PUT | `/skill-configs/{name}` | `updateSkillConfig` | 315 | `mapSim`, `EnvPanel`, `MapPanel`, `SkillPanel` | `Ok` | throws |
| PATCH | `/skill-configs/{name}` | `mergeSkillConfig` | 334 | `EnvPanel`, `MapSettings` | `OkValue` | on 405 falls back to PUT; else throws |
| PUT | `/skills/{name}` | `updateSkill` | 352 | `SkillPanel` | `OkName` | throws |
| DELETE | `/skills/{name}` | `deleteSkill` | 361 | `SkillPanel` | `Ok` | throws |
| POST | `/skills/reload` | `reloadSkills` | 366 | `SkillPanel` | `OkCount` | not checked |
| POST | `/agent/llm-config` | `setLlmConfig` | 371 | no caller | `Ok` | not checked |
| GET | `/agent/llm-config` | `getLlmConfig` | 381 | `PlanPanel` | generic | returns `{}` (also on a network error) |
| POST | `/agent/api-key` | `setApiKey` | 388 | `DevicePanel` | `Ok` | not checked |
| GET | `/agent/api-keys` | `getApiKeys` | 397 | `DevicePanel` | generic | returns `{}` |
| GET | `/agent/world` | `getWorld` | 404 | `PlanPanel` | `WorldStateOut` | throws |
| POST | `/agent/listen/{id}/audio` | `answerListenAudio` | 424 | `app/page` | `OkText` | never throws; returns `{text: "", error}` or `{gone: true}` on 404 |
| POST | `/agent/listen/{id}` | `answerListen` | 442 | `app/page` | `Ok` | not checked |
| POST | `/agent/cancel` | `cancelRun` | 453 | `app/page`, `MapPanel` | `CancelResult` | not checked |
| POST | `/agent/qa/end` | `endQa` | 460 | `app/page` | `QaEndResult` | throws |
| PUT | `/agent/world` | `setWorld` | 469 | `mapSim`, `PlanPanel` | `WorldStateOut` | throws |
| GET | `/tts` | `ttsAudio` | 485 | `lib/recordVoice` | none (`{}`) | throws |
| GET | `/robot/languages` | `getRobotLanguages` | 495 | `lib/robotLanguages`, `lib/useRobotLanguages` | `RobotLanguages` | throws |
| GET | `/teleop` | `getTeleop` | 501 | `lib/teleop`, `lib/useTeleop` | `TeleopList` | throws |
| POST | `/teleop/{name}/enable` | `enableTeleop` | 507 | `RecorderBar`, `TeleopBar` | `Ok` | throws |
| POST | `/teleop/{name}/speed` | `setTeleopSpeed` | 511 | `TeleopBar` | `Ok` | throws |
| GET | `/recorder` | `getRecorder` | 516 | `lib/recorder`, `lib/useRecorder` | `RecorderStatus` | returns null on 404, else throws |
| POST | `/recorder/prompt` | `makeRecordPrompt` | 523 | `RecorderBar` | `RecorderPrompt` | throws |
| POST | `/recorder/start` | `startRecording` | 529 | `RecorderBar` | `Ok` | throws |
| POST | `/recorder/stop` | `stopRecording` | 534 | `RecorderBar` | `Ok` | throws |
| GET | `/poses` | `listPoses` | 539 | `lib/poses`, `lib/usePoses` | `PoseList` | throws |
| POST | `/poses` | `addPose` | 544 | `PoseEditor` | `Pose` | throws |
| PUT | `/poses/{id}` | `updatePose` | 549 | `PoseEditor` | `Pose` | throws |
| DELETE | `/poses/{id}` | `deletePose` | 554 | `PoseEditor` | `Ok` | throws |
| PUT | `/poses/speed` | `setPoseSpeed` | 559 | `PoseEditor` | `PoseSpeed` | throws |
| POST | `/poses/defaults` | `restorePoseDefaults` | 564 | `PoseEditor` | `PoseDefaults` | throws |
| POST | `/poses/{id}/run` | `runPose` | 570 | `RecorderBar`, `TeleopBar` | `PoseRun` | throws |
| GET | `/recordings` | `listRecordings` | 576 | `DataPanel`, `lib/recordings` | `RecordingList` | returns null on 404, else throws |
| GET | `/recordings/{day}/{ep}` | `getRecording` | 583 | `DataPanel` | `RecordingDetail` | throws |
| GET | `/recordings/{day}/{ep}/frame` | `recordingFrameUrl` | 590 | `DataPanel` | none (`{}`) | builds a URL; no request |
| PUT | `/recordings/{day}/{ep}/edit` | `saveRecordingEdit` | 594 | `DataPanel` | `RecordingEdit` | throws |
| DELETE | `/recordings/{day}/{ep}/edit` | `deleteRecordingEdit` | 600 | `DataPanel` | `Ok` | throws |
| DELETE | `/recordings/{day}/{ep}` | `deleteRecording` | 606 | `DataPanel` | `RecordingTrashed` | throws |
| POST | `/recordings/auto-clean` | `autoCleanRecordings` | 612 | `DataPanel` | `RecordingAutoClean` | throws |
| POST | `/recordings/export` | `exportRecordings` | 617 | `DataPanel` | `RecordingExport` | throws |
| PUT | `/robot/languages` | `setRobotLanguages` | 623 | `lib/robotLanguages`, `lib/useRobotLanguages` | `RobotLanguages` | throws |
| GET | `/planner/prompt` | `plannerPrompt` | 633 | `PlannerPromptPanel` | none (`{}`) | throws |
| GET | `/buttons` | `listButtons` | 643 | `ButtonPanel`, `EnvLocationsEditor` | none (`{}`) | returns `[]` |
| POST | `/buttons` | `addButton` | 650 | `ButtonPanel` | none (`{}`) | throws |
| PUT | `/buttons/{id}` | `updateButton` | 663 | `ButtonPanel` | none (`{}`) | throws |
| GET | `/buttons/groups` | `listButtonGroups` | 677 | `ButtonPanel` | none (`{}`) | returns `[]` |
| POST | `/buttons/groups` | `addButtonGroup` | 684 | `ButtonPanel` | none (`{}`) | throws |
| PUT | `/buttons/groups/{id}` | `renameButtonGroup` | 688 | `ButtonPanel` | none (`{}`) | throws |
| DELETE | `/buttons/groups/{id}` | `deleteButtonGroup` | 692 | `ButtonPanel` | none (`{}`) | throws |
| POST | `/buttons/groups/reorder` | `reorderButtonGroups` | 696 | `ButtonPanel` | none (`{}`) | throws |
| DELETE | `/buttons/{id}` | `deleteButton` | 700 | `ButtonPanel` | none (`{}`) | throws |
| POST | `/buttons/reorder` | `reorderButtons` | 710 | `ButtonPanel` | none (`{}`) | throws |
| POST | `/buttons/bulk` | `bulkAddButtons` | 722 | `ButtonPanel` | none (`{}`) | throws |
| GET | `/config/locations` | `listLocations` | 740 | `DevicePanel` | none (`{}`) | returns an empty list with no active site (also on a network error) |
| POST | `/config/locations/{name}/activate` | `activateLocation` | 747 | `DevicePanel` | none (`{}`) | throws |
| POST | `/config/locations` | `createLocation` | 758 | `DevicePanel` | none (`{}`) | throws |
| PUT | `/config/locations/{name}` | `renameLocation` | 771 | `DevicePanel` | none (`{}`) | throws |
| DELETE | `/config/locations/{name}` | `deleteLocation` | 784 | `DevicePanel` | none (`{}`) | throws |
| POST | `/skill/{name}` | `runSkill` | 797 | `DevicePanel`, `MapPanel`, `mapObjects` | none (`{}`) | throws |
| POST | `/agent/{name}/send` | `agentSend` | 806 | `mapSim`, `mapObjects` | none (`{}`) | throws |
| GET | `/agent/{name}/get` | `agentGet` | 816 | `MapPanel`, `mapObjects`, `lib/robotPose` | `AgentValue` | throws |
| GET | `/config/locations/_active/files/{path}` | `siteFileUrl` | 837 | `MapPanel` | none (`{}`) | builds a URL; no request |
| WS | `/ws/agent` | `agentWs` | 841 | `app/page` | WebSocket | not a request |
| WS | `/ws/camera/{clientId}` | `cameraWs` | 845 | `CameraCell`, `MapPanel`, `CameraFeed` | WebSocket | not a request |

## Notes on single rows

- `GET /connects/status` adds `?fresh=1` when `getStatus(true)` is called (`lib/api.ts:208`).
- `PATCH /skill-configs/{name}` sends `{base, value}` and returns the saved group. A 405 means a backend from before 2026-10-26 (the code comment at `lib/api.ts:339`): the function then does a plain `PUT` of the whole group. See [Backend coupling](backend-coupling.md).
- `PUT /skill-configs/{name}` replaces the whole group. It is used for `ENV` or `MAP` by `MapPanel.tsx` (`Save as place` line 346, `applyOrigin` lines 399 and 403, `undoOrigin` lines 414 and 416) and by `mapSim.tsx:151-152` (`afterRebuild`); `SkillPanel.tsx:171` uses it for skill configs. `EnvPanel.tsx:99-102` and `MapSettings.tsx:62` use the merged `PATCH` (EnvPanel falls back to `PUT` when it has no loaded copy of the group). Two ways to save one kind of data are in use today: a `PUT` made from an older copy can drop another machine's newer entries. Details: [Map tab](../modules/map.md) and [Backend coupling](backend-coupling.md).
- `POST /agent/cancel` is what every Stop button reaches. Closing the WebSocket alone does not stop the robot: the plan keeps running in a backend thread (code comment at `lib/api.ts:449-451`).
- `GET /agent/{name}/get` never clears a pending cancel, unlike `POST /skill/{name}`, so the Map tab can poll it (comment at `lib/api.ts:813-814`).
- `POST /agent/listen/{id}/audio` sends the raw recording as the body with the browser's MIME type (`audio/webm` if none is given); `?note=` carries the browser's account of an empty recording.
- `GET /tts` takes `text` and optional `lang` in the query string and returns audio bytes; only the screen recording uses it (`lib/recordVoice.ts`).
- `recordingFrameUrl` and `siteFileUrl` only build a URL for an `<img src>` or a fetch elsewhere. `siteFileUrl` always uses the `_active` site (`/config/locations/_active/files/...`), which matches OpenAPI's `/config/locations/{name}/files/{path}`.
- The `setLlmConfig` function (`POST /agent/llm-config`) has no caller in `app/`, `components/` or `lib/` at this commit.
- `GET /ros/scan`, `GET /connects/*`, `POST /config/locations*` and the other rows of the Devices panel are called only from `DevicePanel.tsx`.

## Not HTTP: the robot list

`lib/api.ts` also exports helpers that call nothing: `listRobots`, `addRobot`, `updateRobot`, `removeRobot`, `getActiveRobotName`, `setActiveRobot`, `getAgentUrl`, `setAgentUrl`, and the window event `ROBOT_CHANGED_EVENT` (`robotapp:robot-changed`). They read and write the browser's storage; see [Browser storage](browser-storage.md).

!!! code "Where in the code"
    - Every URL: `frontend/lib/api.ts` ([permalink](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/lib/api.ts#L182-L847)).
    - The OpenAPI file: `frontend/lib/generated/openapi.json`.
    - The path check: `scripts/lint.mjs:41-62` ([permalink](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/lint.mjs#L41-L62)).
