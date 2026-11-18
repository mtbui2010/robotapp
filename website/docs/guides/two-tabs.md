# Use two tabs

!!! abstract "In this page"
    What each browser tab keeps for itself, how to drive two robots from two tabs, how to read the robot badge and the mismatch warning, and why two tabs on one robot are unsafe. Checked in code at 4a810a3717ab, not run against a robot.

Each tab of the dashboard keeps its own choice of robot, language, planner and "plan only". The tab stores them in `sessionStorage`. The browser's `localStorage` only holds the last choice as the default of a tab that has none yet (`lib/tabPref.ts`).

## What a tab keeps

| setting | this tab (`sessionStorage`) | default for a new tab (`localStorage`) |
|---|---|---|
| active robot | `robotapp_active_robot` | the same key |
| language | `robotapp_lang` | the same key |
| planner | `robotapp_planner` | the same key |
| plan only | `robotapp_plan_only` | the same key |

The list of robots (`robotapp_robots`) is shared by all tabs. See [browser storage](../reference/browser-storage.md).

Why it is built like this: with `localStorage` only, choosing English in one tab changed another tab at its next reload, and a Korean session turned English by itself. A tab that has not chosen yet pins what it started with, so a reload does not take another tab's choice.

## Steps: two robots, two tabs

1. Add both robots in the Devices panel of any tab ([Connect](connect.md)).
2. In tab 1 pick robot A. In tab 2 pick robot B. Each tab now calls its own robot.
3. Look at the badge `🤖 <name>` on the tab row of each tab. Hover it: it shows the robot, the site, the URL and the host.
4. Give each tab its own tasks. Cancel in a tab calls `POST /agent/cancel` on **that tab's** robot.

## The badge and the mismatch warning

The badge shows the robot name. When the active site has a different name from the robot, a `⚠` appears next to it (the comparison ignores case and surrounding spaces). Its tooltip reads: `The site “<site>” is not named like the robot “<robot>” — check that this tab drives the site you mean.` No site name from the backend gives no warning.

## Two tabs on one robot

!!! warning "Do not drive one robot from two clients"
    A second tab is a second client. The Cancel on the backend is process-wide: a Cancel in one tab stops what the other started. The code says in the chat card: "One client per robot: a second client driving it is unsafe, and Cancel stops both." At this commit that text is visible only in the chat card. The teleop strip has it as a hover tooltip. The Agent panel, the shortcut buttons, the Map tab and the Record bar show no such warning, and all of them can move the robot.

The tab-row Cancel is always live, so you can use it from a tab that shows no run. Using two tabs for reading (for example one on the Data tab, one on the camera) is not driving; the Data tab does not move the robot.

## Common problems

| symptom | cause | what to do |
|---|---|---|
| a new tab starts on the robot you used last | the last choice is the default of a new tab | pick the robot in the new tab |
| another tab changed my language | it should not: each tab keeps its own | reload and pick the language again |
| both tabs show the same robot | both picked the same one | pick another robot in one tab |
| a `⚠` next to the badge | the site is not named like the robot | read the tooltip; check the site |
| a Cancel stopped something I did not start here | the other tab or a command-line tool shares the robot | stop using two clients on one robot |
| the robot list changed in all tabs | the list is shared | intended |

More: [chat module](../modules/chat.md) (language per tab), [robots and connections](../modules/robots-connections.md) (the badge), [page](../modules/page.md).

Checked in code at 4a810a3717ab, not run against a robot.
