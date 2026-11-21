'use client'
import FleetCamTile from './FleetCamTile'
import { loadChoices } from '../lib/fleetCams'
import type { FleetRobot } from '../lib/fleet_types'

// The Fleet tab's camera grid: one tile per fleet robot (docs/features/fleet.md).
export default function FleetCameras({ robots, badge }: { robots: FleetRobot[]; badge: (r: FleetRobot) => React.ReactNode }) {
  if (!robots.length) return null
  const saved = loadChoices()
  return (
    <div data-testid="fleet-cameras" className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
      {robots.map(r => <FleetCamTile key={r.id} robot={r} saved={saved[r.id]} badge={badge(r)} />)}
    </div>
  )
}
