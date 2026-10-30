# Spoken names in plans: `said->real` (2026-10-08)

<!-- Moved verbatim from CLAUDE.md (lines 249-294) on 2026-10-30; links rebased to docs/features/. -->

A plan can give a skill name or **any** parameter value two names: what the
robot says, and what it runs. Skill and location aliases are kept as they are;
this is an addition (proposal: [PROPOSAL-spoken-names.md](../../PROPOSAL-spoken-names.md)).

```
이동->move::식탁 앞->table_top                       # runs move::table_top, narrates "식탁 앞 이동을 진행합니다"
pick_top::inputs='컵->cup', loc='식탁->table@kitchen'
ask::inputs='어디로 갈까요?', options="식탁 앞->table_top, 옷방->dressroom"
이동->move::{answer}                                 # gets '식탁 앞->table_top' from ask
```

- Helpers in [robot_agent/spoken.py](../../../robot_agent/robot_agent/spoken.py)
  (`split_spoken`, `split_value`, `split_params`, `split_skill`, `said_of`,
  `real_step`). No arrow = one name, as before. More than one `->`, nothing
  after it, or `->>` fails the step.
- **`SkillRegistry.execute`** splits the skill name and every parameter of a
  code skill (internal / external) and installs the said sides for the call;
  a skill reads them with `robot_agent.skills.spoken(key, value)` (`'skill'` for
  its own name). Pass the value the skill holds: the said name is returned only
  while it still belongs to that value, so `move` → `lift(inputs='home')` does
  not read the outer step's name. **Plan skills get their params unsplit**, so
  the step inside (`move::$loc$`) still has both names. `skill_entry` (Python
  API) splits too. `options` and `others` are never split there (`ask` needs the pairs:
  `->`, or the older `=`; kcare `find` / `pick` take each `others` item's real side, so ask's options can be
  copied as they are).
- Real side type: `inputs` stays text (`lift::0.5` has always been `'0.5'`);
  other keys go through `ast.literal_eval` (`fixed_angle='정면->0'` → `0`).
  `>>` values split per segment (`컵->cup>>식탁->table` → `cup>>table`).
- A `k=v` value with `->` **must be quoted**; unquoted, `parse_inputs` now
  refuses the line instead of silently running it all as `inputs`.
- `{name}` used as a whole value goes in as `<name>_text->value` when the result
  has a different `<name>_text` (ask's `answer_text`), so the next skill says
  what the user chose.
- Who uses the said side: the narrator (direct mode `_verb_obj`, closed loop
  `ClosedLoop._say` from `step['say']`, set by `llm_direct._parse_steps`);
  kcare `announce_placing`, `pick`'s `announce_picking`, `select_response`.
  The Robot State update gets the real names (`real_step`). The Plan panel
  shows `->` as `→`; `PlanSkillEditor` checks the real skill name.
- Free text containing `->` (`announce::A->B`) is split too — accepted.
- Korean step phrases pick 을/를 from the verb (`announcer._eul`), which also
  fixed the old "이동를".
- CLI: quote the whole thing (`>` is a shell redirect):
  `kcare_robot '이동->move::식탁 앞->table@kitchen'`.
