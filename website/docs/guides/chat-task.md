# Give the robot a task in the chat

!!! abstract "In this page"
    How to open the Chat card, choose a planner, keep or drop "plan only", type a task, answer the robot's questions and read the Plan progress list. Checked in code at 4a810a3717ab, not run against a robot.

The chat starts a [chat run](../reference/glossary.md#chat-run): your sentence goes to a [planner](../reference/glossary.md#planner), which writes the steps, and the robot executes them. With "plan only" on, the planner writes the plan and the robot does not move.

!!! warning "Plan only is on by default, but it is remembered"
    The first time, "plan only" is on. After you switch it off, the choice is kept for this tab and also as the default of the next new tab. When the box shows `plan only — will move` in red, the robot will move. Look at it before every task.

## Steps

1. Connect to a robot first ([Connect](connect.md)).
2. Press `💬 Chat` in the control bar of the left column. The card opens. If the robot is waiting for an answer while the card is closed, the button turns amber and shows `●`.
3. Choose the planner (only possible while idle):

    | option | meaning (from the tooltip) |
    |---|---|
    | `SAGE + assist` (default) | SAGE plans; the assist layer understands the task first, asks when it is unclear, reads it back, refuses unsafe tasks and guards every step |
    | `SAGE plain loop` | the SAGE planner in the plain closed loop, with no understanding or clarification layer |
    | `Direct` | the code gives no tooltip for it |

4. Keep `plan only` ticked to see the plan without a move. Untick it to run the plan on the robot.
5. Type the task in the box (the placeholder is `type a task, e.g. put the apple on the counter`) and press Enter or Send.
6. Watch the right-hand column. The Plan progress list fills with the steps. Each step is `pending`, `running`, `done`, `failed` or `skipped`. Lines between steps tell why the plan changed (`replan`, `recover`, `ask`). When the run ends a badge reads "Task completed" or "Task failed". A plan-only run ends with the system line `✓ planned (plan only: the robot did not move)`.
7. When the robot asks something, the card is in the state `waiting`: the placeholder reads `type your answer`, and what you type is sent as the answer (`POST /agent/listen/{id}`). With the microphone on, you can also speak ([voice](../modules/voice.md)).
8. To end the run early press Stop ([Stop a run](stop.md)).

## What the operator sees

| state | input box | placeholder |
|---|---|---|
| idle | enabled | `type a task, e.g. put the apple on the counter` |
| running | disabled | `robot is working…` |
| waiting | enabled | `type your answer` |
| stopping | disabled | `stopping…` |

Typing while the run is going and nothing is asked does nothing. The card header has `■ Stop` (`■ Stopping…` while it stops), `reset`, `clear` (log only) and a close button. Closing the card with the `x` while a run goes does not stop it: the button title says `Hide (the run keeps going)`.

!!! warning "One client per robot"
    The card says it under the input: "One client per robot: a second client driving it is unsafe, and Cancel stops both." A second client is a command-line tool or another browser tab. See [Two tabs](two-tabs.md).

## Common problems

| symptom | cause | what to do |
|---|---|---|
| the robot moved when you wanted a preview | `plan only` was off (the choice is remembered) | tick `plan only` before the task |
| the planner and plan-only controls are grey | a run is going | wait, or press Stop |
| the card says `connection to the run lost; it may still be going: Stop / reset` | the run's WebSocket dropped; the robot may still be running | press Stop, then `reset` |
| a spoken answer was not used | the robot had stopped listening (HTTP 404) | the chat shows a note; say it again when asked |
| Stop shows `Stopping…` for a long time | the backend has not sent `done` | after 5 s the button reads `Force reset` ([Stop](stop.md)) |
| a language is wrong | the language is per tab | change it in the language picker ([chat module](../modules/chat.md)) |

More: [chat module](../modules/chat.md) (states, language), [plan view](../modules/plan-view.md) (how the list is built from events), [voice](../modules/voice.md).

Checked in code at 4a810a3717ab, not run against a robot.
