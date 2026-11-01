# Config groups in the dashboard (2026-10-26)

- **Deleted:** `HOME_LOC`, `CALIB_PARAMS`, `KR2EN`, `EN2KR`, `LLM_SERVERS` — gone from robot_agent
  (`skill_configs` proxies, `KNOWN_CONFIGS`, defaults, `copy_skill`), kcare `configs/tasks.py`, every kcare site
  override (copies in `*.before_cleanup_20261026`) and kcare's `skills/calibrattion.py` / `configs/word_mapping.py`.
  None was read: `move::home` has its own pose, find's head→base goes through `get3d`, the LLM servers are the
  `vlms` connection. kcare_clobot keeps its own copies (imports them from `kcare_clobot.configs.tasks`).
- **Where each group is edited:** a group listed for a skill in
  [frontend/lib/skill_configs.json](../../frontend/lib/skill_configs.json) is in that skill's form (Skill panel) and not
  in the sidebar block: `QA_CONFIGS` → `qa`; `HRI_CONFIGS` → `qa` / `ask` / `reply` / `announce`;
  `EMERGENCY_CONFIGS` → `check_fall` / `check_restroom` / `call_119`. `MAP` → the Map tab's **⚙ Settings**
  ([components/MapSettings.tsx](../../frontend/components/MapSettings.tsx): pose, goal, rotate, lift, confirm_goal,
  places + "+ key" templates; the picture / source / keep area / origin are shown only — Update map, Keep area,
  Edit origin write them; JSON = the whole group). MAP stays its own group (not inside `MOBILE_CONFIGS`): the
  map tools and kcare-sim write it, and a site override replaces a whole group. For kcare the sidebar block
  then holds only ENV and is titled **Locations (ENV)**.
- **ENV locations** ([components/EnvLocationsEditor.tsx](../../frontend/components/EnvLocationsEditor.tsx), Fields
  view): one foldable row per location (mode · height · loc); **+ Add location** — defaults, the robot's
  position now (MAP.pose, `lib/robotPose.ts`), or a copy of another place (without its aliases / label / qa);
  **🗑** asks first and names the plan skills / buttons that still say the name or an alias (free text,
  a warning only), **↶ undo** for the last one; inside a location **×** removes a param and **+ param** adds one
  (`dforward` or `placepose.dz`, value parsed as JSON else text). `ConfigFieldsEditor` has these as `editKeys`.
  Nothing is saved before **Save** (`● unsaved`).
- **Saves are changes, not snapshots:** `PATCH /skill-configs/<name> {base, value}`
  (`ConfigManager.merge_update`, `api.mergeSkillConfig`) merges per top-level key — per location for ENV —
  with the group as it is NOW, so a place another machine added after the dashboard loaded is kept (a PUT of
  the old snapshot dropped it). The sidebar block and Map ⚙ Settings use it; a backend without it (405) gets
  the old PUT. Test: `kaair_real_capture/config_cleanup_20261026/test_cleanup.py`.
- **Narration (names as written):** a direct-mode step is said in the run's language; with plain names the
  names stay as written, the skill name too — `move::drawer` (KO) → "drawer move를 진행합니다"; the translated
  verb only for a spoken name (`이동->move::서랍->drawer` → "서랍 이동을 진행합니다") or a Korean name
  (`move::식탁` → "식탁 이동을 …"). `_step_say` in `UnifiedAgent.run_direct`; `pick_top` is said "pick top".
  kcare's own pick / place lines likewise ("cup 잡을게요"). The word maps that made 테이블 out of table are
  gone. A failure's msg is said only when it is short plain text — "'Exception in move': {'isdone': …}" was
  read out word by word. **Only a step's `inputs` is said** (2026-10-27; it was the first param whatever its
  key: `execute=True, inputs='drawer'` read "True", `lift::height=0.5` "0.5"): `lift::height=0.5` → "lift를
  진행합니다"; `options` only for the skills in `_SAY_OPTIONS` (`ask` — itself not narrated now).
  **`%` = this step is not narrated** (2026-10-28): `%move::wait` says neither "… 진행합니다" nor "… 완료했습니다"
  (`step_start` carries `quiet: true`, which also stops the dashboard's 15 s "still working" nudge); a failure is
  still said, unless `!` ignores it (`!%lift::0.5`). In an `&&` group the first task is the narrated one, so the
  `%` goes there. The skill's own lines (`announce`, pick's "cup 잡을게요") are not affected. `%` is stripped
  wherever `!` / `~` are (`_bare`, `real_step`, `rename_calls`, `PlanSkillEditor`) and refused in skill aliases.
  Test: `kaair_real_capture/quiet_step_20261028/test_quiet.py`. Step / done events carry `say_lang` (the dashboard picks the voice by it; the 15 s
  "still working" nudge follows it). Test: `kaair_real_capture/config_cleanup_20261026/test_narration.py`.
