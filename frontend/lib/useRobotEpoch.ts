'use client'
import { useEffect, useState } from 'react'
import { ROBOT_CHANGED_EVENT } from './api'

/** A number that goes up each time the robot this tab talks to changes (another robot picked, or the active robot's name / URL edited).
 *  Use it as a React `key` on a panel that opens connections when it mounts (camera sockets, map): the panel is then rebuilt for the
 *  new robot at once, with no page refresh. */
export function useRobotEpoch(): number {
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    const bump = () => setEpoch(e => e + 1)
    window.addEventListener(ROBOT_CHANGED_EVENT, bump)
    return () => window.removeEventListener(ROBOT_CHANGED_EVENT, bump)
  }, [])
  return epoch
}
