'use client'
import { useState } from 'react'
import { api } from '../lib/api'
import { SPEED_LEVELS, batteryInfo, canEnable, deviceText, driveLabel, isOn, modeChips, nearestLevel, poseError, stateLabel, type TeleopFunction, type TeleopPose, type Tone } from '../lib/teleop'

const TONE: Record<Tone, string> = {
  off: 'bg-gray-100 text-gray-600 border-gray-300', wait: 'bg-amber-50 text-amber-700 border-amber-300',
  on: 'bg-green-50 text-green-700 border-green-400', bad: 'bg-red-50 text-red-700 border-red-300',
}

// One row per teleop function the robot offers (robot_agent GET /teleop): state, input device, gripper, speed, On / Off. Nothing is drawn
// when the robot has none. No confirmation is asked (a person is always next to the robot): On is sent with confirm=true, the API's own flag.
export default function TeleopBar({ functions, runInFlight, onChanged }: { functions: TeleopFunction[]; runInFlight: boolean; onChanged: () => void }) {
  const [err, setErr] = useState('')
  const [moving, setMoving] = useState<string | null>(null)                           // the function whose arm is going to a pose
  // Going to a pose: POST /skill switches teleop off by itself (the backend, begin_run). No question is asked: a person is always next to a robot that is driven remotely.
  const goTo = (fn: string, p: TeleopPose) => {
    setMoving(fn); setErr('')
    api.runSkill(p.skill, p.params).then(res => { const m = poseError(res); if (m) setErr(`${p.label}: ${m}`) })
      .catch(e => setErr(`${p.label}: ${e instanceof Error ? e.message : String(e)}`)).finally(() => { setMoving(null); onChanged() })
  }
  const call = (p: Promise<void>) => p.then(() => { setErr(''); onChanged() }).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  if (!functions.length) return null
  return (
    <div data-testid="teleop-bar" className="mb-2 flex flex-col gap-1">
      {functions.map(f => {
        const pill = stateLabel(f), dev = deviceText(f), on = isOn(f), level = nearestLevel(f.state?.speed), bat = batteryInfo(f), chips = modeChips(f)
        const gripOpen = f.available ? f.state?.gripper_open : undefined       // true / false, or null / undefined when this function has no gripper
        const label = driveLabel(f)
        return (
          <div key={f.name} data-testid={`teleop-${f.name}`} className="flex flex-wrap items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1 bg-white">
            <span title={`${f.label}: drive this part of the robot with an input device on the robot (e.g. a SpaceMouse). Two clients driving one robot is unsafe: Cancel stops both.`}>🕹</span>
            {/* the device is only mentioned when something is wrong with it */}
            {f.available && !dev.ok && <span data-testid={`teleop-${f.name}-device`} className="text-amber-700">{dev.text}</span>}
            {f.available && chips.map(c => <span key={c} data-testid={`teleop-${f.name}-chip`} className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700">{c}</span>)}
            {gripOpen !== undefined && gripOpen !== null && (
              <span data-testid={`teleop-${f.name}-gripper`} role="switch" aria-checked={gripOpen} aria-readonly="true" title={gripOpen ? 'Gripper open' : 'Gripper closed'}
                className="inline-flex items-center gap-1 select-none">
                <span aria-hidden>{gripOpen ? '✋' : '✊'}</span>
                <span className={`relative inline-block h-4 w-7 rounded-full border ${gripOpen ? 'bg-green-500 border-green-600' : 'bg-gray-300 border-gray-400'}`}>
                  <span className={`absolute top-[1px] h-3 w-3 rounded-full bg-white shadow transition-all ${gripOpen ? 'left-[13px]' : 'left-[1px]'}`} />
                </span>
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {!!f.poses?.length && (
                <select data-testid={`teleop-${f.name}-pose`} value="" disabled={runInFlight || moving === f.name} aria-label="Go to pose"
                    title={runInFlight ? 'A run is in flight: cancel it first' : 'Go to a pose: the arm moves there (teleop is switched off first)'}
                    onChange={e => { const p = f.poses?.find(x => x.name === e.target.value); if (p) goTo(f.name, p) }}
                    className="px-1 py-0.5 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40">
                    <option value="">{moving === f.name ? 'moving…' : 'Go to pose…'}</option>
                    {f.poses?.map(p => <option key={p.name} value={p.name}>{p.label}</option>)}
                  </select>)}
              {bat && <span data-testid={`teleop-${f.name}-battery`} title={`Input device battery${bat.heard ? `, reported ${bat.heard}` : ''}`}
                className={`px-1.5 py-0.5 rounded border ${bat.low ? 'border-amber-400 bg-amber-50 font-semibold text-amber-700' : 'border-gray-200 text-gray-600'}`}>{bat.text}</span>}
              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-500">
                <title>Speed</title>
                <path d="M3.5 17a9 9 0 1 1 17 0" />
                <path d="M12 14l4.5-5" />
                <circle cx="12" cy="14.5" r="1.3" fill="currentColor" stroke="none" />
              </svg>
              <select data-testid={`teleop-${f.name}-speed`} value={String(level * 100)} disabled={!f.available} title="Speed: a fraction of the top speed" aria-label="Speed"
                onChange={e => call(api.setTeleopSpeed(f.name, Number(e.target.value) / 100))}
                className="px-1 py-0.5 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40">
                {SPEED_LEVELS.map(l => <option key={l} value={String(l * 100)}>{l * 100}%</option>)}
              </select>
              {on
                  ? <button data-testid={`teleop-${f.name}-off`} onClick={() => call(api.enableTeleop(f.name, false))}
                      className={`px-2 py-0.5 rounded text-white hover:bg-red-500 ${pill.tone === 'wait' ? 'bg-amber-500' : 'bg-green-600'}`}
                      title={`${label}: click to switch teleop off${bat ? ` (input device battery ${bat.text}${bat.heard ? `, reported ${bat.heard}` : ''})` : ''}`}>{label}</button>
                  : <button data-testid={`teleop-${f.name}-on`} disabled={!canEnable(f, runInFlight)} onClick={() => void call(api.enableTeleop(f.name, true, true))}
                      title={runInFlight ? 'A run is in flight: cancel it first' : `Switch teleop on: the robot will follow the input device${bat ? ` (input device battery ${bat.text}${bat.heard ? `, reported ${bat.heard}` : ''})` : ''}`}
                      className={`px-2 py-0.5 rounded text-white disabled:opacity-60 ${pill.tone === 'bad' ? 'bg-red-600' : 'bg-green-600 hover:bg-green-500'}`}>{label}</button>}
            </span>
          </div>
        )
      })}
      {err && <div data-testid="teleop-error" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>}
    </div>
  )
}
