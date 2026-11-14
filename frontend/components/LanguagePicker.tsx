'use client'
import PopoverButton from './PopoverButton'
import { LANG_AUTO, languageLabel } from '../lib/robotLanguages'

// The language picker: a button showing the language in use; its popover lists Detect and the languages that are on (click to
// pick), then the manifest's languages with a switch each: this site's choice, saved on the robot (PUT /robot/languages).
export default function LanguagePicker({ value, options, supported, on, detected, disabled, onPick, onToggle, buttonClass }: {
  value: string
  options: string[]                        // Detect + the languages that are on (+ the one in use)
  supported: string[]                      // the manifest's languages
  on: string[]                             // the ones that are on
  detected?: string | null                 // the language heard last (Detect mode)
  disabled?: boolean
  onPick: (l: string) => void
  onToggle: (code: string) => Promise<string>   // '' on success, else the error to show
  buttonClass?: string
}) {
  const label = value === LANG_AUTO && detected ? `Detect · ${detected.toUpperCase()}` : languageLabel(value)
  return (
    <PopoverButton testId="lang-picker" label={label} panelClass="w-48"
      title={value === LANG_AUTO ? 'Detect: the robot answers in the language you speak (among the languages that are on)' : "Language of the robot's speech and of what it hears"}
      buttonClass={`${buttonClass ?? ''} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {close => (
        <div className="flex flex-col gap-0.5">
          {options.map(l => (
            <button key={l} type="button" data-testid={`lang-opt-${l}`} onClick={() => { onPick(l); close() }}
              className={`text-left px-1.5 py-0.5 rounded hover:bg-gray-100 ${l === value ? 'font-semibold text-emerald-700' : ''}`}>
              {l === value ? '✓ ' : ''}{languageLabel(l)}{l === LANG_AUTO && detected ? ` (${detected.toUpperCase()})` : ''}
            </button>
          ))}
          {supported.length > 1 && (
            <div className="border-t border-gray-100 pt-1 mt-0.5" data-testid="lang-switches">
              <div className="px-1.5 text-gray-500" title="Which of the robot's languages this site uses. Saved on the robot: every dashboard sees it.">Languages on (this robot)</div>
              {supported.map(l => (
                <label key={l} className="flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" data-testid={`lang-on-${l}`} checked={on.includes(l)} disabled={on.includes(l) && on.length <= 1}
                    title={on.includes(l) && on.length <= 1 ? 'At least one language must stay on' : undefined}
                    onChange={() => { void onToggle(l).then(err => { if (err) alert(`Languages: ${err}`) }) }} className="accent-emerald-600" />
                  {l.toUpperCase()}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </PopoverButton>
  )
}
