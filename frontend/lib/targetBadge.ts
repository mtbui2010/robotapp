// The robot / site badges of the Cameras | Map row. Many robots are named like their site (a "Kcare_bucheon" robot at the
// "kcare_bucheon" site): then the site is not shown again, one badge says it all (the tooltip still names both).
const norm = (s: string) => s.trim().toLowerCase()

export function targetBadges(robot: string, location?: string | null): { robot: string; location: string | null } {
  const loc = (location ?? '').trim()
  return { robot, location: loc && norm(loc) !== norm(robot) ? loc : null }
}

/** The tooltip: both names, then where the backend is. */
export function targetTitle(robot: string, location: string | null | undefined, url: string, host?: string | null): string {
  const names = location?.trim() ? `${robot} @ ${location.trim()}` : robot
  return `${names}\n${url}${host ? ` · host ${host}` : ''}`
}
