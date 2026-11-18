# Shortcut buttons, in groups

The Button panel (second column, under the control bar) holds the robot's shortcut buttons: a label and a plan, run with one
click. They are stored on the backend (`<configs>/common/buttons.json`, shared by every machine, merged on save) and edited here.

## Groups (2026-11-13)

A button has a **group**; the groups are an ordered list in `button_groups.json` (`[{id, name}]`), so a group can be empty.
`''` is **Other**, an implicit last group: a button with no group, or whose group was deleted (another machine), is in it.

- The panel is a **row of group chips** (`Head · Mobile · Lift · Arm · Get ready · ＋`, one line in the 288 px column) and, under
  it, the **tray of the open group**: its buttons plus a `＋` cell that adds a button to that group (always shown; while the add form is open it is highlighted and a click closes the form, 2026-11-18). Click a chip to open its
  tray; click the open chip again to close it (the choice is kept in `localStorage`, `robotapp_button_group`; `-` = closed).
  One tray at a time. Other appears only when it has buttons.
- Groups: `＋` new (asks the name), hover a chip for ✎ rename / × delete: × opens a **warning box** under the bar (not `window.confirm`, which a browser can mute) that
  names the group and lists its buttons (“Its 5 buttons (fold, …) will move to **Other**; the buttons themselves are kept”) with
  *Delete group* / *Cancel*; an empty group says so. Nothing is deleted before the click. **Its buttons move to Other**, they are not deleted;
  drag a chip onto another to reorder. Names are unique, case-insensitive, and not `Other`.
- Buttons: hover for ⋮⋮ (drag to reorder in the tray, or onto a group chip to move it there), ✎ edit (label, plan, **group**), ×
  delete. The add / edit form has a group select.
- Backend (robot_agent): `GET/POST /buttons/groups`, `PUT/DELETE /buttons/groups/{id}`, `POST /buttons/groups/reorder`;
  `POST /buttons` and `PUT /buttons/{id}` take `group` (`''` = Other; `PUT` without it leaves it).
- The pure parts (tabs, a group's buttons, which tray is open, reordering) are `lib/buttonGroups.ts`, with unit tests.
- kcare's 19 buttons are in Head / Mobile / Lift / Arm / Get ready (the duplicate `pre pick` was dropped).
