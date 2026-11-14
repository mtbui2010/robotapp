// The languages the connected robot talks in, from its manifest (GET /robot/languages): the picker's options and the
// default of a tab that has not chosen. Pure helpers: the fetch is `api.getRobotLanguages`, the hook is useRobotLanguages.
export interface RobotLanguages {
  robot: string
  language: string          // the robot's default (manifest `language`)
  languages: string[]       // every language it talks in, the default first (manifest `languages`); [] when the manifest names none
  declared?: boolean        // false: the manifest says nothing about languages (Detect, plus the user's own)
}

/** 'auto' = Detect: the robot follows the language the user speaks (among the languages in the list). */
export const LANG_AUTO = 'auto'

/** What this user changed for one robot: languages added to / removed from the manifest's list (kept in the browser). */
export interface LangEdits { added: string[]; removed: string[] }
export const NO_EDITS: LangEdits = { added: [], removed: [] }

/** A language code the user may add: 2-3 lowercase letters (ISO 639), never 'auto'. */
export const validLangCode = (c: string): boolean => /^[a-z]{2,3}$/.test(c) && c !== LANG_AUTO

/** The robot's languages after the user's edits: manifest minus removed, plus added (undeclared: only the added). */
export function languageList(info: RobotLanguages | null, edits: LangEdits = NO_EDITS): string[] {
  const base = info && info.declared !== false ? info.languages : []
  const out = base.filter(l => !edits.removed.includes(l))
  for (const l of edits.added) if (!out.includes(l)) out.push(l)
  return out
}

/** The language to use: the tab's own choice when it is on offer, else Detect when offered, else the robot's default.
 *  No answer from the robot yet: the stored choice, else English. */
export function resolveLanguage(stored: string | null, info: RobotLanguages | null, edits: LangEdits = NO_EDITS): string {
  const s = (stored ?? '').trim().toLowerCase()
  if (!info) return s || 'en'
  const opts = languageOptions(info, '', edits)
  if (s && opts.includes(s)) return s
  if (opts.includes(LANG_AUTO)) return LANG_AUTO
  return opts.includes(info.language) ? info.language : (opts[0] ?? info.language)
}

/** What the picker shows for a code: 'ko' -> 'KO', 'auto' -> 'Detect'. */
export const languageLabel = (code: string): string => code === LANG_AUTO ? 'Detect' : code.toUpperCase()

/** The picker's options: Detect first (when offered), then the robot's languages; `current` is added when it is not one
 *  of them (so the select is never blank). */
export function languageOptions(info: RobotLanguages | null, current: string, edits: LangEdits = NO_EDITS): string[] {
  const list = languageList(info, edits)
  const opts = info ? [LANG_AUTO, ...list] : list   // Detect is always offered, however many languages the manifest names
  return opts.includes(current) || !current ? opts : [...opts, current]
}

/** The language speech is spoken in (browser voice, speaking rate): Detect speaks the robot's default until a phrase is heard. */
export function speechLanguage(lang: string, info: RobotLanguages | null, heard?: string | null): string {
  if (lang !== LANG_AUTO) return lang
  return heard || info?.language || 'en'
}

export function addLanguage(e: LangEdits, code: string): LangEdits {
  const c = code.trim().toLowerCase()
  if (!validLangCode(c)) return e
  return { added: e.added.includes(c) ? e.added : [...e.added, c], removed: e.removed.filter(l => l !== c) }
}

export function removeLanguage(e: LangEdits, code: string, info: RobotLanguages | null): LangEdits {
  const inManifest = !!info && info.declared !== false && info.languages.includes(code)
  return { added: e.added.filter(l => l !== code), removed: inManifest && !e.removed.includes(code) ? [...e.removed, code] : e.removed }
}

export const hasEdits = (e: LangEdits): boolean => e.added.length > 0 || e.removed.length > 0
