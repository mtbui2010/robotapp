# Camera streaming (multiple viewers)

<!-- Moved verbatim from CLAUDE.md (lines 776-815) on 2026-10-30; links rebased to docs/features/. -->

`/ws/camera/<connect_id>` runs **one worker thread per camera**, shared by every
browser watching it ([robot_agent/api/camera.py](../../../robot_agent/robot_agent/api/camera.py)).
Each websocket used to start its own thread keyed by `connect_id`, so a second
browser tore down the first one's stream and `CameraCell`'s 1.5 s auto-reconnect
tore it back — two dashboards on one robot spent their time restarting each
other's streams (and 3 s per round joining threads), which is what made
*everything* on the robot feel slow, not just the video.

The worker now:

- encodes a frame **once per distinct depth setting** and sends the same JSON to
  every subscriber sharing it. Settings (`depth_mode`, `depth_range`) stay
  per-client, so one browser's one-shot raw-depth save does not push raw frames
  at the others;
- **skips encoding when no new frame arrived** — `TopicAgent.rev_seq`
  ([connect/ros/node.py](../../../robot_agent/robot_agent/connect/ros/node.py)) is
  bumped per message received. A viewer that just joined still gets the frame
  the worker is holding, rather than a blank panel on a stalled camera;
- **drops frames** for a client whose previous send has not completed, instead
  of queueing sends into the event loop shared with `/ws/agent` and all HTTP;
- lingers 15 s after the last viewer leaves, so a page reload or a grid ↔ tab
  switch reuses the worker instead of rebuilding it.

CPU no longer scales with the number of dashboards.

`GET /connects/status` is cached the same way: the `DevicePanel` polls it every
10 s *per browser* and a probe actively pings every device (a 1 s TCP connect for
an unreachable webrtc camera), so `DeviceManager.get_status()` now serves a
result cached for 5 s — one probe for all dashboards. The cache is dropped
whenever the device set changes (add / remove / location switch), a probe that
straddles such a change is discarded rather than cached, and a second caller
arriving mid-probe is served the previous result instead of queueing behind it.
`?fresh=1` forces a re-probe.

One cost from the same investigation is still **not** addressed: `kcare_robot`'s
`make run` passes `--reload` to uvicorn, which watches the whole (sshfs-mounted)
tree.
