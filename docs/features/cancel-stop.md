# Cancel / Stop

<!-- Moved verbatim from CLAUDE.md (lines 712-775) on 2026-10-30; links rebased to docs/features/. -->

Closing the agent WebSocket never reached the robot: the plan runs in a backend
thread (`UnifiedAgent.run`), so the skill in flight finished and every remaining
step still executed. Stopping is now explicit — `POST /agent/cancel`
(`api.cancelRun`), sent by the Agent panel's **Stop** and by the always-live
**Cancel** button (right end of the Cameras / Map tab row), and also triggered backend-side when the agent
WebSocket disconnects mid-run (reload, closed tab, dropped network).

The backend side is [robot_agent/core/run_control.py](../../../robot_agent/robot_agent/core/run_control.py)
plus `CustomNode.cancel_all()`
([connect/ros/node.py](../../../robot_agent/robot_agent/connect/ros/node.py)), which:

- cancels every in-flight **action goal** in two steps: `cancel_goal_async()` on
  the handles this process holds, then a **CANCEL_ALL** on the action's own
  `<conn_name>/_action/cancel_goal` service (zero uuid + zero stamp — the Python
  form of the `ros2 service call ... action_msgs/srv/CancelGoal` command), which
  also stops goals this process never held: sent by another client, or left
  running across a backend restart. The kcare servers (`arm_moveJ/T/L`,
  `lift_move`, `head_move`, `navigate_to_pose`) accept both and stop the motion;
  a cancelled goal's Result is reported as a failure instead of being decoded as
  a success. Agents are cancelled in parallel, so one unreachable action cannot
  hold up the rest;
- drops the **service** calls being waited on, so the skill unwinds at once;
- sets a node-wide flag, so an action / service agent **refuses to send** while
  cancelled — a skill mid-sequence cannot start a fresh motion;
- releases any HRI skill blocked on the dashboard microphone.

The flag is process-wide (one robot per process), so Cancel also stops a skill
started from the CLI or a second client. It is cleared by `begin_run()` at every
entry point (`/ws/agent`, `POST /skill/<name>`, `POST /agent/<name>/send`), so a
cancel never leaks into the next command. A cancelled run ends with
`done{status:'aborted'}`; the closed loop stops instead of replanning.

**Per-connection `cancel_func`.** A ROS *action* connection can define its own
cancel, edited in the `DevicePanel` add/edit form next to `encode_func` /
`decode_func` and stored in `connections.json` the same way (templates in
[frontend/lib/ros_templates.json](../../frontend/lib/ros_templates.json) carry a
sample):

```python
def cancel_func(node, agent):        # return True if a stop was sent
    return agent.cancel_all_goals()  # what the default does
```

Creating a ROS *action* connection (add form or quick-connect from a ROS scan)
prefills the box with that sample, so a new action starts from a working stop
rather than a blank editor; editing an existing connection leaves whatever it
already has. kcare's `mobile_move` (`/navigate_to_pose`) carries it filled in.

It **replaces** the default for that connection, so cancel the goal handles
yourself if you still want that
(`for h in list(agent._goal_handles): h.cancel_goal_async()`). Leaving the box
empty is also fine — the backend default is exactly what the sample spells out.

**Limitation — mobile services.** `mobile/shift_pose`, `mobile/rotate` and
`mobile/absolute_rotate` are ROS *services*, which have no cancel protocol.
Cancelling stops the client waiting, but `slamtec_bridge.py` keeps publishing
`/cmd_vel` for the whole duration of a shift, and its only stop command
(`/slamware_ros_sdk_server_node/cancel_action`) lives in the slamware ROS
domain, which `robot_agent` cannot reach. Making the base stop on cancel needs a
stop service on the robot side (`keti_assist_ai_robot_ros2`); once it exists,
register it with `node.add_cancel_hook(...)` — no change needed here.
