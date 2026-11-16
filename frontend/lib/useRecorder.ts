'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, ROBOT_CHANGED_EVENT } from './api'
import type { RecorderStatus } from './recorder'

/** The robot's recorder (GET /recorder), refreshed every second while the robot has one; null when it has none (a 404 is asked once, and again when
 *  another robot is picked). ``refresh`` re-reads at once (after a click). A failed read keeps the last answer. */
export function useRecorder(): [RecorderStatus | null, () => void] {
  const [st, setSt] = useState<RecorderStatus | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      api.getRecorder().then(s => {
        if (!alive) return
        setSt(s)
        if (s) timer = setTimeout(load, 1000)
      }).catch(() => { /* keep the last answer, ask again */ if (alive) timer = setTimeout(load, 3000) })
    }
    load()
    const again = () => { if (timer) clearTimeout(timer); load() }
    window.addEventListener(ROBOT_CHANGED_EVENT, again)
    return () => { alive = false; if (timer) clearTimeout(timer); window.removeEventListener(ROBOT_CHANGED_EVENT, again) }
  }, [tick])
  return [st, refresh]
}
