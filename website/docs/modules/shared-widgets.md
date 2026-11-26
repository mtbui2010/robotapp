---
sources:
  - frontend/components/PopoverButton.tsx
  - frontend/components/PanelSearch.tsx
  - frontend/components/ExpandEditor.tsx
  - frontend/components/GuidePanel.tsx
  - frontend/lib/clipboard.ts
verified_at: 4a810a3717ab
---

# Shared widgets and the Guide

!!! abstract "In this page"
    Five small pieces that several panels share: a popover that no parent can clip, a search box for the sidebar panels, a large modal editor, a copy-to-clipboard function that works on plain `http` pages, and the Guide dialog with the seven setup steps. You get the props, the keys and clicks that each one reacts to, and where each is used. It also states what the Guide does not contain: the "two clients" warning. Read in code at commit `4a810a3717ab`; nothing was run in a browser.

## Where each one is used

| Piece | File | Used by |
|---|---|---|
| `PopoverButton` | `components/PopoverButton.tsx` | `AgentPanel` (log options and one more popover), `CameraFeed` (the camera summary button), `LanguagePicker` |
| `PanelSearch` | `components/PanelSearch.tsx` | `DevicePanel` (connections), `EnvPanel` (configs), `SkillPanel` (skills) |
| `ExpandEditor` | `components/ExpandEditor.tsx` | `AgentPanel` (two editors) |
| `GuidePanel` | `components/GuidePanel.tsx` | `app/page.tsx`, opened from the page's menu |
| `copyText` | `lib/clipboard.ts` | `GuidePanel`, `PlanPanel` |

## PopoverButton

A small button that opens a panel under it. The panel uses `position: fixed` and is placed from the button's rectangle, so a parent with `overflow: hidden` or a scroll area cannot cut it. It closes on a click outside, on Escape, on a window resize and on a scroll of any element (the scroll listener is in capture mode).

| Prop | Type | Meaning |
|---|---|---|
| `label` | node | what the button shows |
| `title` | string, optional | tooltip |
| `buttonClass` | string, optional | replaces the default button style |
| `panelClass` | string, optional | width and so on of the panel; default `w-48` |
| `testId` | string, optional | sets `data-testid` on the button, and `<testId>-panel` on the panel |
| `children` | function `(close) => node` | the content; call `close()` so that an item can close the popover |

The left edge is `max(4, min(button left, window width - 260))`, so a wide panel stays in the window; the top is the button's bottom plus 4 pixels (`PopoverButton.tsx:32`). The position is computed at the click. If the window changes while open, the popover closes instead of moving.

## PanelSearch

A search box that is shown under the header of a sidebar panel, also when the panel is folded. Typing opens the panel on the matches; clearing the box folds it back. The widget is only the input: the panel decides what "match" and "open" mean.

| Prop | Type | Meaning |
|---|---|---|
| `value` | string | the text in the box (the panel owns it) |
| `onChange` | `(v: string) => void` | called on each key; called with `''` on Escape and on the clear button (the `×`) |
| `placeholder` | string | for example `Search skills…` |

## ExpandEditor

A small `⤢` button that opens a modal editor with a line-number gutter, for long multi-line text such as a plan of about 20 steps. It is editable when `onChange` is given and read-only otherwise. The gutter works without scroll syncing: each line is drawn once more, invisible, in a row with its number, and the `textarea` lies over those rows.

| Prop | Type | Meaning |
|---|---|---|
| `value` | string | the text |
| `onChange` | `(v: string) => void`, optional | when absent, the editor is read-only |
| `title` | string, optional | modal title; default `Editor` |
| `readOnly` | boolean | default false |
| `className` | string, optional | replaces the style of the `⤢` button |

Behaviour of the modal:

- Closing keeps your edits: a click outside, Escape, and Ctrl+S or Ctrl+Enter (also Cmd on a Mac) all call `onSave`. Only the `Discard changes` button throws the edits away. This was added because an edit was lost every time the modal closed on its own (`ExpandEditor.tsx:22-25`).
- A click on the backdrop closes only when the press also began on the backdrop. Selecting text and releasing the mouse outside the box does not close it (`ExpandEditor.tsx:28-31`).
- A badge `● edited` and the line count are shown in the header. The `Done` button saves and closes.

## copyText

`copyText(text)` returns a `Promise<boolean>`: true when the text was copied. `navigator.clipboard` exists only in a secure context (HTTPS or localhost). A dashboard opened over plain `http` on a robot's address has none, so the function falls back to a hidden `textarea` and `document.execCommand('copy')`.

```ts
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* permission denied, not focused, … — try the fallback */ }
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.top = '-1000px'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    el.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}
```

!!! code "Where in the code"
    [`frontend/lib/clipboard.ts` lines 5-28](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/lib/clipboard.ts#L5-L28). The popover is [`PopoverButton.tsx`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/components/PopoverButton.tsx), the modal is [`ExpandEditor.tsx`](https://github.com/mtbui2010/robotapp/blob/4a810a3717ab/frontend/components/ExpandEditor.tsx).

## The Guide

`GuidePanel` is a modal dialog (560 px wide, at most 80% of the window height) titled `Getting Started`, with three tabs. It makes no backend call. All its text is in the source file.

| Prop | Type | Meaning |
|---|---|---|
| `open` | boolean, optional | controlled mode: the page keeps the state |
| `onOpenChange` | `(open: boolean) => void`, optional | called when the dialog opens or closes |
| `hideTrigger` | boolean, optional | no `? Guide` button of its own |

The page uses it as `<GuidePanel open={guideOpen} onOpenChange={setGuideOpen} hideTrigger />` (`page.tsx:908`). The dialog opens from the page's `⋯` menu through `onOpenGuide`. A click on the dark backdrop or on `×` closes it.

| Tab | Content |
|---|---|
| Workflow | the seven steps below, then a four-box "Execution Flow": your command, LLM plans tasks, tasks execute (parallel where safe), robot performs actions via ROS2 |
| Command Examples | five example sentences and a list of tips (name objects clearly, say the destination, chain actions, pick the language, use Structured mode to skip the LLM) |
| Config Reference | twelve example JSON configs for the `＋` (Add a connection) form |

Each example is a button; a click copies it with `copyText` and shows `✓ copied` for 1.5 seconds. If the copy fails, nothing is shown.

### The seven steps

| # | Title | What it tells you |
|---|---|---|
| 1 | Start a robot agent | run an existing robot package, or generate a new robot from the cookiecutter template |
| 2 | Register the running robot | in the Robot Agent picker, click `＋`, enter a name and the agent URL (`http://localhost:8001` if on the same machine) |
| 3 | Connect an LLM | in the Connections panel add a connection of type `LLM`; for ChatGPT or Gemini enter the API key |
| 4 | Connect to ROS | `Scan` for ROS2 endpoints and `+ add` each one, or add by hand |
| 5 | Add a camera (optional) | a WebRTC connection or a ROS image topic with `is_camera: true` |
| 6 | Tune skills & globals (optional) | the Skills panel, the Locations (ENV) panel, `⚙ Settings` in the Map tab, shortcut buttons |
| 7 | Send a command | Chat or Structured, then watch Plan progress and the Log |

### The twelve config examples

`ROS Service`, `ROS Topic (camera)`, `ROS Action`, `WebRTC Camera`, `TCP/IP (client)`, `ZeroMQ (REQ client)`, `WebSocket (client)`, `HTTP / REST`, `VisionServe (detect)`, `LLM - Llama (local)`, `LLM - ChatGPT`, `LLM - Gemini`. The form has its own fields for these values; the JSON shown is what is sent. API keys are not in the JSON: they are entered in the form and kept on the backend. The examples use example hosts; use your own address when you copy one.

### The "two clients" warning is not in the Guide

The repo's `README.md` (Safety note) says: do not run two clients against the same arm at the same time, and that "this is surfaced in the dashboard's Guide panel". At `4a810a3717ab` the Guide does not say it. Searching `GuidePanel.tsx` for `unsafe`, `two clients`, `same time` and `only one` finds nothing. The warning is in two other places:

| Where | Text (short) |
|---|---|
| Chat panel help text (`ChatPanel.tsx:16-19`) and the line under the chat input (`ChatPanel.tsx:151`) | one robot should have one client driving it; a second client (CLI, another browser) is unsafe; Stop or Cancel stops both |
| Tooltip of the `🕹` mark of a teleop function (`TeleopBar.tsx:37`) | two clients driving one robot is unsafe; Cancel stops both |

How to stay safe: drive one robot from one client at a time. Read the note in the chat panel before you start. The Map tab, the shortcut buttons and the Agent panel can also move the robot, and no such note was found there in the same search.

## Edge cases

| Symptom | Cause | Fix |
|---|---|---|
| Copy buttons show nothing | `copyText` returned false: no clipboard permission and `execCommand` blocked | use a secure context (HTTPS or localhost), or select and copy by hand |
| A popover closes while you scroll the page | the scroll listener closes it on any scroll, in any element | scroll first, then open it |
| The popover is not where you expect after a resize | it was closed by the resize; the next click computes the position again | click the button again |
| An edit in the large editor seems lost | `Discard changes` was pressed | close with Escape, Ctrl+S or `Done` to keep it |
| The Guide has no `Guide` button | the page passes `hideTrigger` | open it from the page menu |

## Tests

None. These are React components and a browser API wrapper; the repo's unit tests cover pure `lib/` modules only (see [tests](tests.md)).
