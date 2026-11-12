// The languages the connected robot talks in, from its manifest (GET /robot/languages): the picker's options and the
// default of a tab that has not chosen. Pure helpers: the fetch is `api.getRobotLanguages`, the hook is useRobotLanguages.
export interface RobotLanguages {
  robot: string
  language: string          // the robot's default (manifest `language`)
  languages: string[]       // every language it talks in, the default first (manifest `languages`)
}

/** The language to use: the tab's own choice when this robot supports it, else the robot's default.
 *  No answer from the robot yet: the stored choice, else English. */
export function resolveLanguage(stored: string | null, info: RobotLanguages | null): string {
  const s = (stored ?? '').trim().toLowerCase()
  if (!info) return s || 'en'
  return s && info.languages.includes(s) ? s : info.language
}

/** What the picker shows for a code: 'ko' -> 'KO'. */
export const languageLabel = (code: string): string => code.toUpperCase()

/** The picker's options: the robot's languages, plus `current` when it is not one of them (so the select is never blank). */
export function languageOptions(info: RobotLanguages | null, current: string): string[] {
  const list = info ? info.languages : []
  return list.includes(current) || !current ? list : [...list, current]
}
