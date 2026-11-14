'use client'
import { useState } from 'react'
import PopoverButton from './PopoverButton'
import { LANG_AUTO, languageLabel, validLangCode } from '../lib/robotLanguages'

// The language picker: a button showing the language in use; its popover lists Detect + the robot's languages (click to
// pick, × to delete one) and a box to add a language by its code. Used in the control bar and in the chat header.
export default function LanguagePicker({ value, options, detected, edited, disabled, onPick, onAdd, onRemove, onReset, buttonClass }: {
  value: string
  options: string[]
  detected?: string | null                 // the language heard last (Detect mode): shown next to Detect
  edited?: boolean                         // the list differs from the manifest's: offer the reset
  disabled?: boolean
  onPick: (l: string) => void
  onAdd: (code: string) => void
  onRemove: (code: string) => void
  onReset: () => void
  buttonClass?: string
}) {
  const [code, setCode] = useState('')
  const c = code.trim().toLowerCase()
  const label = value === LANG_AUTO && detected ? `Detect · ${detected.toUpperCase()}` : languageLabel(value)
  return (
    <PopoverButton testId="lang-picker" label={label} panelClass="w-44"
      title={value === LANG_AUTO ? "Detect: the robot answers in the language you speak (among its languages)" : "Language of the robot's speech and of what it hears"}
      buttonClass={`${buttonClass ?? ''} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {close => (
        <div className="flex flex-col gap-0.5">
          {options.map(l => (
            <div key={l} className="flex items-center">
              <button type="button" data-testid={`lang-opt-${l}`} onClick={() => { onPick(l); close() }}
                className={`flex-1 text-left px-1.5 py-0.5 rounded hover:bg-gray-100 ${l === value ? 'font-semibold text-emerald-700' : ''}`}>
                {l === value ? '✓ ' : ''}{languageLabel(l)}{l === LANG_AUTO && detected ? ` (${detected.toUpperCase()})` : ''}
              </button>
              {l !== LANG_AUTO && (
                <button type="button" data-testid={`lang-del-${l}`} title={`Delete ${l.toUpperCase()} from this robot's list (this browser only)`}
                  onClick={() => onRemove(l)} className="px-1 text-gray-400 hover:text-red-600">×</button>
              )}
            </div>
          ))}
          <form className="flex items-center gap-1 border-t border-gray-100 pt-1 mt-0.5"
            onSubmit={e => { e.preventDefault(); if (validLangCode(c)) { onAdd(c); setCode('') } }}>
            <input data-testid="lang-add-input" value={code} onChange={e => setCode(e.target.value)} placeholder="add: ko, en, ja…" maxLength={3}
              className="w-full border border-gray-300 rounded px-1 py-0.5 text-[11px]" />
            <button type="submit" data-testid="lang-add" disabled={!validLangCode(c)} title="Add this language code"
              className="px-1.5 py-0.5 rounded border border-gray-300 enabled:hover:bg-gray-50 disabled:opacity-40">+</button>
          </form>
          {edited && <button type="button" data-testid="lang-reset" onClick={onReset}
            className="text-left px-1.5 py-0.5 text-gray-500 hover:text-gray-800">Reset to the robot's list</button>}
        </div>
      )}
    </PopoverButton>
  )
}
