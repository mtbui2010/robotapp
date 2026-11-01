# Planner prompt (read-only)

The **Direct** planner (Agent panel → Direct; robot_agent's `llm_direct` backend and the open-loop
path a request without a planner runs) turns a command into a `skill::input` program with one LLM
call. Its prompt is **built by the backend each time it plans**, from:

- the robot's description and skills (`configs/manifest.yaml`: `description` / `capabilities`, each
  skill's `action` and `description`), one `- skill::<input> (Action): what it does` line each, plus
  the plan skills defined on the dashboard;
- the ENV places with their aliases;
- the robot's notes (manifest `planner.notes`);
- the example plans most similar to the command (the robot's seed pool, manifest
  `planner.seed_memory`, plus verified episodes of the planner's memory);
- fixed answer rules and the command.

Nothing is stored or edited in the dashboard: to change what the planner sees, change the manifest
(`planner.notes`, skill descriptions), the ENV (Locations panel) or the seed pool. Backend side:
robot_agent [docs/direct_prompt.md](../../../robot_agent/docs/direct_prompt.md).

`PlannerPromptPanel` ([frontend/components/PlannerPromptPanel.tsx](../../frontend/components/PlannerPromptPanel.tsx),
sidebar 1, where the Planner Guide editor was) is a collapsed block with a command box. **Show** calls
`api.plannerPrompt(command, planner)` → `GET /planner/prompt?command=…&planner=…` and shows the prompt
(read-only) and the example tasks it holds. `planner` is the Agent panel's choice (`lib/planner.ts`);
when that planner does not use the prompt (`uses_prompt: false`: SAGE builds its own prompts from the
manifest), the panel says so.

Removed on 2026-11-02: the Planner Guide (stored, versioned `guides.json`, the editor panel, `/guides`
endpoints, `GuideVersion` types). An old `common/guides.json` on a robot is ignored.

The **Structured** mode of the Agent panel (plan presets, `direct: true` on `/ws/agent`) is a different
thing despite the name: it runs the written `skill::args` text as is (`UnifiedAgent.run_direct`), no
LLM, no prompt. It is unchanged.
