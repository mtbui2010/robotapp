# Planner guide versions

<!-- Moved verbatim from CLAUDE.md (lines 955-974) on 2026-10-30; links rebased to docs/features/. -->

The LLM **guide** (the prompt that turns a task into a plan) is now versioned and
editable. The backend stores versions in `common_dir/guides.json` (seeded on first
run from the robot's `configs/guide*.py` modules); the **active** version is what
the planner uses, falling back to the modules when the store is empty. Each version
is `{ name, guide, format }` — `format` is `null` for a freeform guide
(`llm.chat_guide`) or a JSON schema for a structured one (`llm.chat`). The
`GuideEditorPanel` ([frontend/components/GuideEditorPanel.tsx](../../frontend/components/GuideEditorPanel.tsx),
in sidebar 1) is an expandable block to select / edit / add / delete versions and
set the active one; wrappers (`listGuides`/`createGuide`/`updateGuide`/`deleteGuide`/
`activateGuide`) and the `GuideVersion` type live in
[frontend/lib/api.ts](../../frontend/lib/api.ts) / [frontend/lib/types.ts](../../frontend/lib/types.ts).
(Distinct from `GuidePanel.tsx`, which is the connection-config help modal.)

Only the **Direct** planner (and robot_agent's `llm_direct` backend) plans with the guide;
SAGE (`sage`, `grace`) builds its prompts from the robot's manifest. The panel calls
`listGuides(planner)` (`GET /guides?planner=`) with the Agent panel's planner choice
(`lib/planner.ts`: `robotapp_planner` in localStorage, `robotapp-planner` window event) and,
when `active_planner_uses_guide` is false, greys out "active" and shows a note. **Preview**
(`previewGuide`, `POST /guides/preview`) shows the text the LLM would receive for a command,
with `{ROBOT}` / `{ACTIONS}` / `{EXAMPLES}` filled and the retrieved example tasks. Backend
side: robot_agent docs/planner_guide.md.

`POST /skill/<name>` is the same path the CLI mode (`<pkg> <name>::<inputs>`)
ultimately resolves through `SkillRegistry.execute()`. Two clients (UI +
CLI) calling the same robot simultaneously is **unsafe** — document this
in any operator-facing UI.
