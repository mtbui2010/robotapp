'use client'
import { useCallback, useEffect, useState } from 'react'
import { FLEET_CHANGED_EVENT, getActiveFleetName, listFleets, removeFleet, setActiveFleet } from '../lib/fleetRegistry'
import type { FleetDef, SyncResult } from '../lib/fleet_types'

/** The fleets of the selector: the list, this tab's fleet, the editor that is open and the last sync note. */
export function useFleets(onChosen?: (name: string) => void) {
  const [fleets, setFleets] = useState<FleetDef[]>([])
  const [active, setActive] = useState('')
  const [editor, setEditor] = useState<{ original: string | null } | null>(null)
  const [note, setNote] = useState<{ fleet: string; sync: SyncResult } | null>(null)
  const reload = useCallback(() => { setFleets(listFleets()); setActive(getActiveFleetName()) }, [])
  useEffect(() => {
    reload()
    window.addEventListener(FLEET_CHANGED_EVENT, reload)
    return () => window.removeEventListener(FLEET_CHANGED_EVENT, reload)
  }, [reload])
  return {
    fleets, active, editor, note, reload,
    /** Choose a fleet (it takes the place of the robot in this tab); the Fleet tab opens on its manager. */
    choose(name: string) { setActiveFleet(name); reload(); onChosen?.(name) },
    /** Back to a robot. */
    clear() { if (getActiveFleetName()) { setActiveFleet(''); reload() } },
    remove(name: string) { removeFleet(name); setNote(null); reload() },
    openEditor: (original: string | null) => setEditor({ original }),
    closeEditor: () => { setEditor(null); reload() },
    setNote: (fleet: string, sync: SyncResult) => { setNote({ fleet, sync }); reload() },
  }
}
