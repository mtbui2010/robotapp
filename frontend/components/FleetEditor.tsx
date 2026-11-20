'use client'
import { useState } from 'react'
import { api, type Robot } from '../lib/api'
import { fleet, DEFAULT_FLEET_URL } from '../lib/fleet'
import { draftProblem, draftToFleet, fleetToDraft, setMemberReal, toggleMember } from '../lib/fleetEdit'
import { saveFleet } from '../lib/fleetRegistry'
import type { FleetDef, SyncResult } from '../lib/fleet_types'

// Add / edit one fleet: name, manager URL, which registry robots it works with and, for each, whether it is a REAL
// robot (required, no default). Save keeps the fleet in this browser, then makes the manager match it (PUT / DELETE
// /fleet/robots). It only edits: nothing here starts motion (rule 6).
interface Props {
  robots: Robot[]
  fleets: FleetDef[]
  original: string | null          // the fleet being edited, null = a new one
  onClose: () => void
  onSaved: (name: string, sync: SyncResult) => void
}

export default function FleetEditor({ robots, fleets, original, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(() => fleetToDraft(fleets.find(f => f.name === original) ?? null, DEFAULT_FLEET_URL))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const problem = draftProblem(draft, fleets, original)
  const urlOf = (n: string) => robots.find(r => r.name === n)?.url

  const save = async () => {
    if (problem || busy) return
    const def = draftToFleet(draft)
    saveFleet(original, def)
    setBusy(true)
    const sync = await fleet.syncFleet(def, urlOf)
    setBusy(false)
    setResult(sync)
    onSaved(def.name, sync)
  }

  const box = 'bg-white border border-gray-200 rounded px-2 py-1.5 text-xs'
  return (
    <div className="border border-gray-200 rounded p-2 bg-gray-50 flex flex-col gap-1.5" data-testid="fleet-editor">
      <div className="text-[11px] font-medium text-gray-700">{original === null ? 'Add fleet' : `Edit fleet "${original}"`}</div>
      <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Fleet name" aria-label="fleet name" className={box} />
      <input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder={DEFAULT_FLEET_URL}
             aria-label="fleet manager URL" className={`${box} font-mono`} />
      <div className="text-[10px] text-gray-500">Robots this fleet works with (from the robot list):</div>
      {robots.length === 0 && <div className="text-[10px] text-gray-400">No robots yet: add a robot first.</div>}
      {robots.map(r => {
        const m = draft.members.find(x => x.name === r.name)
        return (
          <div key={r.name} className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1 min-w-0">
              <input type="checkbox" checked={!!m} onChange={() => setDraft(toggleMember(draft, r.name))} />
              <span className="truncate">{r.name}</span>
            </label>
            {m && (
              <span className="ml-auto flex gap-2 text-[11px]" role="radiogroup" aria-label={`${r.name}: real or simulated`}>
                <label className="flex items-center gap-0.5 text-red-700">
                  <input type="radio" name={`real-${r.name}`} checked={m.real === true} onChange={() => setDraft(setMemberReal(draft, r.name, true))} />real
                </label>
                <label className="flex items-center gap-0.5 text-gray-600">
                  <input type="radio" name={`real-${r.name}`} checked={m.real === false} onChange={() => setDraft(setMemberReal(draft, r.name, false))} />simulated
                </label>
              </span>
            )}
          </div>
        )
      })}
      {problem && !result && <div className="text-[10px] text-amber-700">{problem}</div>}
      {result && <div className={`text-[10px] ${result.state === 'synced' ? 'text-green-700' : 'text-red-600'}`}>{result.text}</div>}
      <div className="flex gap-1.5 justify-end">
        <button onClick={onClose} className="px-2.5 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded">{result ? 'Close' : 'Cancel'}</button>
        {!result && (
          <button onClick={() => void save()} disabled={!!problem || busy}
                  className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded">{busy ? '…' : 'Save'}</button>
        )}
      </div>
    </div>
  )
}
