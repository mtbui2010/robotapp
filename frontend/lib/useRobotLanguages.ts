'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, ROBOT_CHANGED_EVENT } from './api'
import { NO_EDITS, type LangEdits, type RobotLanguages } from './robotLanguages'

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

const KEY = (robot: string) => `robotapp_lang_edits:${robot}`

function readEdits(robot: string): LangEdits {
  try {
    const j = JSON.parse(localStorage.getItem(KEY(robot)) ?? 'null')
    const ok = (a: unknown): a is string[] => Array.isArray(a) && a.every(x => typeof x === 'string')
    return j && ok(j.added) && ok(j.removed) ? { added: j.added, removed: j.removed } : NO_EDITS
  } catch { return NO_EDITS }
}

/** The user's added / removed languages for this robot, kept in the browser (per robot name). */
export function useLanguageEdits(robot: string | undefined): [LangEdits, (e: LangEdits) => void] {
  const [edits, setEdits] = useState<LangEdits>(NO_EDITS)
  useEffect(() => { setEdits(robot ? readEdits(robot) : NO_EDITS) }, [robot])
  const save = useCallback((e: LangEdits) => {
    setEdits(e)
    if (!robot) return
    try { localStorage.setItem(KEY(robot), JSON.stringify(e)) } catch { /* no storage: kept for this page only */ }
  }, [robot])
  return [edits, save]
}
