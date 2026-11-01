# Drawer skills (kcare, 2026-10-26)

## open_drawer: one handle for both looks (2026-10-26)

`open_drawer::drawer` boxed one handle and pulled another: its first wrist look (`detect`, profile
`detect_object`, target 0.9 m) and the grasp look (`find_grasp`, `detect_grasp`, target 0.3 m) each chose on
their own — by camera distance only (`distance_sigma` 0.01; the profiles' `weight` was never passed), and the
first look's result was thrown away (its base drive was commented out). Now (kcare `_pick_helpers.locate_drawer_handle`,
`recognition._nearest_to_xyz`): the first look takes the handle whose height (base-frame z) is nearest the
ENV `handle_height` (drawers of one cabinet share the handle name; ⚠ when > 8 cm off — the log lists every
box's [x, y, z], so handle_height can be set from it; without handle_height: the profile's `weight`, score 80 %
· distance · image centre), drives the base so the handle's x (base frame) is in `drawer_x_band()` — ARM_CONFIGS `drawer_x`, else pick's
measured `approach_x.lying` [0.15, 0.7], both sides; refused beyond 0.3 m (carerobotapp's `DRAWER_RANGE`, mirrored
on the left, was in the wrist CAMERA frame in mm: in base frame it refused the kcare_bucheon handle at x 0.57; the
old commented line also had the sign reversed), and the grasp look takes the box
nearest that point (`near_xyz`, a ⚠ line when > 0.1 m away). A skill's `target_distance` / `near_point` /
`distance_sigma` / `weights` now reach the selector (`weights=True` = the profile's `weight`; pick / find do
not pass it, so their choice is unchanged). `retract_from_drawer` drives back after a drive > 5 cm (was 50 cm).
ENV of a drawer needs `handle` (detector name) and `handle_height`; without them open / close_drawer say so.
Offline test: `kaair_real_capture/drawer_handle_20261026/test_drawer_select.py`. Not yet run on the robot.

## vla_drawer_open: SmolVLA through vla-serve (2026-10-26)

`vla_drawer_open::drawer` (kcare `skills/vla.py`) drives to the ENV place, puts the robot in the trained pose
(head to the place's `default_mode` side tilted −41°, lift lowest, gripper open, `movej::approach_drawer`),
checks it (arm ≤ 5°, head ≤ 8°, gripper open) and runs the policy served by vla-serve
(`docker run --gpus all -p 11450:11450 -v /path/to/ckpt:/ckpt mtbui2010/vlaserve:latest serve --host 0.0.0.0
/ckpt/<run>/pretrained_model`; checkpoint + README: `/remote_dir/kcare_vla_open_drawer_20261026/`). It is
`vla_drawer_node_real.py` folded into the skill — its own rclpy node for the head / wrist images and joint states,
actions to the forward controllers, the trajectory controllers switched back afterwards, also on error and on the
dashboard's Cancel (watched by the skill: a forward controller is no action goal). The server is the
**`http` connection `vlaserve`** (Connections panel, its `url` = vla-serve; kcare_bucheon: `http://192.168.0.6:11450`, the dev PC — container
`vla-serve-drawer`, `--restart unless-stopped`, ~1.2 GB on the 3090, checkpoint mounted read-only from
`remote_dir/kcare_vla_open_drawer_20261026/checkpoint`; from the robot one call ≈ 210 ms, 0 stalls at 15 fps,
2026-10-26 dry run `kaair_real_capture/vla_drawer_20261026/dryrun_real_policy.py`). Settings: config group `VLA_CONFIGS.drawer_open` (Skill panel →
vla_drawer_open): `url` (overrides the connection; neither → the sim's `/drawer/open` action when the site has a
`vla_drawer_open` connection — the ros_action that had leaked into kcare_bucheon gave "action server not available"), **`execute` False = dry run** (nothing sent; README step 1), `fps` 30 (training speed; the first real run at 15,
2026-10-26, reached ~60 % of the depth and closed on air), `seconds` 15 = TRAINED-motion seconds (the run lasts
seconds × 30 / fps), `max_jump` 0.6 rad (0.35 tripped at 30 fps after 2.5 s: the real arm lags the commands), on any stop the arm's own
position is sent as the last forward command before the switch back (the trajectory controller holds the last
COMMAND: after the tripped run the arm went on 24°), `prompt` (or the place's ENV `vla_prompt`: "open the top drawer" · "open
drawer" = middle · "open the bottom drawer"); any of them per call (`…, execute=True`). A text that is no ENV
place is the prompt, run where the robot is (the old form). The vlaserve client comes from `client_path` (the copy
next to the checkpoint) when not installed. Offline test (real topics, fake policy, dry run):
`kaair_real_capture/vla_drawer_20261026/test_vla_drawer.py`. Never run with `execute` on the robot yet.
