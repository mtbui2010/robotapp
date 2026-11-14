// The languages the connected robot talks in (GET /robot/languages): the picker's options and the default of a tab that has
// not chosen. The manifest says what the robot CAN talk in (`supported`); the site switches some off (`languages` = what is on,
// changed with PUT /robot/languages). Pure helpers: the fetches are `api.getRobotLanguages` / `api.setRobotLanguages`, the hook is
// useRobotLanguages.
export interface RobotLanguages {
  robot: string
  language: string          // the default (manifest `language`; the first one on when the site switched it off)
  languages: string[]       // the languages this site has on, the default first; [] when the manifest names none
  supported?: string[]      // every language the manifest lists (what can be switched on)
  declared?: boolean        // false: the manifest says nothing about languages (only Detect is offered)
}

/** 'auto' = Detect: the robot follows the language the user speaks (among the languages that are on). */
export const LANG_AUTO = 'auto'

/** The language to use: the tab's own choice when it is on offer, else Detect. No answer from the robot yet: the stored
 *  choice, else English. */
export function resolveLanguage(stored: string | null, info: RobotLanguages | null): string {
  const s = (stored ?? '').trim().toLowerCase()
  if (!info) return s || 'en'
  return s && languageOptions(info, '').includes(s) ? s : LANG_AUTO
}

/** What the picker shows for a code: 'ko' -> 'KO', 'auto' -> 'Detect'. */
export const languageLabel = (code: string): string => code === LANG_AUTO ? 'Detect' : code.toUpperCase()

/** The picker's options: Detect first (always, whatever the manifest names), then the languages that are on; `current` is added
 *  when it is not one of them (so the select is never blank). */
export function languageOptions(info: RobotLanguages | null, current: string): string[] {
  const opts = info ? [LANG_AUTO, ...info.languages] : []
  return opts.includes(current) || !current ? opts : [...opts, current]
}

/** Every language the manifest lists (what the site may switch on or off); falls back to the ones that are on. */
export const supportedLanguages = (info: RobotLanguages | null): string[] => info ? (info.supported ?? info.languages) : []

/** `code` switched on / off in the list of the languages that are on, in the manifest's order; null when that is not allowed
 *  (the last language cannot be switched off, a code the manifest lacks cannot be switched on). */
export function toggleLanguage(info: RobotLanguages, code: string): string[] | null {
  const sup = supportedLanguages(info)
  if (!sup.includes(code)) return null
  const on = info.languages.includes(code)
  if (on && info.languages.length <= 1) return null
  return sup.filter(l => l === code ? !on : info.languages.includes(l))
}

/** The language speech is spoken in (browser voice, speaking rate): Detect speaks the robot's default until a phrase is heard. */
export function speechLanguage(lang: string, info: RobotLanguages | null, heard?: string | null): string {
  if (lang !== LANG_AUTO) return lang
  return heard || info?.language || 'en'
}
