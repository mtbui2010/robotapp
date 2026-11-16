'use client'
import { useState } from 'react'
import { api } from '../lib/api'
import { POSE_SPEEDS, nearestSpeed, planPreview, poseFormError, type Pose, type PoseList } from '../lib/poses'

// Edit the "Go to" poses: add, edit, delete them all, and set the ONE speed every pose runs at. A pose is a name + a plan of steps written like a shortcut
// button's plan (one step per line; `a::x&&b::y` runs two steps together). Nothing is built in: the robot package only seeded the first list.
export default function PoseEditor({ list, onChanged, onClose }: { list: PoseList; onChanged: () => void; onClose: () => void }) {
  const [form, setForm] = useState<{ id?: string; label: string; plan: string } | null>(null)
  const [del, setDel] = useState<Pose | null>(null)
  const [err, setErr] = useState('')
  const done = (p: Promise<unknown>) => p.then(() => { setErr(''); onChanged() }).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  const problem = form ? poseFormError(form.label, form.plan, list.poses, form.id) : ''
  const save = () => { if (!form || problem) return; const f = form; setForm(null); void done(f.id ? api.updatePose(f.id, f.label.trim(), f.plan.trim()) : api.addPose(f.label.trim(), f.plan.trim())) }
  return (
    <div data-testid="pose-editor" className="mb-2 border border-gray-200 rounded bg-white px-2 py-1.5 text-xs flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-800">Go to poses</span>
        <label className="flex items-center gap-1 text-gray-600" title="One speed for every pose: a fast move (several rad/s) does not look like the teleop around it in a recorded episode">speed for all
          <select data-testid="pose-speed" value={String(nearestSpeed(list.speed))} onChange={e => void done(api.setPoseSpeed(Number(e.target.value)))} className="px-1 py-0.5 rounded border border-gray-300 bg-white">
            {POSE_SPEEDS.map(s => <option key={s} value={String(s)}>{Math.round(s * 100)}%</option>)}
          </select></label>
        {list.defaults_missing > 0 && <button data-testid="pose-defaults" onClick={() => void done(api.restorePoseDefaults())} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100" title="Add the robot's starting poses that are not in the list">↺ restore {list.defaults_missing} default{list.defaults_missing > 1 ? 's' : ''}</button>}
        <button onClick={() => setForm({ label: '', plan: '' })} className="px-1.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white" data-testid="pose-new">＋ New pose</button>
        <button onClick={onClose} className="ml-auto px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100" aria-label="close">✕</button>
      </div>
      {!list.poses.length && !form && <div className="text-gray-500">No poses yet. Add one with ＋ New pose.</div>}
      {list.poses.map(p => (
        <div key={p.id} data-testid={`pose-row-${p.label}`} className="flex items-center gap-2 border-b border-gray-100 py-0.5">
          <span className="font-medium text-gray-800 min-w-[9rem]">{p.label}</span>
          <span className="font-mono text-gray-500 truncate flex-1" title={p.plan}>{planPreview(p.plan)}</span>
          {del?.id === p.id
            ? <span className="flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5">Delete “{p.label}”?
                <button data-testid="pose-del-yes" onClick={() => { setDel(null); void done(api.deletePose(p.id)) }} className="px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white">Delete</button>
                <button onClick={() => setDel(null)} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white">Cancel</button></span>
            : <>
                <button onClick={() => setForm({ id: p.id, label: p.label, plan: p.plan })} aria-label={`edit ${p.label}`} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100">✎</button>
                <button onClick={() => setDel(p)} aria-label={`delete ${p.label}`} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-red-50 text-red-600">×</button>
              </>}
        </div>
      ))}
      {form && (
        <div className="flex flex-col gap-1 border border-blue-200 bg-blue-50/40 rounded p-1.5">
          <input data-testid="pose-label" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="name (shown in Go to)" aria-label="pose name" className="px-1.5 py-0.5 rounded border border-gray-300 bg-white" />
          <textarea data-testid="pose-plan" value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })} rows={3} aria-label="pose plan" spellCheck={false}
            placeholder={'movej::approach_drawer\nlift::0.5&&movej::fold      # two steps together'} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white font-mono" />
          <div className="text-gray-500">One step per line, written like a button&apos;s plan (<code>skill::argument</code>); <code>a::x&amp;&amp;b::y</code> runs two together. The speed above is added to the arm steps.</div>
          <div className="flex items-center gap-2">
            <button data-testid="pose-save" disabled={!!problem} onClick={save} title={problem} className="px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">Save</button>
            <button onClick={() => setForm(null)} className="px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100">Cancel</button>
            {problem && form.label + form.plan !== '' && <span className="text-amber-700">{problem}</span>}
          </div>
        </div>
      )}
      {err && <div data-testid="pose-error" className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>}
    </div>
  )
}
