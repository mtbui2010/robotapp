---
sources:
  - frontend/lib/types.ts
  - frontend/lib/mapObjects.ts
  - frontend/lib/robotPose.ts
  - frontend/components/MapPanel.tsx
  - frontend/components/MapSettings.tsx
  - frontend/components/mapSim.tsx
  - frontend/lib/api.ts
verified_at: 4a810a3717ab
---

# MAP config

!!! abstract "In this page"
    Every key of the `MAP` [config group](glossary.md#config-group) that the Map tab reads, with its type, its default in the code, and the line that reads it. The shape is `MapConfig` in `lib/types.ts:193-281`. How the tab uses the keys is in [Map tab](../modules/map.md).

The Map tab loads the group with `GET /skill-configs/MAP` (`MapPanel.tsx:175`). If the answer is empty, or has neither `image` nor `layers.occupancy`, the tab shows "This site has no MAP config." (`MapPanel.tsx:176`). A site can write the group by hand, or the backend writes parts of it: `POST /map/snapshot` saves the map files and updates `image`, `layers` and `source` (`lib/api.ts:822-829`).

Frames follow ROS `map.yaml`: `origin` is the world (x, y) in metres of the image's bottom-left corner, `resolution` is metres per pixel, image row 0 is the top (largest y), x goes right (`lib/types.ts:193-196`).

## Top-level keys

| Key | Type | Default when absent | Read by |
|---|---|---|---|
| `image` | `{connection?, url?, file?, frame}` | no picture | `MapPanel.tsx:179`, `188-189` |
| `source` | `{connection, saved_at?, inflate_m?, occupied?, keep?, speck_cells?}` | no "Update map" / "Keep area" buttons | `MapPanel.tsx:352-364`, `488-501`; `MapSettings.tsx:70` |
| `layers` | `{occupancy?, height?}`, each a `MapLayer` | no layer | `MapPanel.tsx:178`, `180`, `235-238` |
| `surfaces` | list of `MapSurface` | none | `MapPanel.tsx:231`, `255`, `338`, `561` |
| `places` | `'ENV'` or `null` | no place dots | `MapPanel.tsx:181`, `571` |
| `pose` | `{agent, x, y, orientation?, yaw?, angle?, period_s?}` | the map is view-only | `MapPanel.tsx:209-227`; `lib/robotPose.ts:16-23` |
| `goal` | `MapSkillCall` | the map is view-only | `MapPanel.tsx:267-274` |
| `rotate` | `MapSkillCall` and `step_deg?` | the arrow keys do nothing | `MapPanel.tsx:303-307`, `325-329` |
| `lift` | `MapSkillCall` and `clearance?`, `reach_m?` | no lift after arrival | `MapPanel.tsx:250-261` |
| `confirm_goal` | boolean | no question before a motion | `MapPanel.tsx:245` |
| `origin` | `{x, y, yaw_deg}` | `{x: 0, y: 0, yaw_deg: 0}` (`ZERO`, `MapPanel.tsx:28`) | `MapPanel.tsx:376`, `387`, `451` |
| `sim` | `{agent}` | no simulation bar | `mapSim.tsx:46` |
| `objects` | `MapObjectsConfig` | no objects layer | `lib/mapObjects.ts`; `MapPanel.tsx` |

`image.url` is declared in the type, and no code reads it at this commit. `image.connection` names a camera connection (the simulator's top-down view); `image.file` is a site file served by `GET /config/locations/_active/files/<file>`.

### Value defaults of the keys with a number

| Key | Default in code | Where |
|---|---|---|
| `pose.period_s` | 0.5 s between reads | `MapPanel.tsx:226` |
| `pose.angle` | radians; `'deg'` converts | `lib/robotPose.ts:20` |
| `pose` with neither `orientation` nor `yaw` | yaw 0 | `lib/robotPose.ts:17-20` |
| `rotate.step_deg` | 15 | `MapPanel.tsx:329`, `516` |
| `lift.reach_m` | 0.8 m: how near a surface the robot must be | `MapPanel.tsx:254`, `339` |
| `lift.clearance` | 0.1 m added to the surface height | `MapPanel.tsx:259` |
| `layers.occupancy.values` | `{inflated: 128, occupied: 255}`; a pixel at or above `inflated` blocks the base | `MapPanel.tsx:235-236` |
| `layers.height.frame.unit` | `cm`; `mm` is the other accepted value | `MapPanel.tsx:238` |
| `objects.poll_s` | 1 s, never below 0.2 s | `lib/mapObjects.ts:16` |

### Skill calls: `goal`, `rotate`, `lift`

A `MapSkillCall` is `{skill, params}` where the values of `params` are templates. The panel fills the placeholders: a value that is only a placeholder becomes a number.

| Key | Placeholders |
|---|---|
| `goal` | `{x}`, `{y}`, `{rz}` (`rz` in degrees: the current heading) |
| `rotate` | `{deg}` |
| `lift` | `{h}` in metres |

A click on a saved place does not use the config: it runs the skill `move` with `{inputs: <name>}`, a name fixed in the code (`MapPanel.tsx:293`).

### `layers`, `surfaces`

| Key | Type | Meaning |
|---|---|---|
| `MapLayer.file` | string | a site file |
| `MapLayer.frame` | `MapFrame` | `resolution`, `origin`, `width`, `height`, optional `unit` |
| `MapLayer.values` | `{free, inflated, occupied}` numbers | occupancy only: the pixel values; see [occupancy layer](glossary.md#occupancy-layer) |
| `MapSurface` | `{name, centre, size, yaw_deg, height}` | a table or shelf: centre and size in metres, `size` is depth along `yaw_deg` then width across it, `height` in metres |

### `source`

| Key | Meaning |
|---|---|
| `connection` | the occupancy-grid connection the saved map came from |
| `saved_at` | when it was saved (shown in the settings) |
| `inflate_m` | the obstacle inflation used for the base (the call sends 0.3 when none is given: `lib/api.ts:828`) |
| `occupied` | a count; declared in the type |
| `keep` | the area kept, as corner points in the map frame; outside is unknown. Applied again by every later snapshot |
| `speck_cells` | lone obstacle blobs below this size were dropped; applied again by every later snapshot |

### `objects` (the objects layer)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `agent` | string | required | the device agent read with `GET /agent/<agent>/get` or `POST /agent/<agent>/send` |
| `read` | `{method: 'get'}` or `{method: 'send', body?}` | `get` | how to read (`lib/mapObjects.ts:73-74`) |
| `path` | string | `""`: the reply itself | where the dict `id -> {x, y, ...}` sits in the reply |
| `poll_s` | number | 1 | see above |
| `fields` | `{x, y, label, kind, place, held, id}` | `x`, `y`, `name`, `cls`, `at`, `held`, `id` | names of the fields inside each object (`lib/mapObjects.ts:13`) |
| `actions` | `{spawn?, move?, remove?}` | none | a skill call `{skill, params}` or a device command `{agent, send}`; placeholders `{id}`, `{x}`, `{y}`, `{place}`, `{cls}`; an action the backend cannot do is left out and the UI hides it |

An entry without finite `x` and `y` is dropped unless it is held; a held object is drawn at the robot (`lib/mapObjects.ts`).

## Writing the group

The tab changes `MAP` and `ENV` itself in several places, and it writes the whole group each time with `PUT /skill-configs/<name>`; `MapSettings` uses the merged `PATCH`.

| Code | Group | How the body is made |
|---|---|---|
| `Save as place`, `MapPanel.tsx:346` | `ENV` | re-read just before, one entry added |
| `applyOrigin`, `MapPanel.tsx:385-409` | `ENV` (when places follow the origin) and `MAP` | `ENV` re-read just before; `MAP` is the copy `cfg` held since the last reload, with a new `origin` |
| `undoOrigin`, `MapPanel.tsx:411-420` | `ENV` and `MAP` | `ENV` as saved in the undo record; `MAP` is `cfg` again, with the old `origin` |
| `afterRebuild`, `mapSim.tsx:150-155` | `ENV` and `MAP` | as the simulator returned them |
| `MapSettings.tsx:62` | `MAP` | `PATCH {base, value}`: merged per top-level entry on the backend |

So the `MAP` writes of `applyOrigin` and `undoOrigin` carry every key as it was in the browser at the last reload. If another machine saved `MAP` after that reload, that change is overwritten. `ENV` is also written by `EnvPanel` with `PATCH`. See [Backend coupling](backend-coupling.md) and [Map tab](../modules/map.md).

!!! note
    This page is about the configuration only. Nothing here was run against a robot or a simulator.

!!! code "Where in the code"
    [`frontend/lib/types.ts:193-281`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/lib/types.ts#L193-L281), [`frontend/components/MapPanel.tsx`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/components/MapPanel.tsx), [`frontend/lib/mapObjects.ts`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/lib/mapObjects.ts).
