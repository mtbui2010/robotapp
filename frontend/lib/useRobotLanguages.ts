'use client'
import { useEffect, useState } from 'react'
import { api, ROBOT_CHANGED_EVENT } from './api'
import type { RobotLanguages } from './robotLanguages'

/** The connected robot's languages (null until it answers); fetched again when another robot is picked. A failed
 *  fetch keeps the last answer. */
export function useRobotLanguages(): RobotLanguages | null {
  const [info, setInfo] = useState<RobotLanguages | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => { api.getRobotLanguages().then(i => { if (alive) setInfo(i) }).catch(() => { /* keep the last */ }) }
    load()
    window.addEventListener(ROBOT_CHANGED_EVENT, load)
    return () => { alive = false; window.removeEventListener(ROBOT_CHANGED_EVENT, load) }
  }, [])
  return info
}
