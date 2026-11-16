'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, ROBOT_CHANGED_EVENT } from './api'
import type { TeleopFunction } from './teleop'

/** The robot's teleop functions, refreshed every 1.5 s while there are any (a robot with none is asked once, and again when another
 *  robot is picked). ``refresh`` re-reads at once (after a click). A failed read keeps the last answer. */
export function useTeleop(): [TeleopFunction[], () => void] {
  const [fns, setFns] = useState<TeleopFunction[]>([])
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      api.getTeleop().then(f => {
        if (!alive) return
        setFns(f)
        if (f.length) timer = setTimeout(load, 1500)
      }).catch(() => { if (alive) { setFns([]) } })
    }
    load()
    const again = () => { if (timer) clearTimeout(timer); load() }
    window.addEventListener(ROBOT_CHANGED_EVENT, again)
    return () => { alive = false; if (timer) clearTimeout(timer); window.removeEventListener(ROBOT_CHANGED_EVENT, again) }
  }, [tick])
  return [fns, refresh]
}
