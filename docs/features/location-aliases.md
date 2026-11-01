# Location names and aliases (ENV)

<!-- Moved verbatim from CLAUDE.md (lines 123-167) on 2026-10-30; links rebased to docs/features/. -->

Each `ENV` entry (sidebar **Locations (ENV)**, formerly Global Configs) is keyed by its canonical name and may list
other names for the same spot:

```json
"dressroom@main room": { "aliases": ["옷장", "tủ áo"], "loc": {...}, ... }
```

A place named by an alias is spoken back as typed (`tủ áo에 내려 놓을게요`).
The older `label` field stays for the key itself — etri uses it for Korean names
of English keys, and `move` sends it as the POI name when an entry has no `loc` —
but the dashboard no longer edits it outside the JSON / generic field view.

`move::옷장`, `move::tu ao`, `move::옷장@main room` and `move::dressroom` all
reach it. The resolver is [robot_agent/env_names.py](../../../robot_agent/robot_agent/env_names.py)
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
  ([frontend/components/EnvNamesEditor.tsx](../../frontend/components/EnvNamesEditor.tsx)),
  collapsed by default (header shows the alias count, or `⚠ N clashes`). Open,
  it lists each key with its alias chips below it (Enter or `,` to add, × or
  Backspace to remove) — stacked, since the sidebar is narrow. It runs the same
  clash check as the backend and marks the offending chip red. `aliases` is
  hidden from the generic field list below it.
- The Direct planner's prompt lists the places, one line per location
  (`- dressroom@main room (also: 옷장, tủ áo)`) from the live ENV
  ([planner-prompt](planner-prompt.md)).
