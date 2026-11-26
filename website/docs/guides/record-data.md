# Record data and review it

!!! abstract "In this page"
    How to show the make-data tools, fill the prompt fields, generate a sample sentence, record an episode, end it as success, failure or discard, and then look at it in the Data tab. Checked in code at 4a810a3717ab, not run against a robot.

An [episode](../reference/glossary.md#episode) is one demonstration: camera images, joint states and actions, with one sentence that says what was done. The Record bar records raw episodes while you drive the robot by hand with remote control (teleop). The Data tab then lists them. The robot needs a recorder: without one, `GET /recorder` answers 404, the bar is not drawn and there is no Data tab.

!!! warning "Record starts remote control"
    Pressing Record starts remote control and the recording together, and a chosen `Go to…` pose moves the arm first. No question is asked: the code assumes that a person stands next to the robot. The Record bar and the Go to menu show no "two clients" warning (the teleop `🕹` icon has one as a hover tooltip). Use one client per robot, and know where Cancel is ([Stop](stop.md)).

## Steps: record

1. Connect to a robot with a recorder ([Connect](connect.md)). Stay on the Cameras tab.
2. Press the `⏺` button in the tab row (tooltip "Make data: show remote control and record"). It exists only when the robot has a teleop function or a recorder. The remote control strip and the Record bar appear. (They also appear by themselves while a recording or a teleop function is active.)
3. In the Record bar fill the fields of the checked row, at least `action` (the others, for example `target object`, depend on the robot). Two rows exist, so two related tasks need no retyping. One row is always checked.
4. Optional: press the sparkle button to see a sample sentence under the row; press again for another wording. It is disabled while `action` is empty. Record makes its own sentence.
5. Optional: choose a pose in `Go to…`. By default the arm goes there first and the recording starts after it arrived. Tick `rec first` to record the move too.
6. Press **Record**. The order is fixed: make the sentence, move to the pose if chosen, start the recording, turn remote control on. The button reads `going to <pose>…` during the move.
7. Drive the robot. The bar shows the sentence, a clock (`● 1:23`) and frame counts.
8. End the episode with one button:

    | button | result |
    |---|---|
    | `✔ Success` | kept, labelled success |
    | `✘ Failure` | kept, labelled failure |
    | `🗑 Discard` | thrown away |

    After a save the bar reads, for example, `saved ep_0003 (success, 0:24)` and the folder.

## Steps: review in the Data tab

1. Open the Data tab. The totals line reads `N episodes · H h · S success · F failure`. `↻` reads the list again; it does not poll.
2. Click a row to see camera frames and the joint curves. Edit the prompt in place (double-click), set the mode, trim the idle ends, exclude, or save a note. All of this is an [edit list](../reference/glossary.md#edit-list) beside the raw files; the raw files do not change, and Reset removes the edit.
3. `🗑` then `to trash?` Yes moves the episode to the trash folder. It is not a permanent delete.
4. `🧹 Auto-clean all` saves a suggested trim for every episode that has none. `Export` writes a manifest and shows a command to run on the training server; the dashboard does not run it.

The kind filter only changes the list. Auto-clean all and Export still use every episode: exclude the ones you do not want first.

## Why Record can be blocked

The button's tooltip gives the first reason that applies:

| tooltip | cause |
|---|---|
| `the recorder is not running on the robot (make run)` | the recorder is not available |
| `the shared folder cannot be written` | the robot cannot write its data folder |
| `the recorder is recording` (or `saving`) | a recording is going |
| `a run is in flight: cancel it first` | an agent run is going |
| `fill the action (and the other fields) of the checked row` | `action` is empty |

## Common problems

| symptom | cause | what to do |
|---|---|---|
| `could not go to "<pose>": <msg> (nothing is recorded)` | the move before the recording failed | fix the cause, press Record again |
| `... The recording is running and remote control is off: stop it (✘ Failure) or discard it.` | `rec first` was on and the move failed | press `✘ Failure` or `🗑 Discard`, or switch teleop on in the strip |
| the bar vanished | the robot has no recorder (404) | check the robot package |
| remote control is off after a Go to | the move failed | read the red line, press On |
| the Data tab says `Reading the recordings…` and stays | `GET /recordings` answered 404 | check the recorder; press `↻` |
| an episode is exported without its idle ends | `cut idle ends` is on and no trim is saved | switch the box off |
| the strip disappeared after one failed read | `useTeleop` empties its list on a read error | pick the robot again or press any teleop control |

More: [recorder](../modules/recorder.md), [data tab](../modules/data-tab.md), [teleop and poses](../modules/teleop-poses.md).

Checked in code at 4a810a3717ab, not run against a robot.
