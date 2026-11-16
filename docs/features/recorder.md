# Record raw VLA episodes

A panel under the teleop strip (Cameras tab), drawn only when the robot has a recorder (`GET /recorder`, `RECORDER` config; 404 = nothing shown).

1. Fill the **fields** (the robot's config names them; kcare: `action`, `target object`, `target location`, `destination object`, `destination location`). Only `action` is required.
2. `🎲` makes a sentence from them: a **random template** that uses every filled field, with synonyms (`pick` -> `grab`, `top` -> `first`), so the same episode gets a new
   wording each time. The prompt box can be edited by hand. Pressing **● Record** with an empty prompt makes one first; after a recording the prompt is cleared, so the next
   episode is worded again.
3. **● Record** starts remote control (the teleop function the config names) and the recording together. While recording: the prompt, a clock, the camera frame counts.
4. **✔ Success** / **✘ Failure** stop remote control and save the episode with that label (failures are kept, labelled); **🗑 Discard** throws it away. `saving…` shows
   while the episode is copied to the shared folder. No confirmation is asked (see [teleop](teleop.md)).

Record is disabled, with the reason as its tooltip, when the recorder is not running on the robot, a run is in flight, or the shared folder cannot be written. The field
values are remembered in this browser only (localStorage).

Backend: `GET /recorder`, `POST /recorder/prompt {fields}`, `POST /recorder/start {prompt, meta}`, `POST /recorder/stop {label}` (robot_agent `api/recorder.py`);
the recorder itself is `robot_teleop.recorder` on the robot, writing `/remote_dir/vla_data/raw/<date>/ep_NNNN/` (raw: nothing resampled or trimmed). Helpers:
`frontend/lib/recorder.ts`, hook `useRecorder.ts`, component `RecorderBar.tsx`.
