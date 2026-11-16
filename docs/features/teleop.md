# Teleoperation strip (2026-11-14)

One row per function, no text labels: a `🕹` icon (its tooltip names the function), the blue mode chips, a **gripper switch icon** (✋ + green switch = open, ✊ + grey switch =
closed; read-only, absent for a function without a gripper), the device only when something is wrong (`device silent` / `no input device`), and at the right the speed drop-down
(`(gauge icon) 50%`, tooltip "Speed") the input device's battery (`🔋 82 %`, amber at 20 % or less; only when the node reports it), and ONE button that also says what the function is doing: `▶ On` (one click switches on: no question is asked), then `● driving` (click: switch off; amber
`starting…` / `blocked` while settling or stalled), `not running` / `not set up` (disabled). The battery chip sits beside the speed (tooltip: when it was last reported) and shows when the
node reports `battery` (0..1, from the device's own report, 3 bytes `17 <percent> <status>`) in its state; the tooltip says when it was last reported (the device reports now and then). No `charging` flag: its byte is not understood. It needs `make battery` on the robot (a root process reads /dev/hidraw*).

A thin strip above the cameras for the teleop functions a robot offers: a part of the robot (arm + gripper today) driven by an input
device that is plugged into the **robot** (a SpaceMouse; any device works, the dashboard does not know which). The control loop (50 Hz)
stays on the robot (repo `robot_teleop`); the dashboard only shows state and gives three controls. The knob is never sent through the browser.

| Part | Meaning |
|---|---|
| `🕹 <label>` | the function (from the robot's `TELEOP` config group); its tooltip warns that two clients driving one robot is unsafe (rule 7) |
| state pill | `off`, `starting…` (servo settling, about 1 s), `driving`, `blocked` (stalled: let go of the knob), `not set up` (profile lacks frame / joints), `not running` (no state from the node: start robot_teleop on the robot) |
| device chip | `device ok` when the input device sent something in the last 2 s; `device silent` / `no input device` otherwise |
| gripper chip | open / closed; absent for a function without a gripper |
| `Go to…` drop-down | the poses of `GET /poses`: each is a name + a PLAN of steps written like a shortcut button's plan, **all editable**. Picking one runs it at once (`POST /poses/{id}/run`: teleop is switched off, the arm moves at the one pose speed, no question is asked) and, when it is reached, switches remote control on again by itself (not after a failed move; the error shows in the red line). `✎ Edit poses…` opens the editor: ＋ New pose (name + one step per line; `a::x&&b::y` runs two together), ✎ edit, × delete (asks), **speed for all** (10–100%, default slow: a pose recorded in a training episode should look like the teleop around it), `↺ restore defaults` (the robot package's starting poses). Disabled while a run is in flight or the arm is moving (`moving…`) |
| mode chips (blue) | what the node reports besides on / off: `heading frame` (the default: forward along the gripper heading, up = world up, rotation about the hand: a wrist roll never turns the push) / `base frame` / `tool frame` (the tool-frame button is held), `line tool z` / `line base x|y|z` (a selected straight line: the knob forward / back drives it), `one axis` (only the axis pushed most is used), `twist rolls` (the knob twist rolls the hand about the gripper axis; tilting needs the rotation button) or `no rotation` (translation only; rotation needs its button) or `rotating`. Nothing is drawn for an older node that reports none |
| speed (a drop-down: 25 / 50 / 100%) | a fraction of the speed set in the robot's profile (kcare: 5 cm/s and 0.15 rad/s at 100%); the default of a run is 100% of that slow profile speed |
| `▶ On · 🔋 78%` | the input device's battery (`⚡` while charging; amber when 20 % or less) is written on the On / Off button **only when the node reports it** (`battery` 0..1 and optional `charging` in the teleop state; nothing is drawn or guessed otherwise: a wired device or an older node shows a plain `▶ On`). Switches on at once (no question: see below); disabled while a run is in flight, or when the function is not running / not set up |
| `■ Off` | switches off at once, no question |

Nothing is drawn when the robot lists no function (`GET /teleop` returns `[]`, or fails). The list is polled every 1.5 s only while there
are functions. A run starting, and Cancel, switch every function off on the backend; switching on while a run is in flight is refused (409).

Backend: `GET /teleop`, `POST /teleop/{name}/enable {on, confirm}`, `POST /teleop/{name}/speed {scale}` (robot_agent `api/teleop.py`,
`core/teleop.py`). Code: `components/TeleopBar.tsx`, `lib/teleop.ts`, `lib/useTeleop.ts`.

**Backend contract (open):** the dashboard only displays `state.battery` / `state.charging`. Today robot_teleop does not publish them (no battery key in `robot_teleop/protocol.py`), so the button shows no battery until the node reads the device's charge (a wireless SpaceMouse reports it through its vendor driver) and adds the two keys; see [backend_coupling](../backend_coupling.md) if a workaround is ever tempted: there is none in the UI (rule 3).

**No confirmation (decision of the operator, 2026-11-16):** the dashboard never asks "A person is next to the robot?" for teleop (On, or going to a pose): a robot driven remotely always has a person next to it. The strip sends `confirm: true` itself, because `POST /teleop/{name}/enable` still takes the flag (robot_agent's contract; another client may want the question).
