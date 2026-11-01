# Plan skills (a skill defined as a plan)

<!-- Moved verbatim from CLAUDE.md (lines 168-225) on 2026-10-30; links rebased to docs/features/. -->

Skill panel → **+ Add** → type **Plan** defines a skill as a sequence of other
skills, stored in `skills.json` as `type: 'plan'` and run by
`SkillRegistry.execute` ([core/plan_skill.py](../../../robot_agent/robot_agent/core/plan_skill.py)),
so the Agent panel, `POST /skill/<name>`, the CLI, the planners and other plan
skills can all call it:

```
move::$loc=counter2@kitchen$      # $name=default$ — a parameter with a default
lift::1
fine_move::$inputs$               # $inputs$ — what follows pick_top::
movej::give
```

`pick_top::cup`, `pick_top::inputs='cup', loc='table@kitchen'`. Lines use the
direct-mode syntax (`&&` parallel, `!skill` ignore failure, `~skill` force
failure, `%skill` not narrated, `#` comment) and the same argument rules (`parse_inputs`, now shared
with `UnifiedAgent._parse_inputs`). Parameter values are inserted **after**
parsing (as literals in `k=v` form), so commas / quotes in a value cannot break
the line. Each step's result is passed on to the next steps, as in the direct
mode (`find`'s `ins` reaches `pick`).

- **`{name}` — an earlier step's result.** In a plan skill and in the direct
  mode, `{answer}` is replaced by the `answer` an earlier step returned
  (`plan_skill.parse_step_args` / `refs_to_params`, inserted after parsing like
  `$param$`, so commas / quotes in it are safe):
  ```
  ask::inputs="뭐가 드실래요?", options="신라면, 짜파게티, 너구리, 안성탕면"
  fine_move::{answer}                        # or inputs={answer}, fixed_angle=0
  ```
  A name no earlier step returned fails the step (`{choice}: no earlier step
  returned "choice" (have: answer, text)`). Use it for a whole value: inside a
  quoted string it is inserted with quotes. Every earlier result is still also
  merged into the later steps' params as before (the `rz=90` leak).
- **On a failure the plan stops and the robot stays as it is** — no clean-up
  steps (no fold / lift-home: from an unknown pose they can hit furniture, the
  user's call). The result carries `failed_step`, `failed_line` and a
  per-step `plan_steps` report; the Execution panel gets one log line per step.
- Cancel is checked between steps; nesting is capped at 5; each successful
  sub-step goes through `apply_skill_effect`, so Robot State follows the
  `pick` inside `pick_top`.
- Saving is refused (400) for an unknown skill, a name taken by a code skill,
  a plan that calls itself (directly or via another plan skill), or one
  parameter with two defaults; deleting a skill a plan still calls is refused.
  `POST /skills/reload` keeps plan skills. The editor
  ([components/PlanSkillEditor.tsx](../../frontend/components/PlanSkillEditor.tsx))
  runs the same checks as you type, and has no "run" button — try a saved plan
  skill from the Agent panel.
- **Renaming** (plan skills only): the edit form has a name field;
  `PUT /skills/<name>` with `{name: <new>}` re-keys the skill in place
  (`SkillRegistry.rename`) and rewrites the calls in every other plan skill
  (`plan_skill.rename_calls` — keeps `!` / `~`, `&&`, arguments, comments).
  Shortcut buttons and guides are free text and keep the old name. Refused for
  a code skill, a taken name, an invalid name, or a rename+plan that would loop.
- A guide may contain `PLAN_SKILLS_HERE`; `resolve_guide` fills it with
  `- pick_top::<inputs>  (loc=counter2@kitchen, inputs) — <description>`.
