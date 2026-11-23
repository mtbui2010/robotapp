# VLA stack skill: `vla_stack` (kcare, 2026-11-18)

Stacks the cups with the pi0.5 policy `kcare-stack-4999`, served by vlaserve (`POST /v1/act`). Tested on the robot
2026-11-18: one run of step 4999 stacked the two cups (step 1000 did not grasp); more trials are still needed. Offline tests:
`kcare_robot/tests/test_vla_stack.py`.

**Before a run:** the lift and the head must be at the height / angle of the recorded episodes (the head image must show
the cabinet and both cups); the model sees only the arm joints, so the skill cannot tell. Warm the model first (first
call loads + compiles ~30 s): `vlaserve` `reset` + one `act`.

## Run

- `vla_stack` **moves the arm** (execute is True by default since 2026-11-19: forward controllers; someone at the e-stop; the start pose is checked; the dashboard's Cancel stops it).
- `vla_stack::execute=False` is a **dry run**: it reads the cameras and joints, asks the policy, checks, logs, and sends nothing.
- Any setting per call: `vla_stack::stack the cups, fps=15, seconds=30, model='...'` (the text after `::` is the task; options follow it after a comma).

## Settings: config group `VLA_CONFIGS.stack` (Skill panel)

`connection` (saved `http` connection `vlaserve`, its url is the server) / `url` (overrides it), `model`, `prompt`
(None = not sent, the manifest default is used), `execute` (False), `fps` 30, `seconds` (the cap, in trained-motion seconds: the
run lasts seconds x 30 / fps), `stop` (when the task is done: not set = vlaserve's default, the gripper closed and opened again or any motion, then 5 s of stillness; a dict changes the numbers, `False` = only `seconds` / Cancel; the message ends with `; ended: <why>`), `speed_limit` rad/s, `max_jump` rad (a real run stops when a target is farther from
the arm), `client_path` (when `vlaserve.client` is not installed), `cameras`, `image_wh`, joint / topic / controller
names, `gripper_range`, `start_pose`. Every number has its source in `configs/tasks.py`.

`start_pose` = per-joint min / max of the first frames of the 26 training episodes + a margin (`assumed`). The skill
refuses to execute when the arm is outside it (a dry run reports it). Without `start_pose` nothing is checked (logged).

## Contract with the vlaserve model manifest

The client sends frames **as captured** (head and wrist 848x480, RGB); the server applies the manifest's
preprocessing (square crop of the head image by mode, wrist rotated 180 deg). `state` = 8 floats (joint1..7 [rad],
`virtual_gripper_joint` [m]); `context.mode` = the robot mode (left / right / front); `task` only with a prompt.
The reply `actions` is (30, 8): absolute joint targets at 30 Hz (gripper width 0..0.1 m), run by `ChunkExecutor`.

On any stop (end, error, Cancel, max_jump) the arm's own position is sent as the last command and the trajectory
controllers are switched back (from the deleted `vla_drawer_open`, 2026-10-26: the arm went on 24 deg without it).

## `pi0.5_act`: one skill for every task the multi-task model knows (2026-11-19)

`pi0.5_act::open the middle drawer` runs the multi-task policy (`kcare-sd-<step>`: stack the cups + open / close a drawer, trained on
56 episodes) through the same loop as `vla_stack`. The **text after `::` is the task (the prompt) and is required** (the model has no default prompt: a call
without it does nothing and lists what is known; options may follow it: `pi0.5_act::close the drawer, execute=False`). It **moves the arm by default**; `execute=False` is a dry run. Settings: `VLA_CONFIGS.act` (Skill panel); the robot-side numbers
are shared with `vla_stack` (`_VLA_ROBOT` in `kcare_robot/configs/tasks.py`).

- **Start pose:** every task starts at one pose (stack, drawer); the arm must be at **one of them** (`start_pose` is a list), else a real run refuses.
- **Early end:** vlaserve's stop function (`docs/stop.md` of vlaserve): the gripper closed, opened again and the arm stood still, or the arm moved and then stood still for 5 s (this also ends a close-drawer run). 5 s because a teleoperator pauses 3 s in the middle of most demos.
- **Crop offset:** the model was trained with the head crop 60 px of a 1280x720 frame; the skill sends 848x480 frames, so the served manifest uses
  60 x 848 / 1280 = 40 px (`vla_data/finetune/serve/models/kcare-sd-*/manifest.yaml`).
- **Not tested on the robot.** Offline check of the served model: `vla_data/finetune/inspect/sd_offline_check.py`.
