'use client'
import { useState } from 'react'
import { api } from '../lib/api'
import type { MapConfig } from '../lib/types'
import { ConfigFieldsEditor, type ConfigView } from './ConfigFields'

// Map tab ⚙ Settings: the MAP config group (no longer in Global Configs, 2026-10-26). Only the keys a
// person sets are edited here — how to read the robot's pose and which skills a click / ← → / auto
// lift run; the picture, its frame, the keep area and the origin are written by ⟳ Update map,
// ✂ Keep area and ✥ Edit origin and only shown. "JSON" edits the whole group. Saved as a change
// (PATCH, merged per key), so a map another machine saved meanwhile is kept.

const HAND_SET = ['confirm_goal', 'places', 'pose', 'goal', 'rotate', 'lift'] as const
// kcare's values (kcare_bucheon): a starting point for a site that has none
const TEMPLATES: Record<string, unknown> = {
  confirm_goal: true,
  places: 'ENV',
  pose: { agent: 'mobile_pose', x: 'pose.position.x', y: 'pose.position.y', orientation: 'pose.orientation', period_s: 0.5 },
  goal: { skill: 'moveb', params: { x: '{x}', y: '{y}' } },
  rotate: { skill: 'turn', params: { inputs: '{deg}' }, step_deg: 15 },
  lift: { skill: 'lift', params: { inputs: '{h}' }, clearance: 0.1, reach_m: 1.0 },
}
const HINTS: Record<string, string> = {
  pose: 'robot pose: a device agent and the paths of x / y / orientation in its value',
  goal: 'click a free spot → this skill; {x} {y} {rz}',
  rotate: '← → → this skill; {deg}',
  lift: 'auto lift after a goal; {h} = surface height + clearance',
  confirm_goal: 'ask before every motion',
  places: '"ENV": draw the ENV places; click one → move::<name>',
}

const pick = (cfg: MapConfig): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of HAND_SET) if ((cfg as Record<string, unknown>)[k] !== undefined) out[k] = (cfg as Record<string, unknown>)[k]
  return out
}

export function MapSettings({ cfg, onSaved, onClose }: { cfg: MapConfig; onSaved: () => void; onClose: () => void }) {
  const [view, setView] = useState<ConfigView>('fields')
  const [text, setText] = useState(() => JSON.stringify(pick(cfg), null, 2))        // fields: the hand-set keys
  const [whole, setWhole] = useState(() => JSON.stringify(cfg, null, 2))            // json: all of MAP
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  let draft: Record<string, unknown> | null = null
  try { draft = JSON.parse(text) } catch { /* shown by the editor */ }
  const missing = HAND_SET.filter(k => draft && draft[k] === undefined)

  const save = async () => {
    setErr('')
    let value: Record<string, unknown>
    try {
      if (view === 'json') value = JSON.parse(whole)
      else {
        const hand = JSON.parse(text) as Record<string, unknown>
        value = { ...(cfg as Record<string, unknown>) }
        for (const k of HAND_SET) { if (hand[k] === undefined) delete value[k]; else value[k] = hand[k] }
      }
    } catch { setErr('invalid JSON'); return }
    setBusy(true)
    try {
      await api.mergeSkillConfig('MAP', cfg as Record<string, unknown>, value)
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const src = cfg.source, frame = cfg.image?.frame ?? cfg.layers?.occupancy?.frame
  return (
    <div className="flex flex-col gap-2 text-xs border border-gray-200 rounded-lg bg-white p-2">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-800">⚙ Map settings</span>
        <div className="inline-flex rounded border border-gray-200 overflow-hidden text-[10px]">
          {(['fields', 'json'] as ConfigView[]).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`px-1.5 py-0.5 ${view === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}>
              {v === 'fields' ? 'Fields' : 'JSON (all of MAP)'}</button>
          ))}
        </div>
        {err && <span className="text-[10px] text-red-500">{err}</span>}
        <button type="button" onClick={save} disabled={busy}
          className="ml-auto px-2 py-0.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-[11px]">Save</button>
        <button type="button" onClick={onClose} className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50 text-[11px]">Close</button>
      </div>

      {view === 'fields' ? (
        <>
          <ConfigFieldsEditor text={text} onChange={setText} editKeys />
          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-gray-500">not set:</span>
              {missing.map(k => (
                <button key={k} type="button" title={HINTS[k]}
                  onClick={() => setText(JSON.stringify({ ...(draft ?? {}), [k]: TEMPLATES[k] }, null, 2))}
                  className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100">+ {k}</button>
              ))}
            </div>
          )}
          <div className="text-[10px] text-gray-500 leading-relaxed">
            {Object.entries(HINTS).map(([k, h]) => <div key={k}><span className="font-mono">{k}</span>: {h}</div>)}
          </div>
          <div className="text-[10px] text-gray-500 border-t border-gray-100 pt-1 leading-relaxed">
            <div className="font-medium text-gray-600">Written by the map tools (shown only)</div>
            <div>picture: {cfg.image?.file ?? cfg.image?.connection ?? '—'}{frame ? ` · ${frame.width}×${frame.height} at ${frame.resolution} m, origin (${frame.origin.map(v => v.toFixed(2)).join(', ')})` : ''}</div>
            <div>source (⟳ Update map): {src ? `${src.connection}${src.saved_at ? `, saved ${src.saved_at}` : ''}${src.inflate_m != null ? `, inflate ${src.inflate_m} m` : ''}` : '—'}</div>
            <div>keep area (✂): {src?.keep?.length ? `${src.keep.length} corners` : 'whole map'}{src?.speck_cells != null ? ` · specks < ${src.speck_cells} cells dropped` : ''}</div>
            <div>origin (✥): {cfg.origin ? `(${cfg.origin.x}, ${cfg.origin.y}) ${cfg.origin.yaw_deg}°` : 'the map’s own'}</div>
          </div>
        </>
      ) : (
        <textarea value={whole} rows={16} spellCheck={false} onChange={e => setWhole(e.target.value)}
          className="font-mono text-[11px] bg-white border border-gray-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-blue-400" />
      )}
    </div>
  )
}
