# Teleoperation strip (2026-11-14)

A thin strip above the cameras for the teleop functions a robot offers: a part of the robot (arm + gripper today) driven by an input
device that is plugged into the **robot** (a SpaceMouse; any device works, the dashboard does not know which). The control loop (50 Hz)
stays on the robot (repo `robot_teleop`); the dashboard only shows state and gives three controls. The knob is never sent through the browser.

| Part | Meaning |
|---|---|
| `🕹 <label>` | the function (from the robot's `TELEOP` config group); its tooltip warns that two clients driving one robot is unsafe (rule 7) |
| state pill | `off`, `starting…` (servo settling, about 1 s), `driving`, `blocked` (stalled: let go of the knob), `not set up` (profile lacks frame / joints), `not running` (no state from the node: start robot_teleop on the robot) |
| device chip | `device ok` when the input device sent something in the last 2 s; `device silent` / `no input device` otherwise |
| gripper chip | open / closed; absent for a function without a gripper |
| mode chips (blue) | what the node reports besides on / off: `base frame` / `tool frame` (the tool-frame button is held), `line x|y|z` (an axis lock), `straight` (the straight-line button is held: only the main push axis), `no rotation` (translation only; rotation needs its button) or `rotating`. Nothing is drawn for an older node that reports none |
| speed 25 / 50 / 100% | a fraction of the speed set in the robot's profile (kcare: 5 cm/s and 0.15 rad/s at 100%); the default of a run is 100% of that slow profile speed |
| `▶ On` | asks "A person is next to the robot?" (rule 8) and then switches on; disabled while a run is in flight, or when the function is not running / not set up |
| `■ Off` | switches off at once, no question |

Nothing is drawn when the robot lists no function (`GET /teleop` returns `[]`, or fails). The list is polled every 1.5 s only while there
are functions. A run starting, and Cancel, switch every function off on the backend; switching on while a run is in flight is refused (409).

Backend: `GET /teleop`, `POST /teleop/{name}/enable {on, confirm}`, `POST /teleop/{name}/speed {scale}` (robot_agent `api/teleop.py`,
`core/teleop.py`). Code: `components/TeleopBar.tsx`, `lib/teleop.ts`, `lib/useTeleop.ts`.
