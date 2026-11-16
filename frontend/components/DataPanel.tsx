'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { cleanText, defaultExportName, editChanged, effectiveLabel, exportText, fmtSec, jointRange, keptRange, polyline, suggestApplied, xToTime, type RecDetail, type RecEdit, type RecExport, type RecList, type RecRow } from '../lib/recordings'

const W = 640, H = 120
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d']

// The Data tab: the raw episodes the robot recorded (robot_agent /recordings). Look at them (numbers, a frame, the curves), clean them with a NON-destructive edit list
// (trim the idle start / end, change the label, exclude), and prepare an export for the training servers. The raw files are never changed.
export default function DataPanel() {
  const [list, setList] = useState<RecList | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { api.listRecordings().then(l => { setList(l); setErr('') }).catch(e => setErr(e instanceof Error ? e.message : String(e))) }, [])
  useEffect(() => { load() }, [load])
  const [exp, setExp] = useState({ name: defaultExportName(), fps: 30, action: 'future_state', horizon_s: 0.3, failures: false })
  const [expRes, setExpRes] = useState<RecExport | null>(null)
  const [cleanMsg, setCleanMsg] = useState('')
  const [redo, setRedo] = useState(false)
  const clean = (ids?: string[], overwrite = false) => api.autoCleanRecordings(ids, overwrite).then(r => { setCleanMsg(cleanText(r)); setErr(''); load(); setRev(v => v + 1) })
    .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  const [rev, setRev] = useState(0)                                     // bumped after a clean: the open detail reloads
  const doExport = () => api.exportRecordings({ name: exp.name.trim(), fps: exp.fps, action: exp.action, horizon_s: exp.horizon_s, labels: exp.failures ? ['success', 'failure'] : ['success'] })
    .then(r => { setExpRes(r); setErr('') }).catch(e => { setExpRes(null); setErr(e instanceof Error ? e.message : String(e)) })
  if (!list) return <div data-testid="data-panel" className="text-sm text-gray-500 p-3">{err || 'Reading the recordings…'}</div>
  const t = list.totals
  return (
    <div data-testid="data-panel" className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 border border-gray-200 rounded px-2 py-1 bg-white">
        <span data-testid="data-totals" className="text-gray-700">{t.episodes} episodes · {t.hours} h · {t.success} success · {t.failure} failure{t.excluded ? ` · ${t.excluded} excluded` : ''}</span>
        <button onClick={load} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100" title="Read the folder again">↻</button>
        <button data-testid="clean-all" onClick={() => clean(undefined, redo)} className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
          title="Auto-clean: cut the idle start and end of every episode, and everything before / after a move made with teleop off (e.g. Go to pose). The raw files are not touched; each trim can be changed below.">🧹 Auto-clean all</button>
        <label className="flex items-center gap-1 text-gray-500" title="Also replace trims that were already saved"><input type="checkbox" checked={redo} onChange={e => setRedo(e.target.checked)} />redo saved trims</label>
        {cleanMsg && <span data-testid="clean-msg" className="text-emerald-700">{cleanMsg}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1" title="Writes a manifest of the episodes to export (not excluded, accepted labels, with their trims); the command below turns it into a LeRobot dataset on the training server">
          <input data-testid="export-name" value={exp.name} onChange={e => setExp({ ...exp, name: e.target.value })} placeholder="export name" aria-label="export name" className="w-28 px-1.5 py-0.5 rounded border border-gray-300" />
          <select value={exp.fps} onChange={e => setExp({ ...exp, fps: Number(e.target.value) })} aria-label="fps" className="px-1 py-0.5 rounded border border-gray-300 bg-white">{[10, 15, 20, 30, 50].map(f => <option key={f} value={f}>{f} Hz</option>)}</select>
          <select value={exp.action} onChange={e => setExp({ ...exp, action: e.target.value })} aria-label="action" title="How the action is made: the state a moment later (default), the servo's target, or the controller's reference" className="px-1 py-0.5 rounded border border-gray-300 bg-white">
            <option value="future_state">action: future state</option><option value="servo">action: servo target</option><option value="ref">action: controller ref</option></select>
          {exp.action === 'future_state' && <input type="number" step="0.1" min="0" max="3" value={exp.horizon_s} onChange={e => setExp({ ...exp, horizon_s: Number(e.target.value) })} aria-label="horizon seconds" title="seconds ahead" className="w-14 px-1 py-0.5 rounded border border-gray-300" />}
          <label className="flex items-center gap-1 text-gray-600"><input type="checkbox" checked={exp.failures} onChange={e => setExp({ ...exp, failures: e.target.checked })} />+ failures</label>
          <button data-testid="export-go" onClick={doExport} disabled={!exp.name.trim()} className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">Export</button>
        </span>
      </div>
      {expRes && <div data-testid="export-result" className="border border-green-200 bg-green-50 rounded px-2 py-1 text-green-800">{exportText(expRes)}<div className="font-mono text-[11px] text-gray-700 break-all select-all mt-0.5">{expRes.command}</div></div>}
      {err && <div data-testid="data-error" className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>}
      <div className="overflow-x-auto border border-gray-200 rounded bg-white">
        <table className="w-full text-left">
          <thead className="text-gray-500 border-b border-gray-200"><tr><th className="px-2 py-1">episode</th><th>prompt</th><th>label</th><th>length</th><th>idle start / end</th><th>moving</th><th>kept</th><th>⚠</th><th>clean</th></tr></thead>
          <tbody>
            {list.episodes.map(r => <Row key={r.id} r={r} on={sel === r.id} pick={() => setSel(sel === r.id ? null : r.id)} clean={() => clean([r.id], true)} />)}
            {!list.episodes.length && <tr><td colSpan={9} className="px-2 py-3 text-gray-500">No episodes yet in {list.dir}. Record some with ● Record on the Cameras tab.</td></tr>}
          </tbody>
        </table>
      </div>
      {sel && <Detail key={`${sel}/${rev}`} id={sel} onSaved={load} />}
    </div>
  )
}

function Row({ r, on, pick, clean }: { r: RecRow; on: boolean; pick: () => void; clean: () => void }) {
  if (r.error) return <tr className="text-red-700"><td className="px-2 py-1">{r.id}</td><td colSpan={8}>{r.error}</td></tr>
  const s = r.summary, [a, b] = keptRange(r), lab = effectiveLabel(r)
  return (
    <tr data-testid={`row-${r.id}`} onClick={pick} className={`cursor-pointer border-b border-gray-100 ${on ? 'bg-blue-50' : 'hover:bg-gray-50'} ${r.edit?.exclude ? 'opacity-50 line-through' : ''}`}>
      <td className="px-2 py-1 font-mono">{r.id}</td><td className="max-w-[18rem] truncate" title={r.prompt}>{r.prompt}</td>
      <td className={lab === 'success' ? 'text-green-700' : 'text-amber-700'}>{lab}{r.edit?.label && r.edit.label !== r.label ? ' ✎' : ''}</td>
      <td>{fmtSec(s.duration_s)}</td><td>{s.idle_head_s?.toFixed(1) ?? '–'} / {s.idle_tail_s?.toFixed(1) ?? '–'} s</td>
      <td>{s.moving_fraction !== undefined ? `${Math.round(s.moving_fraction * 100)}%` : '–'}</td>
      <td>{r.edit?.trim_start_s !== undefined || r.edit?.trim_end_s !== undefined ? `${fmtSec(a)}–${fmtSec(b)} ✎` : 'all'}</td>
      <td title={s.warnings.join('\n')} className={s.warnings.length ? 'text-amber-600' : 'text-gray-300'}>{s.warnings.length || '·'}</td>
      <td onClick={e => e.stopPropagation()}>
        {suggestApplied(r) ? <span className="text-emerald-700" title="the suggested trim is saved">✓ cut</span>
          : <button data-testid={`clean-${r.id}`} disabled={!s.trim_suggest} onClick={clean} className="px-1.5 py-0.5 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-30 no-underline"
              title={s.trim_suggest ? `Cut to ${fmtSec(s.trim_suggest[0])}–${fmtSec(s.trim_suggest[1])}` : 'nothing to suggest'}>🧹 cut</button>}
      </td>
    </tr>
  )
}

function Detail({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [d, setD] = useState<RecDetail | null>(null)
  const [t, setT] = useState(0)
  const [play, setPlay] = useState(false)
  const [form, setForm] = useState<RecEdit>({})
  const [err, setErr] = useState('')
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => { api.getRecording(id).then(x => { setD(x); setForm(x.edit ?? {}) }).catch(e => setErr(e instanceof Error ? e.message : String(e))) }, [id])
  const dur = d?.summary.duration_s ?? 0
  useEffect(() => {
    if (!play) return
    const h = setInterval(() => setT(v => { if (v + 0.2 >= dur) { setPlay(false); return dur } return v + 0.2 }), 200)
    return () => clearInterval(h)
  }, [play, dur])
  if (!d) return <div className="text-gray-500 px-2">{err || 'Loading…'}</div>
  const [lo, hi] = jointRange(d.series.joints)
  const a = form.trim_start_s ?? 0, b = form.trim_end_s ?? dur
  const px = (s: number) => (s / dur) * W
  const changed = editChanged(d.edit, form, dur)
  const save = () => api.saveRecordingEdit(id, { ...(form.trim_start_s !== undefined || form.trim_end_s !== undefined ? { trim_start_s: a, trim_end_s: b } : {}), label: form.label, exclude: !!form.exclude, note: form.note })
    .then(() => { setErr(''); onSaved(); return api.getRecording(id).then(x => { setD(x); setForm(x.edit ?? {}) }) }).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  const reset = () => api.deleteRecordingEdit(id).then(() => { setForm({}); onSaved(); return api.getRecording(id).then(setD) }).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  const sug = d.summary.trim_suggest
  return (
    <div data-testid="data-detail" className="border border-gray-200 rounded bg-white p-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {Object.keys(d.cameras).map(cam => (
          // eslint-disable-next-line @next/next/no-img-element
          <figure key={cam} className="m-0"><img data-testid={`frame-${cam}`} src={api.recordingFrameUrl(id, cam, t)} alt={`${cam} at ${fmtSec(t)}`} className="h-44 rounded border border-gray-200 bg-gray-100" /><figcaption className="text-gray-500 text-center">{cam}</figcaption></figure>
        ))}
        <div className="flex-1 min-w-[16rem] flex flex-col gap-1">
          <div className="font-medium text-gray-800">{d.prompt}</div>
          <div className="text-gray-500">{fmtSec(d.summary.duration_s)} · max {d.summary.max_speed_rad_s ?? '–'} rad/s · gripper changes {d.summary.gripper_changes ?? 0} · {Object.entries(d.summary.rates_hz ?? {}).map(([k, v]) => `${k} ${v} Hz`).join(' · ')}</div>
          {d.summary.warnings.map(w => <div key={w} className="text-amber-700">⚠ {w}</div>)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => { if (t >= dur) setT(0); setPlay(p => !p) }} className="px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100" aria-label={play ? 'pause' : 'play'}>{play ? '⏸' : '▶'}</button>
        <input data-testid="data-slider" type="range" min={0} max={dur} step={0.1} value={t} onChange={e => { setPlay(false); setT(Number(e.target.value)) }} className="flex-1" aria-label="time" />
        <span className="font-mono w-14 text-right">{fmtSec(t)}</span>
      </div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="w-full h-32 bg-gray-50 border border-gray-200 rounded cursor-crosshair" role="img" aria-label="joint curves"
        onClick={e => { const r = svg.current?.getBoundingClientRect(); if (r) { setPlay(false); setT(xToTime(e.clientX - r.left, r.width, dur)) } }}>
        {(d.summary.auto_motion ?? []).map(([x, y]) => <rect key={x} x={px(x)} y={0} width={px(y) - px(x)} height={H} fill="#fecaca" opacity={0.7} />)}
        <rect x={0} y={0} width={px(a)} height={H} fill="#e5e7eb" opacity={0.8} /><rect x={px(b)} y={0} width={W - px(b)} height={H} fill="#e5e7eb" opacity={0.8} />
        {d.series.joints.map((j, i) => <polyline key={i} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={1} points={polyline(d.series.t, j, dur, lo, hi, W, H)} />)}
        {d.series.gripper_cmd && <polyline fill="none" stroke="#111" strokeWidth={1.5} strokeDasharray="4 2" points={polyline(d.series.t, d.series.gripper_cmd, dur, 0, 0.1, W, H)} />}
        <line x1={px(t)} x2={px(t)} y1={0} y2={H} stroke="#dc2626" strokeWidth={1.5} />
      </svg>
      <div className="text-gray-400">coloured: the 7 arm joints (rad); dashed: the gripper command; grey: trimmed away; red: the arm was moved with teleop off (Go to pose)</div>
      <div className="font-medium text-gray-700 border-t border-gray-100 pt-2">🧹 Clean this episode <span className="font-normal text-gray-400">(saved beside the raw files; Reset undoes it)</span></div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-600">keep</span>
        <input data-testid="trim-start" type="number" step="0.1" min={0} value={Number(a.toFixed(2))} onChange={e => setForm({ ...form, trim_start_s: Number(e.target.value), trim_end_s: b })} className="w-16 px-1 py-0.5 rounded border border-gray-300" aria-label="trim start" />
        <span>–</span>
        <input data-testid="trim-end" type="number" step="0.1" min={0} value={Number(b.toFixed(2))} onChange={e => setForm({ ...form, trim_start_s: a, trim_end_s: Number(e.target.value) })} className="w-16 px-1 py-0.5 rounded border border-gray-300" aria-label="trim end" />
        <span className="text-gray-500">s</span>
        <button onClick={() => setForm({ ...form, trim_start_s: Number(t.toFixed(2)), trim_end_s: b })} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100" title="start at the cursor">⇤ here</button>
        <button onClick={() => setForm({ ...form, trim_start_s: a, trim_end_s: Number(t.toFixed(2)) })} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100" title="end at the cursor">here ⇥</button>
        {sug && <button data-testid="trim-suggest" onClick={() => setForm({ ...form, trim_start_s: sug[0], trim_end_s: sug[1] })} className="px-1.5 py-0.5 rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" title="cut the idle start and end (0.5 s margin)">suggest {fmtSec(sug[0])}–{fmtSec(sug[1])}</button>}
        <button onClick={() => setForm({ ...form, trim_start_s: undefined, trim_end_s: undefined })} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100">all</button>
        <select value={form.label ?? ''} onChange={e => setForm({ ...form, label: e.target.value || undefined })} aria-label="label" className="px-1 py-0.5 rounded border border-gray-300 bg-white">
          <option value="">label: as recorded ({d.label})</option><option value="success">label: success</option><option value="failure">label: failure</option></select>
        <label className="flex items-center gap-1"><input data-testid="exclude" type="checkbox" checked={!!form.exclude} onChange={e => setForm({ ...form, exclude: e.target.checked })} />exclude</label>
        <input value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="note" aria-label="note" className="min-w-[10rem] flex-1 px-1.5 py-0.5 rounded border border-gray-300" />
        <button data-testid="edit-save" onClick={save} disabled={!changed} className="px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">Save</button>
        <button onClick={reset} disabled={!d.edit} className="px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40" title="Remove the edit: back to the raw episode">Reset</button>
      </div>
      {err && <div data-testid="data-detail-error" className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>}
    </div>
  )
}
