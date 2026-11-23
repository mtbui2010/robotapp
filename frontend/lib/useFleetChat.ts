'use client'
// The chat card as the conversation with the fleet (docs/features/chat.md, "Chat in the Fleet view"). While `enabled` (a fleet is chosen and
// the Fleet view is open) the fleet manager's `say` events become chat lines (the page also speaks them), and a typed message is a request,
// the answer to a robot's question, or the yes / no at the plan read-back (lib/fleetChat.ts decides which). Reading never starts anything;
// only `send` does, and a plan starts only after the person's yes to a plan the chat has READ BACK to them (rule 8: nothing moves on a real
// robot before the person says so): a plan that was waiting before the chat opened is read out first (planSummary), then it waits for the yes.
import { useCallback, useEffect, useRef } from 'react'
import { fleet } from './fleet'
import { chatAction, isNo, isYes, lineOfEvent, planSummary, type FleetChatLine } from './fleetChat'
import { mergePlans } from './fleetView'
import { readTabPref } from './tabPref'
import type { FleetPlan } from './fleet_types'

const LS_OPERATOR = 'robotapp_fleet_operator'      // the name the old plan panel kept; the approval is recorded with it ('chat' when none)
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const sys = (text: string): FleetChatLine => ({ who: 'system', text })

export function useFleetChat(enabled: boolean, say: (line: FleetChatLine) => void, lang?: string) {
  const plans = useRef<FleetPlan[]>([])
  const shown = useRef<Set<string>>(new Set())        // plans whose read-back / summary this chat has shown
  const sayRef = useRef(say); sayRef.current = say

  useEffect(() => {
    if (!enabled) return
    plans.current = []; shown.current = new Set()
    let alive = true
    fleet.snapshot().then(s => {
      if (!alive) return
      plans.current = mergePlans(plans.current, s.plans)
      for (const p of s.plans) if (p.state === 'awaiting_approval' && !shown.current.has(p.plan_id)) {    // a plan from before the chat opened
        shown.current.add(p.plan_id); sayRef.current({ who: 'robot', text: planSummary(p), kind: 'say' })
      }
    }).catch(() => {})
    const sub = fleet.subscribe(e => {
      if (e.event === 'say' && e.kind === 'readback' && e.plan_id) shown.current.add(String(e.plan_id))
      const l = lineOfEvent(e)
      if (l) sayRef.current(l)
      if (e.plan_id) fleet.plan(e.plan_id).then(p => { if (alive) plans.current = mergePlans(plans.current, [p]) }).catch(() => {})
    }, () => {})
    return () => { alive = false; sub.close() }
  }, [enabled])

  const send = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text) return
    try {
      // the plans as the manager has them NOW: a "yes" typed a moment after the read-back must meet the plan that waits for it
      const s = await fleet.snapshot()
      plans.current = mergePlans(plans.current, s.plans)
    } catch (e) {
      sayRef.current(sys(`Cannot read the fleet manager: ${msgOf(e)}`))
      return
    }
    const a = chatAction(text, plans.current)
    const operator = (readTabPref(LS_OPERATOR) ?? '').trim() || 'chat'
    try {
      if (a.do === 'hint') sayRef.current(a.line)
      else if (a.do === 'submit') {
        if (isYes(a.text) || isNo(a.text)) sayRef.current(sys('Nothing is waiting for your answer. Type a request for the fleet.'))
        else await fleet.submit(a.text, lang)
      } else if (a.do === 'answer') await fleet.answer(a.planId, a.text)
      else if (a.do === 'approve') {
        const p = plans.current.find(x => x.plan_id === a.planId)
        if (p && !shown.current.has(a.planId)) {          // this chat never read that plan to the person: read it, and wait for the yes
          shown.current.add(a.planId); sayRef.current({ who: 'robot', text: planSummary(p), kind: 'say' })
        } else await fleet.approve(a.planId, operator)
      } else if (a.do === 'reject') await fleet.reject(a.planId, operator)
      else {                                              // replace: a new request while a plan waits; nothing had moved, so the old plan is dropped
        await fleet.reject(a.planId, operator)
        sayRef.current(sys(`I dropped the waiting plan ${a.planId} (nothing had moved) and take your new request.`))
        await fleet.submit(a.text, lang)
      }
    } catch (e) {
      sayRef.current(sys(`The fleet manager did not accept that: ${msgOf(e)}`))
    }
  }, [lang])

  return { send }
}
