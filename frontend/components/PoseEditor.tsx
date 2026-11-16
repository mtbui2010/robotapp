'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { POSE_SPEEDS, nearestSpeed, poseFormError, type Pose, type PoseList } from '../lib/poses'

type Form = { id?: string; label: string; plan: string }

// A small popover under the Go to drop-down (it adds no row to the strip): the pose NAMES with ✎ edit / × delete, ＋ new, the one speed for all poses (gauge icon),
// ↺ restore the robot's starting poses. A pose's steps (a plan written like a shortcut button's, one step per line, `a::x&&b::y` runs two together) show only when
// it is being edited. Nothing is built in: the robot package only seeded the first list.
export default function PoseEditor({ list, onChanged, onClose }: { list: PoseList; onChanged: () => void; onClose: () => void }) {
  const [form, setForm] = useState<Form | null>(null)
  const [del, setDel] = useState<Pose | null>(null)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {                                           // a click outside closes it
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h) }
  }, [onClose])
  const done = (p: Promise<unknown>) => p.then(() => { setErr(''); onChanged() }).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  const problem = form ? poseFormError(form.label, form.plan, list.poses, form.id) : ''
  const save = () => { if (!form || problem) return; const f = form; setForm(null); void done(f.id ? api.updatePose(f.id, f.label.trim(), f.plan.trim()) : api.addPose(f.label.trim(), f.plan.trim())) }
  const btn = 'px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100'
  const editor = (
    <div className="flex flex-col gap-1 border border-blue-200 bg-blue-50/50 rounded p-1.5 my-0.5">
      <input data-testid="pose-label" value={form?.label ?? ''} onChange={e => setForm(f => f && { ...f, label: e.target.value })} placeholder="name" aria-label="pose name" className="px-1.5 py-0.5 rounded border border-gray-300 bg-white" />
      <textarea data-testid="pose-plan" value={form?.plan ?? ''} onChange={e => setForm(f => f && { ...f, plan: e.target.value })} rows={3} aria-label="pose steps" spellCheck={false}
        placeholder={'one step per line\nmovej::approach_drawer\nlift::0.5&&movej::fold'} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white font-mono" />
      <div className="flex items-center gap-1.5">
        <button data-testid="pose-save" disabled={!!problem} onClick={save} title={problem} className="px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">Save</button>
        <button onClick={() => setForm(null)} className={btn}>Cancel</button>
        {problem && (form?.label || form?.plan) ? <span className="text-amber-700 truncate" title={problem}>{problem}</span> : null}
      </div>
    </div>
  )
  return (
    <div ref={box} data-testid="pose-editor" className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[90vw] rounded border border-gray-300 bg-white shadow-lg p-1.5 text-xs flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 pb-1 border-b border-gray-100">
        <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-500">
          <title>Speed of every pose</title><path d="M3.5 17a9 9 0 1 1 17 0" /><path d="M12 14l4.5-5" /><circle cx="12" cy="14.5" r="1.3" fill="currentColor" stroke="none" /></svg>
        <select data-testid="pose-speed" value={String(nearestSpeed(list.speed))} onChange={e => void done(api.setPoseSpeed(Number(e.target.value)))} aria-label="speed of every pose"
          title="One speed for every pose" className="px-1 py-0.5 rounded border border-gray-300 bg-white text-gray-700">
          {POSE_SPEEDS.map(s => <option key={s} value={String(s)}>{Math.round(s * 100)}%</option>)}
        </select>
        <span className="ml-auto flex items-center gap-1">
          {list.defaults_missing > 0 && <button data-testid="pose-defaults" onClick={() => void done(api.restorePoseDefaults())} className={btn} title={`Add the ${list.defaults_missing} starting pose${list.defaults_missing > 1 ? 's' : ''} that ${list.defaults_missing > 1 ? 'are' : 'is'} not in the list`} aria-label="restore default poses">↺</button>}
          <button data-testid="pose-new" onClick={() => setForm({ label: '', plan: '' })} className={btn} title="New pose" aria-label="new pose">＋</button>
          <button onClick={onClose} className={btn} aria-label="close">✕</button>
        </span>
      </div>
      {form && !form.id && editor}
      {!list.poses.length && !form && <div className="text-gray-500 px-1 py-1">No poses yet: ＋ adds one.</div>}
      {list.poses.map(p => form?.id === p.id ? <div key={p.id}>{editor}</div> : (
        <div key={p.id} data-testid={`pose-row-${p.label}`} className="flex items-center gap-1 px-1 py-0.5 hover:bg-gray-50">
          <span className="flex-1 truncate text-gray-800" title={p.label}>{p.label}</span>
          {del?.id === p.id
            ? <span className="flex items-center gap-1 text-amber-800">delete?
                <button data-testid="pose-del-yes" onClick={() => { setDel(null); void done(api.deletePose(p.id)) }} className="px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white">Yes</button>
                <button onClick={() => setDel(null)} className={btn}>No</button></span>
            : <>
                <button onClick={() => setForm({ id: p.id, label: p.label, plan: p.plan })} aria-label={`edit ${p.label}`} className={btn} title="Edit (shows the steps)">✎</button>
                <button onClick={() => setDel(p)} aria-label={`delete ${p.label}`} className={`${btn} text-red-600 hover:bg-red-50`}>×</button>
              </>}
        </div>
      ))}
      {err && <div data-testid="pose-error" className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>}
    </div>
  )
}
