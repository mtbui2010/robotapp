'use client'
import FleetCamTile from './FleetCamTile'
import { loadChoices } from '../lib/fleetCams'
import type { FleetRobot } from '../lib/fleet_types'

// The Fleet tab's camera grid: one tile per fleet robot, `cols` tiles on a row across the full width, the robot's own information
// (`info`) under its camera (docs/features/fleet.md).
export default function FleetCameras({ robots, cols, badge, info }: {
  robots: FleetRobot[]; cols: number; badge: (r: FleetRobot) => React.ReactNode; info: (r: FleetRobot) => React.ReactNode }) {
  if (!robots.length) return null
  const saved = loadChoices()
  return (
    <div data-testid="fleet-cameras" className="grid gap-2 w-full" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {robots.map(r => <FleetCamTile key={r.id} robot={r} saved={saved[r.id]} badge={badge(r)} info={info(r)} />)}
    </div>
  )
}
