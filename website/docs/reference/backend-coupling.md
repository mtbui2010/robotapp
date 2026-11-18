---
sources:
  - frontend/app/page.tsx
  - frontend/components/PlanPanel.tsx
  - frontend/components/MapPanel.tsx
  - frontend/components/DevicePanel.tsx
  - frontend/components/EnvPanel.tsx
  - frontend/components/EnvNamesEditor.tsx
  - frontend/components/EnvLocationsEditor.tsx
  - frontend/components/PlanSkillEditor.tsx
  - frontend/components/SkillAliasesEditor.tsx
  - frontend/components/mapSim.tsx
  - frontend/lib/api.ts
  - frontend/lib/types.ts
  - frontend/lib/skill_configs.json
  - frontend/lib/ros_templates.json
  - scripts/lint.mjs
verified_at: 4a810a3717ab
---

# Backend coupling

!!! abstract "In this page"
    What the dashboard still knows that the backend should tell it, as the code says at commit `4a810a3717ab`: bundled robot data, hand-written types, the five tagged workarounds with their real line numbers, rules copied from the backend, names fixed in the code, and one place that writes a whole config group. It ends with a list of where the repo's own `docs/backend_coupling.md` no longer matches the code.

The repo rule is that the dashboard holds no robot knowledge: it gets it from the [robot_agent](glossary.md#robot-agent). The rule is not fully met. Each row below says what the code does today and how to avoid trouble; nothing is described as "will be fixed".

## 1. Robot data bundled in the UI

`make lint` refuses a new import of a `.json` file under `frontend/lib` unless it is in `BUNDLED_ALLOWED` (`scripts/lint.mjs:23`). Two files are allowed; a third exists and nothing imports it.

| File | Imported by | What it is | What it means for another robot |
|---|---|---|---|
| `lib/skill_configs.json` | `SkillPanel.tsx:6`, `EnvPanel.tsx:8` | a map `skill_config_map` from a skill name to the [config groups](glossary.md#config-group) shown under it: 38 skill names at this commit; a second top-level key `pi0.5_act`. `EnvPanel` shows the groups no skill claims | a robot with other skills gets this map or no map; edit the file or the groups appear under "Global Configs" |
| `lib/ros_templates.json` | `DevicePanel.tsx:6` | ROS interface templates for the add-connection form (encode, decode, cancel), matched on the scanned interface | the form offers these templates, not the robot's own |
| `lib/room_configs.json` | nothing | an old sample of the `ENV` group | none: the file is not imported, so the lint does not list it |

## 2. Hand-written types

There is no `openapi.d.ts` at this commit, and `openapi-typescript` is not in `package.json`. `make gen-types` only refreshes `openapi.json`, which the lint uses to check paths. The types the dashboard compiles against are written by hand: `lib/types.ts` (292 lines) and the types of the helper modules (`recordings.ts`, `poses.ts`, `teleop.ts`, `recorder.ts`, `robotLanguages.ts`, `buttonGroups.ts`). The backend names 47 of its 85 operations' replies (see [Endpoints](endpoints.md)), so for those a generated type could replace a hand-written one; this is not done.

| Hand-written type | Describes | Declared in the OpenAPI? |
|---|---|---|
| `ClientEntry`, `ClientType` | a connection and its type list | reply of `GET /connects` has no schema; `ClientType` is a literal union in the dashboard |
| `PoolStatus`, `PoolServerStatus` | AI-server pool status | `GET /connects/servers` has no schema |
| `SkillDef` | a skill | `GET /skills` replies with `SkillInfo[]`, a different name |
| `WorldState` and the provenance types | the world state | `GET /agent/world` replies with `WorldStateOut` |
| `PlannerPrompt`, `RosScanResult` | planner prompt, ROS scan | no reply schema |
| `LocationsInfo` | sites | no reply schema |
| `MapConfig` and the map types | the `MAP` group | none: a config group has no schema |
| `SimState`, `SimObject`, `SimFurniture` | the simulator's reply to `POST /agent/<agent>/send` | none |
| `AgentEvent` (55 fields) | `/ws/agent` events | WebSocket routes are not in OpenAPI; no event schema exists |

The run result of `api.runSkill` is `Record<string, unknown>`; the code reads `isdone` and `msg` from it by name.

## 3. Workarounds for the backend

A workaround is tagged with `BACKEND-WORKAROUND(<id>)` in a code comment. `make lint` finds the tags and checks that each id is written in the repo's `docs/backend_coupling.md` (`scripts/lint.mjs:86-102`); it does not check that the description there is still true. At this commit it reports 5 tags.

| Id | Where | What the UI does | Avoid trouble by |
|---|---|---|---|
| `hri-narrator-gate` | `app/page.tsx:347` | no milestone narration (`say`) while an HRI speak or listen is queued; the narration waits and is said after the queue, never while the mic is open | none needed; it is the reason a `say` line may come late |
| `plan-event-shape` | `components/PlanPanel.tsx:555` | shows the plan from `plan_text`, else `plan` (a string), else `steps` (`[{action, object}]`) | a backend path should send `steps` and `plan_text` |
| `done-event-shape` | `components/PlanPanel.tsx:615` | accepts two `done` shapes: `status`, or a boolean `success` | send `status` |
| `map-arrive-check` | `components/MapPanel.tsx:279` | after the `goal` skill reads the pose back; if it is more than 0.3 m from the goal it says "stopped N m short of the goal (no path?)", because the robot package reports `isdone` even when navigation gave up | none; the check is in the UI |
| `delete-active-location` | `components/DevicePanel.tsx:448` | activates the site `default`, then deletes the site: the backend refuses to delete the active one. Two calls, not atomic | if the second call fails, the active site is now `default`; re-select your site |

The `done-event-shape` code, verbatim (`components/PlanPanel.tsx:612-619`):

```ts
  // Two backends, two shapes: the closed-loop (GRACE) sends `status`
  // ('success'|'failed'|'planned'|'aborted'); run_direct / legacy `run` send a
  // boolean `success`. Prefer `status` when present, else fall back to `success`.
  // BACKEND-WORKAROUND(done-event-shape)
  const ok = done?.status != null
    ? (done.status === 'success' || done.status === 'planned')
    : done?.success === true
  const doneBadge = done && (
```

An untagged workaround of the same family: the Map tab reads the robot pose with `GET /agent/<name>/get` and never with `POST /skill/<name>`, because a skill call clears a pending cancel (comment at `lib/api.ts:813-814`).

## 4. Backend rules copied into the UI

The UI repeats some backend checks so it can show an error while the user types. When the backend changes its rule, the copy does not follow.

| Where | Rule copied | If the copy is wrong |
|---|---|---|
| `isFailureEvent`, `app/page.tsx:50-65` | `unified_agent._is_failure_event` (the comment says so): a failed step, a run error, a symbolic violation, a replan | the capture folders and the failed-only filter are wrong; see [Agent events](agent-events.md) |
| `checkPlan`, `components/PlanSkillEditor.tsx:29` | a plan skill may not name an unknown skill or itself | the save is refused by the backend with a 400 and its reason is shown |
| `normalizeName`, `RESERVED`, `aliasProblems`, `components/EnvNamesEditor.tsx:17-37`; `RESERVED` again in `components/EnvLocationsEditor.tsx:20` | location name rules; `home` and `base` are reserved | the backend refuses the save with a 400 |
| `problemsOf`, `components/SkillAliasesEditor.tsx:14-34` | an alias may not be another skill's name or alias, nor contain `:&!~#${},='"()` or a space | the backend refuses the save |
| auto lift, `components/MapPanel.tsx:250-261`, `338-339` | nearest surface within `reach_m` (default 0.8 m), then `height + clearance` (default 0.1 m) | set `MAP.lift.reach_m` and `clearance` per site; see [MAP config](map-config.md) |

`isFailureEvent` was not listed in the repo's own inventory (section 4 of `docs/backend_coupling.md`).

## 5. Names fixed in the code

| Where | Name | Effect |
|---|---|---|
| `components/MapPanel.tsx:293` | skill `move` for a click on a saved place | a robot whose move skill has another name gets a failing click; `MAP.goal` is configurable, this is not |
| `components/DevicePanel.tsx:492` | skill `warmup_servers` for the Warm up button | the button is there for every robot |
| `app/page.tsx:98-116`, `components/ConfigFields.tsx:116-117`, `components/DevicePanel.tsx:660`, `1455` | `HRI_CONFIGS` keys `speech_rate`, `speech_rate_en`, `source`, `dashboard_stt` | a robot without the group has no speech rate control |
| `components/EnvPanel.tsx:16` | `FIRST_NAMES = ['ENV']`: the group listed first | none |
| `lib/api.ts:119-125` | default robot URL `http://<page host>:8001` when no robot is configured | add a robot in the Devices panel |
| `lib/types.ts:159`, `164` and others | comments with the robot package's vocabulary (`skill`, `plan_text` as "kcare `skill::inputs`") | none |

## 6. Saving a config group: two ways

One kind of data is saved in two ways. `PATCH /skill-configs/<name>` with `{base, value}` is merged on the backend per top-level entry, so another machine's newer entries are kept (`api.mergeSkillConfig`, used by `EnvPanel.tsx:101` and `MapSettings.tsx:62`). `PUT` replaces the whole group (`api.updateSkillConfig`). The Map tab uses `PUT`:

| Code | Group | Note |
|---|---|---|
| `MapPanel.tsx:342-346` (`Save as place`) | `ENV` | reads `ENV` just before the write |
| `applyOrigin`, `MapPanel.tsx:385-409` | `ENV` (when places follow) and `MAP` | `MAP` is written from `cfg`, the copy held since the last reload, with the new `origin` |
| `undoOrigin`, `MapPanel.tsx:411-420` | `ENV` and `MAP` | `ENV` from the undo record, `MAP` from `cfg` |
| `afterRebuild`, `components/mapSim.tsx:150-155` | `ENV` and `MAP` | as the simulator returned them |
| `SkillPanel.tsx:171` | a skill config | one group |

If another machine saved the same group after this browser loaded it, its change is lost. Avoid it by editing one site from one machine at a time, and by reloading the Map tab before you edit. Details of the Map tab: [Map tab](../modules/map.md).

## 7. Where `docs/backend_coupling.md` is out of date

The file in the repo says "Read on 2026-10-30 from `robot_agent` 04f08a5". These are the differences found by reading the code and `openapi.json` at `4a810a3717ab`. The file is not changed by this site.

| The file says | The code at this commit |
|---|---|
| OpenAPI has 38 paths and 21 schemas | 66 paths and 63 schemas (85 operations) |
| no route declares a `response_model`; every response would be `unknown` | 47 of 85 operations name a reply schema (200 or 201 reply is a `$ref` or an array of `$ref`; 51 have a non-empty one) |
| `make lint` checks "all 50" URLs | 77 URLs (75 HTTP, 2 WebSocket) |
| `api.updateSkillConfig` uses `PUT`; a `PATCH` exists on the backend | `api.mergeSkillConfig` (`PATCH`) exists and two panels use it; the Map tab and the simulator bar still use `PUT` |
| `skill_configs.json` has 30 skill names | 38 skill names and a second top-level key `pi0.5_act` |
| `done-event-shape` at `PlanPanel.tsx:574` | line 615 |
| `plan-event-shape` at `PlanPanel.tsx:522-537` | line 555 |
| `hri-narrator-gate` at `app/page.tsx:245` | line 347 |
| `delete-active-location` at `DevicePanel.tsx:431` | line 448 |
| `map-arrive-check` at `MapPanel.tsx:279` | the same, line 279 |
| auto lift at `MapPanel.tsx:249-262,334` | lines 250-261 and 338-339 |
| `warmup_servers` at `DevicePanel.tsx:474` | line 492 |
| default URL at `lib/api.ts:102` | lines 119-125 |
| `EnvPanel.tsx:14` `FIRST_NAMES = ['ENV', 'HOME_LOC']` | line 16, `['ENV']` |
| `AgentEvent` has "60+ optional fields" | 55 fields |
| section 4 lists the mirrored rules | `isFailureEvent` is missing from it |
| the routes `/runs` are "in progress" on a branch | the committed `openapi.json` has 8 `/runs` paths and 2 `/diagnostics` paths; the dashboard calls none of them |
| `POST /skills` is registered twice in the backend; branches `arch/*` are in progress | not checked: this site did not read the backend |

The other contributor notes have similar gaps: `docs/rules.md` says `make ci` is lint, typecheck and smoke (it also runs `unit`), and the README says the "two clients on one robot" warning is in the Guide panel, but a search finds the wording only in `ChatPanel.tsx:18`, `TeleopBar.tsx:37` and a code comment at `app/page.tsx:945-947`. `GuidePanel.tsx`, the Map tab, the shortcut buttons and the Agent panel contain no such note, though the last three can move the robot. See [Chat](../modules/chat.md) and [Map tab](../modules/map.md).

!!! code "Where in the code"
    Tags: [`app/page.tsx:347`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/app/page.tsx#L347), [`PlanPanel.tsx:555`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/components/PlanPanel.tsx#L555), [`PlanPanel.tsx:615`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/components/PlanPanel.tsx#L615), [`MapPanel.tsx:279`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/components/MapPanel.tsx#L279), [`DevicePanel.tsx:448`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/components/DevicePanel.tsx#L448). The tag check: [`scripts/lint.mjs:86-102`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/scripts/lint.mjs#L86-L102).
