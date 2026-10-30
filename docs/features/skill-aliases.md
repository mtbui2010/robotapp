# Skill aliases

<!-- Moved verbatim from CLAUDE.md (lines 226-248) on 2026-10-30; links rebased to docs/features/. -->

A skill may have other names (`라면가져와`, `lấy mì` …): `SkillDef.aliases`,
saved in `skills.json`. `SkillRegistry.resolve` (exact name → exact alias →
either compared with `env_names.normalize`: NFC, case, whitespace) is used by
`execute`, so the Agent panel, `POST /skill/<alias>`, the CLI, plan skills and
the planners all accept an alias. Saving (`POST /skills`, `PUT /skills/<name>`
with `aliases`) is refused (400) for an empty alias, one with a parser
character (`: & ! ~ # $ { } , = ' " ( )`), one listed twice, or one that is
another skill's name or alias (`check_aliases`); a new or renamed skill may not
take another skill's alias as its name. Plans may call a skill by alias
(`validate_plan`, the self-call check and the delete check resolve aliases).
`POST /skills/reload` keeps the aliases of code skills (skills_config has
none). `PLAN_SKILLS_HERE` lines end with `(also: …)`.

In the Skill panel, a collapsed **Skill aliases** block
([components/SkillAliasesEditor.tsx](../../frontend/components/SkillAliasesEditor.tsx))
lists each skill with its alias chips — the same `AliasInput` as the Location
aliases (exported from `EnvNamesEditor.tsx`); each change is saved at once, a
clash shows red on the chip (same check as the backend) and a refusal under
the skill. Rows show `· alias, …` after the name; the panel search matches
aliases too.
