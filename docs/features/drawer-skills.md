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

(2026-11-18: the `vla_drawer_open` skill, its `VLA_CONFIGS` group, the sim `/drawer/open` connection and its vla-serve container were removed. Policies are served by the new vlaserve container; see its own docs.)
