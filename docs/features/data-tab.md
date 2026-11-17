# Data tab: look at, clean and export the recorded episodes

A third tab (🗂️) next to Cameras and Map, drawn only when the robot has a recorder ([recorder](recorder.md)). It reads the raw episodes through robot_agent `/recordings`; the raw files are
never changed.

- **Table**: one row per finished episode: prompt, label (✎ when edited), **mode** (left | front | right, from the head angle when the recording started; `–` for episodes recorded before it was saved), length, idle start / end, % of the time the arm moves, the kept part (✎ when trimmed), and a ⚠ count (hover: the
  warnings: teleop switched off in the middle of the movement, a camera below 15 Hz or stopped, the servo command stopped, the arm never moved). Totals above it.
- **Click a row**: the head and wrist frame at the cursor, a ▶ player and a slider, the 7 joint curves and the gripper command (click the chart to move the cursor), the numbers (rates, max speed).
- **🧹 Auto-clean all** (top) and **🧹 cut** (one row): cut the idle start and end. A Go to pose move made during a recording is KEPT (the model should learn the init move): it is shown blue on the chart with an ℹ note, and the pose runs at the slow pose speed so it looks like the teleop around it. Raw files are untouched; every trim can be changed below. `redo saved trims` replaces trims already saved.
- **Clean** (an edit list saved BESIDE the raw folder, `<data>/edits/`): trim the start / end (type, `⇤ here` / `here ⇥` at the cursor, or `suggest`: the idle start and end with 0.5 s margin), change
  the label, exclude the episode, add a note. Only the ends are trimmed: cutting a stretch in the middle would make the joints jump. `Reset` removes the edit. Changing the frame rate is part
  of the export (below): the raw streams keep their own rates.
- **🗑 Delete** (last column of a row): asks `to trash? Yes / No` in place; Yes MOVES the episode and its edit list to `<data>/trash/<day>/<ep>`: nothing is deleted for good (the raw files are kept there; to put one back, move the folder back into `raw/<day>/`). A damaged episode (shown with its error) can be deleted too. To only leave an episode out of an export without moving it, use `exclude`.
- **Export**: a name, the rate (10-50 Hz), how the action is made (future state: the joint state `horizon` s later, the default; the servo's target; the controller's reference) and whether
  failures are included. It writes a manifest (the name starts as `vla_<date>`; `<data>/exports/<name>.json`: not excluded, accepted labels, trims) and shows the command that turns it into a LeRobot dataset on the training
  server (`robot_teleop/tools/export_lerobot.py`; see robot_teleop `docs/raw_data.md`).

Backend: `GET /recordings`, `GET /recordings/{day}/{ep}`, `GET .../frame?cam&t`, `PUT|DELETE .../edit`, `POST /recordings/export`. Helpers `frontend/lib/recordings.ts`, component `DataPanel.tsx`.
