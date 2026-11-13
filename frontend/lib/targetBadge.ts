// The robot / site badges of the Cameras | Map row. Many robots are named like their site (a "Kcare_bucheon" robot at the
// "kcare_bucheon" site): then one badge says it all. When the names DIFFER the site is not written out: a ⚠ warns instead (the robot is
// on a site that is not its own name: a tab driving the wrong site is easy to miss), with both names in its tooltip.
const norm = (s: string) => s.trim().toLowerCase()

export function targetBadges(robot: string, location?: string | null): { robot: string; location: string | null; mismatch: boolean } {
  const loc = (location ?? '').trim()
  return { robot, location: loc || null, mismatch: !!loc && norm(loc) !== norm(robot) }
}

/** The ⚠'s tooltip. */
export const mismatchTitle = (robot: string, location: string): string =>
  `The site “${location}” is not named like the robot “${robot}” — check that this tab drives the site you mean.`

/** The tooltip: both names, then where the backend is. */
export function targetTitle(robot: string, location: string | null | undefined, url: string, host?: string | null): string {
  const names = location?.trim() ? `${robot} @ ${location.trim()}` : robot
  return `${names}\n${url}${host ? ` · host ${host}` : ''}`
}
