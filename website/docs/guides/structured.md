# Run a structured plan and use shortcut buttons

!!! abstract "In this page"
    How to write a plan yourself, one step per line, run it from the Agent panel (once, N times or forever), save presets, and use the shortcut buttons. Checked in code at 4a810a3717ab, not run against a robot.

A [structured run](../reference/glossary.md#structured-run) sends your plan text as it is. No planner writes it. A step is one line `skill::params`, for example `say::inputs='hello', lang='en'` or `wait::1`.

!!! warning "These runs move the robot"
    The Agent panel runs with plan only off. The Run button and every shortcut button can move the robot, and neither panel shows the "two clients" warning. Use one client per robot, and keep Cancel in reach ([Stop](stop.md)).

## Steps: the Agent panel

1. Connect to a robot ([Connect](connect.md)).
2. In the Agent panel (top of the main area) click cell 1 or cell 2. The cell with the blue border is the active one. Only two cells are drawn (cell 1 has the placeholder `find::apple`, `navigate::kitchen`, `pick::cup`).
3. Write one step per line. `⤢` opens a larger editor; closing it keeps your edits.
4. Set the options in the capture row:

    | control | default |
    |---|---|
    | `log` (data log) | on |
    | `save in` | `frontend` (browser download) or `backend` (a folder on the server); default `frontend` |
    | `runs` | `failed only` (or `all`) |
    | repeat | `×1`; also `×N` (N at least 1, default 2) and `∞` |
    | `keep on error` (for `×N` and `∞`) | off: the loop stops at the first failed run |
    | `rec screen` | off |

5. Press Run, or Ctrl+Enter inside a cell. Only the **active cell** is sent. If a cell holds more than 3 lines with `::`, an amber badge `N steps` warns that lines below the fold also run.
6. While it runs the button reads `Stop`. A repeat shows a counter `trial` or `trial/N`.
7. Follow the steps in the Plan progress list ([plan view](../modules/plan-view.md)).

## Presets

The select `Presets` loads a saved plan into the active cell. The `⋯` menu has Save as…, Rename, Delete, Export (`presets.json`), Import and, when offered, `? Guide`. Presets live in this browser only: use Export and Import to move them.

## Steps: shortcut buttons

1. Find the buttons in the left column under the control bar. A chip per group; click a chip to open its tray, click it again to close it.
2. Click a button to run its plan.
3. Add a button with the add form of the tray. Use `+` for a group. Drag a button before another one to reorder, onto a chip to change its group. `×` on a chip asks first; its buttons move to `Other`.

!!! note "Buttons run silently"
    A button run is fixed: language `en`, planner `grace`, **no data log**, one repeat, no voice, no screen recording, whatever the Agent panel boxes say. Use the Agent panel when you want a data log. Buttons and groups are stored on the robot's backend, so each robot has its own set.

## Common problems

| symptom | cause | what to do |
|---|---|---|
| Run sent a different plan than expected | Run sends the active cell only | click the cell you want first |
| steps below the cell's fold ran | the cell shows about two lines | watch the amber `N steps` badge |
| a button left no data log | button runs have logging off | run the plan from the Agent panel |
| `Robot unreachable — connect a robot to load buttons.` | the button list call failed | connect a robot ([Connect](connect.md)) |
| presets missing on another computer | presets are in browser storage | Export and Import |
| the loop stopped after one failure | `keep on error` is off | tick it for `×N` or `∞` |
| cell 3 or 4 never shows | only two cells are drawn | use cells 1 and 2, or presets |

More: [structured runs and buttons](../modules/structured-runs.md), [plan view](../modules/plan-view.md), [page](../modules/page.md).

Checked in code at 4a810a3717ab, not run against a robot.
