'use client'
import { useState } from 'react'
import { api } from '../lib/api'
import { SPEED_LEVELS, batteryInfo, canEnable, deviceText, gripperText, isOn, modeChips, nearestLevel, stateLabel, type TeleopFunction, type Tone } from '../lib/teleop'

const TONE: Record<Tone, string> = {
  off: 'bg-gray-100 text-gray-600 border-gray-300', wait: 'bg-amber-50 text-amber-700 border-amber-300',
  on: 'bg-green-50 text-green-700 border-green-400', bad: 'bg-red-50 text-red-700 border-red-300',
}

// One row per teleop function the robot offers (robot_agent GET /teleop): state, input device, gripper, speed, On / Off. Nothing is drawn
// when the robot has none. Switching ON asks first (rule 8: a person must be next to the robot); OFF never asks.
export default function TeleopBar({ functions, runInFlight, onChanged }: { functions: TeleopFunction[]; runInFlight: boolean; onChanged: () => void }) {
  const [asking, setAsking] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const call = (p: Promise<void>) => p.then(() => { setErr(''); onChanged() }).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  if (!functions.length) return null
  return (
    <div data-testid="teleop-bar" className="mb-2 flex flex-col gap-1">
      {functions.map(f => {
        const pill = stateLabel(f), dev = deviceText(f), grip = gripperText(f), on = isOn(f), level = nearestLevel(f.state?.speed), bat = batteryInfo(f)
        const batChip = bat ? <span data-testid={`teleop-${f.name}-battery`} className={bat.low ? 'font-semibold text-amber-200' : ''}> · {bat.text}</span> : null
        return (
          <div key={f.name} data-testid={`teleop-${f.name}`} className="flex flex-wrap items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1 bg-white">
            <span className="font-medium text-gray-700" title="Teleoperation: drive this part of the robot with an input device on the robot (e.g. a SpaceMouse). Two clients driving one robot is unsafe: Cancel stops both.">🕹 {f.label}</span>
            <span data-testid={`teleop-${f.name}-state`} className={`px-1.5 py-0.5 rounded border ${TONE[pill.tone]}`}>{pill.text}</span>
            {f.available && <span className={dev.ok ? 'text-gray-500' : 'text-amber-700'}>{dev.text}</span>}
            {f.available && grip && <span className="text-gray-500">{grip}</span>}
            {modeChips(f).map(c => <span key={c} data-testid={`teleop-${f.name}-chip`} className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700">{c}</span>)}
            <span className="ml-auto flex items-center gap-1">
              <label className="flex items-center gap-1 text-gray-500">speed
                <select data-testid={`teleop-${f.name}-speed`} value={String(level * 100)} disabled={!f.available}
                  onChange={e => call(api.setTeleopSpeed(f.name, Number(e.target.value) / 100))}
                  className="px-1 py-0.5 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40">
                  {SPEED_LEVELS.map(l => <option key={l} value={String(l * 100)}>{l * 100}%</option>)}
                </select>
              </label>
              {on
                ? <button data-testid={`teleop-${f.name}-off`} onClick={() => call(api.enableTeleop(f.name, false))}
                    className="ml-1 px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white" title={`Switch teleop off now${bat ? ` (input device battery ${bat.text})` : ''}`}>■ Off{batChip}</button>
                : asking === f.name
                  ? <span className="ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-800">
                      A person is next to the robot?
                      <button data-testid={`teleop-${f.name}-yes`} onClick={() => { setAsking(null); void call(api.enableTeleop(f.name, true, true)) }}
                        className="px-1.5 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white">Yes, switch on</button>
                      <button onClick={() => setAsking(null)} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600">No</button>
                    </span>
                  : <button data-testid={`teleop-${f.name}-on`} disabled={!canEnable(f, runInFlight)} onClick={() => setAsking(f.name)}
                      title={runInFlight ? 'A run is in flight: cancel it first' : `Switch teleop on: the robot will follow the input device${bat ? ` (input device battery ${bat.text})` : ''}`}
                      className="ml-1 px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">▶ On{batChip}</button>}
            </span>
          </div>
        )
      })}
      {err && <div data-testid="teleop-error" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>}
    </div>
  )
}
