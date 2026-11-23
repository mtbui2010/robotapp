// What a chat message means to the robot_fleet manager: its `say` events become chat lines, and a typed message
// becomes a submit / answer / approve / reject, or a hint (nothing is sent). Pure; no network.
import type { FleetEvent, FleetPlan } from './fleet_types'
import { goalLabel, groupByRobot } from './fleetView'

export interface FleetChatLine { who: 'robot' | 'user' | 'system'; text: string; kind?: 'say'; lang?: string }

// owner's chat wording, 2026-11-23; en, ko, vi
const YES_WORDS = [
  'yes y yeah yep ok okay sure go ahead start it do please now approve confirm',
  '네 예 응 좋아 좋아요 시작 해 해줘 진행',
  'có vâng ừ được bắt đầu đồng ý nhé ạ',
]
const NO_WORDS = [
  "no nope n cancel stop abort don't dont never",
  '아니 아니요 아니오 취소 중지 하지마',
  'không hủy thôi',
]
const toSet = (rows: string[]) => new Set(rows.flatMap(r => r.split(' ')))
const YES = toSet(YES_WORDS)
const NO = toSet(NO_WORDS)

/** Lower-case, punctuation (ASCII, CJK and fullwidth forms) to spaces, apostrophes kept, split into tokens. */
function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/[.,!?;:。、，．！？；：…・~]/g, ' ').split(/\s+/).filter(Boolean)
}

export const isYes = (text: string): boolean => {
  const t = tokens(text)
  return t.length > 0 && t.every(w => YES.has(w))
}
export const isNo = (text: string): boolean => {
  const t = tokens(text)
  return t.length > 0 && NO.has(t[0])
}

/** A /ws/fleet event as a chat line, or null. Only `say` events speak. */
export function lineOfEvent(e: FleetEvent): FleetChatLine | null {
  if (e.event !== 'say') return null
  const text = typeof e.text === 'string' ? e.text.trim() : ''
  if (!text) return null
  const sp = typeof e.speaker === 'string' ? e.speaker.trim() : ''
  const lang = typeof e.lang === 'string' && e.lang ? e.lang : undefined       // the language the fleet spoke in (the chat speaks the line in it)
  return { who: 'robot', text: sp && sp !== 'fleet' ? `[${sp}] ${text}` : text, kind: 'say', ...(lang ? { lang } : {}) }
}

export type ChatAction =
  | { do: 'submit'; text: string }
  | { do: 'answer'; planId: string; text: string }
  | { do: 'approve'; planId: string }
  | { do: 'reject'; planId: string }
  | { do: 'replace'; planId: string; text: string }   // a new request while a plan waits: the waiting plan is dropped (nothing had moved), the request is submitted
  | { do: 'hint'; line: FleetChatLine }

const hint = (text: string): ChatAction => ({ do: 'hint', line: { who: 'system', text } })

/** What a typed chat message means to the fleet, given the plans the chat knows (oldest first, newest last). */
export function chatAction(text: string, plans: FleetPlan[]): ChatAction {
  const msg = (text ?? '').trim()
  if (!msg) return hint('Type a request for the fleet.')
  const newest = plans.length ? plans[plans.length - 1] : undefined
  if (newest && newest.state === 'awaiting_approval') {
    if (isNo(msg)) return { do: 'reject', planId: newest.plan_id }
    if (isYes(msg)) return { do: 'approve', planId: newest.plan_id }
    // a message that opens like a yes ("ok go to the kitchen", "yes but only the first") is neither a clear yes nor a new request: ask again
    if (YES.has(tokens(msg)[0])) return hint('The fleet is waiting for you: answer yes to start the plan or no to drop it.')
    return { do: 'replace', planId: newest.plan_id, text: msg }          // anything else is a new request; it never starts the waiting plan
  }
  if (newest && newest.state === 'understanding' && newest.questions.length > 0) {
    return { do: 'answer', planId: newest.plan_id, text: msg }
  }
  return { do: 'submit', text: msg }
}

/** The plan in plain words for the chat: what it says, and which robot does which goal. Shown before a "yes" can start a plan the person
 *  has not heard read back in this chat (for example a plan made earlier, in another view). */
export function planSummary(p: FleetPlan): string {
  const parts = groupByRobot(p).map(g => `${g.robot ?? 'no robot yet'}: ${g.goals.map(n => goalLabel(n.goal)).join('; ')}`)
  return `Plan ${p.plan_id} (“${p.text}”) is waiting: ${parts.join(' | ') || 'no goals'}. Answer yes to start it or no to drop it.`
}
