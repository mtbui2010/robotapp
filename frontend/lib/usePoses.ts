'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, ROBOT_CHANGED_EVENT } from './api'
import type { PoseList } from './poses'

/** The robot's "Go to" poses (GET /poses), read once, again after an edit (`refresh`) and when another robot is picked. null until read / when unreadable. */
export function usePoses(): [PoseList | null, () => void] {
  const [list, setList] = useState<PoseList | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let alive = true
    const load = () => { api.listPoses().then(l => { if (alive) setList(l) }).catch(() => { if (alive) setList(null) }) }
    load()
    window.addEventListener(ROBOT_CHANGED_EVENT, load)
    return () => { alive = false; window.removeEventListener(ROBOT_CHANGED_EVENT, load) }
  }, [tick])
  return [list, refresh]
}
