'use client'
import { useEffect, useState } from 'react'
import { api, ROBOT_CHANGED_EVENT } from './api'
import type { RobotLanguages } from './robotLanguages'

/** The connected robot's languages (null until it answers); fetched again when another robot is picked. A failed
 *  fetch keeps the last answer. The second value switches the site's languages (PUT /robot/languages) and returns the error text, or ''. */
export function useRobotLanguages(): [RobotLanguages | null, (langs: string[]) => Promise<string>] {
  const [info, setInfo] = useState<RobotLanguages | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => { api.getRobotLanguages().then(i => { if (alive) setInfo(i) }).catch(() => { /* keep the last */ }) }
    load()
    window.addEventListener(ROBOT_CHANGED_EVENT, load)
    return () => { alive = false; window.removeEventListener(ROBOT_CHANGED_EVENT, load) }
  }, [])
  const set = async (langs: string[]): Promise<string> => {
    try { setInfo(await api.setRobotLanguages(langs)); return '' } catch (e) { return e instanceof Error ? e.message : String(e) }
  }
  return [info, set]
}
