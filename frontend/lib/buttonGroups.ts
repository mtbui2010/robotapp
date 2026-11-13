// Shortcut buttons in groups: the pure parts (the panel is components/ButtonPanel.tsx, the API is robot_agent's /buttons and
// /buttons/groups). A button's `group` is a group id; '' is "Other", the implicit last group that holds the buttons of no group.
export interface BtnDef { id: string; label: string; plan: string; group?: string }
export interface BtnGroup { id: string; name: string }
export interface GroupTab { id: string; name: string; count: number }

export const OTHER = ''
export const CLOSED = '-'                 // the stored choice "no tray open"

/** The group a button is really in: a group the list does not have (deleted elsewhere) reads as Other. */
const groupOf = (b: BtnDef, groups: BtnGroup[]): string => (b.group && groups.some(g => g.id === b.group) ? b.group : OTHER)

/** The tabs of the group bar: every group in order, then Other when some button is in it. */
export function groupTabs(groups: BtnGroup[], buttons: BtnDef[]): GroupTab[] {
  const tabs = groups.map(g => ({ id: g.id, name: g.name, count: buttons.filter(b => groupOf(b, groups) === g.id).length }))
  const other = buttons.filter(b => groupOf(b, groups) === OTHER).length
  return other > 0 || groups.length === 0 ? [...tabs, { id: OTHER, name: 'Other', count: other }] : tabs
}

/** The buttons of one group, in the list's order. */
export const buttonsOf = (buttons: BtnDef[], groups: BtnGroup[], groupId: string): BtnDef[] =>
  buttons.filter(b => groupOf(b, groups) === groupId)

/** Which tray is open: the stored choice when it still exists (or the closed marker), else the first group that has buttons. */
export function openGroup(stored: string | null, tabs: GroupTab[]): string {
  if (stored === CLOSED) return CLOSED
  if (stored !== null && tabs.some(t => t.id === stored)) return stored
  return (tabs.find(t => t.count > 0) ?? tabs[0])?.id ?? CLOSED
}

/** The whole list with `dragId` moved to where `targetId` is (the order the server stores); null when either is missing. */
export function reorderBefore(buttons: BtnDef[], dragId: string, targetId: string): BtnDef[] | null {
  const from = buttons.findIndex(b => b.id === dragId), to = buttons.findIndex(b => b.id === targetId)
  if (from < 0 || to < 0 || from === to) return null
  const next = buttons.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** The group ids in the order after moving `dragId` to where `targetId` is; null when nothing changes. */
export function reorderGroupIds(groups: BtnGroup[], dragId: string, targetId: string): string[] | null {
  const ids = groups.map(g => g.id)
  const from = ids.indexOf(dragId), to = ids.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return null
  ids.splice(from, 1)
  ids.splice(to, 0, dragId)
  return ids
}
